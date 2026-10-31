// API tests against a running dev server + mock provider.
// Env: BASE_URL (form3 server), MOCK_URL (mock provider), MODELS_FILE (server's models file).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4598';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:4599';
const KEY = 'test-key-1234567890';
const uid = () => crypto.randomUUID();
const sleep = ms => new Promise(r => setTimeout(r, ms));

let csrf = '';
let modelId = '';

async function addModel(overrides = {}) {
  const r = await fetch(BASE + '/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Form-CSRF': csrf, Origin: BASE },
    body: JSON.stringify({ label: 'Mock', baseUrl: MOCK + '/v1', model: 'mock-model', apiKey: KEY, ...overrides })
  });
  return { status: r.status, body: await r.json() };
}

async function chat(text, extra = {}) {
  const r = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Form-CSRF': csrf, Origin: BASE },
    body: JSON.stringify({ version: 1, sessionId: uid(), requestId: uid(), text, history: [], states: [], ...extra })
  });
  return r;
}

function parseSSE(text) {
  const events = [];
  for (const block of text.split('\n\n')) {
    let event = 'message', data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (data) { try { events.push({ event, data: JSON.parse(data) }); } catch {} }
  }
  return events;
}

const mockStats = async () => (await (await fetch(MOCK + '/admin/stats')).json());

test('bootstrap: empty start, csrf issued, no keys anywhere', async () => {
  const r = await fetch(BASE + '/api/bootstrap');
  const b = await r.json();
  assert.equal(r.status, 200);
  assert.equal(b.version, 3);
  assert.deepEqual(b.models, []);
  csrf = b.csrf;
  assert.ok(typeof csrf === 'string' && csrf.length >= 32);
});

test('model management: rejects invalid input', async () => {
  const bad1 = await addModel({ apiKey: '' });
  assert.equal(bad1.status, 400);
  const bad2 = await addModel({ baseUrl: 'notaurl' });
  assert.equal(bad2.status, 400);
  const bad3 = await addModel({ label: '' });
  assert.equal(bad3.status, 400);
});

test('model management: add returns masked key, file chmod 600, list masked', async () => {
  const { status, body } = await addModel();
  assert.equal(status, 200);
  assert.equal(body.models.length, 1);
  const m = body.models[0];
  modelId = m.id;
  assert.equal(m.keyMasked, '…7890');
  assert.ok(!JSON.stringify(body).includes(KEY), 'full key must never appear in response');
  if (process.env.MODELS_FILE) {
    assert.ok(fs.existsSync(process.env.MODELS_FILE));
    assert.equal(fs.statSync(process.env.MODELS_FILE).mode & 0o777, 0o600);
    assert.ok(fs.readFileSync(process.env.MODELS_FILE, 'utf8').includes(KEY), 'key stored locally');
  }
  const list = await (await fetch(BASE + '/api/models')).json();
  assert.equal(list.models[0].keyMasked, '…7890');
  assert.ok(!JSON.stringify(list).includes(KEY));
  assert.ok(await mockStats() !== undefined);
});

test('CSRF enforcement: mutations without token are rejected', async () => {
  const r = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ version: 1, sessionId: uid(), requestId: uid(), text: 'hi', history: [], states: [] })
  });
  assert.equal(r.status, 403);
});

test('chat streams prose chunks before render, then done (slider scenario)', async () => {
  const r = await chat('Zeig mir einen Spar-Rechner mit Slider');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  const text = await r.text();
  const events = parseSSE(text);
  const proseIdx = events.findIndex(e => e.event === 'prose-chunk');
  const renderIdx = events.findIndex(e => e.event === 'render');
  assert.ok(proseIdx > -1, 'prose streamed');
  assert.ok(renderIdx > -1, 'artifact rendered');
  assert.ok(proseIdx < renderIdx, 'prose arrives before render');
  const proseEv = events.filter(e => e.event === 'prose-chunk');
  assert.ok(proseEv.length >= 3, 'prose visibly streams in multiple chunks, got ' + proseEv.length);
  assert.equal(events[events.length - 1].event, 'done');
  assert.equal(validateOk(events[renderIdx].data.render), true);
  assert.ok(!text.includes(KEY), 'key never leaks into SSE stream');
  const st = await mockStats();
  assert.equal(st.lastAuthOk, true, 'server sent Bearer key upstream');
  assert.deepEqual(st.lastRoles, ['system', 'user']);
});

test('windowed history reaches upstream as alternating messages', async () => {
  const r = await chat('History test mit Slider bitte', {
    history: [
      { role: 'user', content: 'Frage eins' },
      { role: 'assistant', content: 'Antwort eins' },
      { role: 'assistant', content: 'mit Artefakt [enthielt ein interaktives Artefakt]' }
    ]
  });
  assert.equal(r.status, 200);
  await r.text(); // consume fully: server allows one chat at a time
  const st = await mockStats();
  assert.deepEqual(st.lastRoles, ['system', 'user', 'assistant', 'user']);
  assert.ok(st.lastUserContent.includes('History test'));
});

test('invalid artifact triggers exactly ONE retry then success', async () => {
  const before = await mockStats();
  const r = await chat('Test invalid artifact bitte');
  const events = parseSSE(await r.text());
  assert.equal(events.filter(e => e.event === 'retry').length, 1, 'exactly one retry event');
  assert.ok(events.some(e => e.event === 'render'), 'retry produced valid render');
  assert.equal(events[events.length - 1].event, 'done');
  const after = await mockStats();
  assert.equal(after.calls.invalid, (before.calls.invalid || 0) + 1, 'first upstream call');
  assert.equal(after.calls.corrected, (before.calls.corrected || 0) + 1, 'exactly one corrective round');
});

test('prose-only answer needs no artifact and is valid', async () => {
  const r = await chat('Erkläre VPN, prose only');
  const events = parseSSE(await r.text());
  assert.ok(events.filter(e => e.event === 'prose-chunk').length >= 3);
  assert.equal(events.filter(e => e.event === 'artifact-start').length, 0);
  assert.equal(events.filter(e => e.event === 'render').length, 0);
  assert.equal(events.filter(e => e.event === 'retry').length, 0);
  assert.equal(events[events.length - 1].event, 'done');
});

test('stop: client abort disconnects upstream', async () => {
  const controller = new AbortController();
  const r = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Form-CSRF': csrf, Origin: BASE },
    body: JSON.stringify({ version: 1, sessionId: uid(), requestId: uid(), text: 'slow story', history: [], states: [] }),
    signal: controller.signal
  });
  const reader = r.body.getReader();
  await reader.read(); // first SSE bytes arrive
  const before = (await mockStats()).disconnects;
  controller.abort();
  await sleep(1500);
  const after = (await mockStats()).disconnects;
  assert.ok(after > before, `upstream saw disconnect (${before} -> ${after})`);
  await sleep(300); // server settles
});

test('request validation: unknown fields, bad history, bad states rejected', async () => {
  assert.equal((await chat('x', { evil: 1 })).status, 400);
  assert.equal((await chat('x', { history: [{ role: 'system', content: 'no' }] })).status, 400);
  assert.equal((await chat('x', { states: [{ id: 'a', state: 'not-object' }] })).status, 400);
});

test('models file is not served and static surface is minimal', async () => {
  assert.equal((await fetch(BASE + '/form.models.json')).status, 404);
  assert.equal((await fetch(BASE + '/api/../server.mjs')).status, 404);
  const idx = await fetch(BASE + '/');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-type') || '', /text\/html/);
});

test('delete model, then chat is blocked with friendly error', async () => {
  const r = await fetch(BASE + '/api/models/' + modelId, { method: 'DELETE', headers: { 'X-Form-CSRF': csrf, Origin: BASE } });
  assert.equal(r.status, 200);
  const blocked = await chat('nochmal bitte');
  assert.equal(blocked.status, 400);
  const body = await blocked.json();
  assert.match(body.error, /kein Modell/i);
  if (process.env.MODELS_FILE) {
    const stored = JSON.parse(fs.readFileSync(process.env.MODELS_FILE, 'utf8'));
    assert.equal(stored.models.length, 0);
  }
});

function validateOk(render) {
  try {
    assert.equal(render.version, 1);
    assert.ok(typeof render.html === 'string' && render.html.length > 0);
    assert.ok(typeof render.js === 'string' && render.js.length > 0);
    return true;
  } catch { return false; }
}
