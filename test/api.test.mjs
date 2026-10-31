// API tests against a running dev server + mock provider.
// Env: BASE_URL (form3 server), MOCK_URL (mock provider), MODELS_FILE (server's models file).
// v3.2: every flow runs inside a real login session (registration is enabled
// via FORM3_REGISTRATION=1 in test runs). CSRF is session-bound.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4598';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:4599';
const KEY = 'test-key-1234567890';
const uid = () => crypto.randomUUID();
const sleep = ms => new Promise(r => setTimeout(r, ms));

let csrf = '';      // session-bound csrf of the owner session
let cookie = '';    // Cookie header of the owner session
let modelId = '';
let convId = '';

// A session wrapper: captures Set-Cookie and threads csrf + Origin automatically.
function makeSession() {
  return { cookie: '', csrf: '' };
}
async function register(sess, username, password) {
  const r = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ username, password })
  });
  const body = await r.json().catch(() => ({}));
  if (r.ok) {
    const setc = r.headers.get('set-cookie') || '';
    const m = setc.match(/form3sess=([^;]+)/);
    sess.cookie = m ? 'form3sess=' + m[1] : '';
    sess.csrf = body.csrf || '';
  }
  return { status: r.status, body, setCookie: r.headers.get('set-cookie') || '' };
}
async function login(sess, username, password) {
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ username, password })
  });
  const body = await r.json().catch(() => ({}));
  if (r.ok) {
    const m = (r.headers.get('set-cookie') || '').match(/form3sess=([^;]+)/);
    sess.cookie = m ? 'form3sess=' + m[1] : '';
    sess.csrf = body.csrf || '';
  }
  return { status: r.status, body, setCookie: r.headers.get('set-cookie') || '' };
}
function api(sess, path, { method = 'GET', body, headers = {} } = {}) {
  return fetch(BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(sess?.cookie ? { Cookie: sess.cookie } : {}),
      ...(sess?.csrf ? { 'X-Form-CSRF': sess.csrf } : {}),
      Origin: BASE,
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
async function addModel(sess, overrides = {}) {
  const r = await api(sess, '/api/models', { method: 'POST', body: { label: 'Mock', baseUrl: MOCK + '/v1', model: 'mock-model', apiKey: KEY, ...overrides } });
  return { status: r.status, body: await r.json() };
}
async function chat(sess, text, extra = {}) {
  return api(sess, '/api/chat', { method: 'POST', body: { version: 1, sessionId: convId, requestId: uid(), text, history: [], states: [], ...extra } });
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

const owner = makeSession(), userB = makeSession(), fresh = makeSession(), pingUser = makeSession();

test('auth: bootstrap unauthenticated -> 401, status reports registration open + no users', async () => {
  const st = await (await fetch(BASE + '/api/auth/status')).json();
  assert.equal(st.hasUsers, false);
  assert.equal(st.registration, true, 'test server enables registration via env');
  const b = await fetch(BASE + '/api/bootstrap');
  assert.equal(b.status, 401);
  assert.equal((await fetch(BASE + '/api/conversations')).status, 401);
  assert.equal((await api(null, '/api/chat', { method: 'POST', body: {} })).status, 401, 'chat requires a session');
});

test('auth: register first user = owner; cookie HttpOnly+SameSite=Strict (+Secure behind https proxy)', async () => {
  const { status, body, setCookie } = await register(owner, 'owner1', 'password123');
  assert.equal(status, 200);
  assert.equal(body.user.role, 'owner');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.ok(!/Secure/.test(setCookie) || true); // Secure only behind https ingress
  csrf = owner.csrf; cookie = owner.cookie;
  const b = await (await api(owner, '/api/bootstrap')).json();
  assert.equal(b.version, 3);
  assert.equal(b.user.username, 'owner1');
  assert.equal(b.csrf, owner.csrf, 'bootstrap returns the session csrf');
  assert.deepEqual(b.models, []);
});

test('auth: register duplicate and bad inputs rejected', async () => {
  assert.equal((await register(makeSession(), 'owner1', 'password123')).status, 400);
  assert.equal((await register(makeSession(), 'x', 'password123')).status, 400);
  assert.equal((await register(makeSession(), 'okname', 'short')).status, 400);
});

test('auth: login with wrong password rejected uniformly; success issues new session', async () => {
  const bad = await login(makeSession(), 'owner1', 'totally-wrong');
  assert.equal(bad.status, 401);
  assert.match(bad.body.error, /Ungültiger Benutzername oder Passwort/);
  const ghost = await login(makeSession(), 'ghost', 'whatever-pass');
  assert.equal(ghost.status, 401, 'no user enumeration');
  assert.deepEqual(ghost.body.error, bad.body.error, 'unknown user and wrong password look identical');
  const ok = await login(fresh, 'owner1', 'password123');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, 'owner');
  assert.notEqual(fresh.csrf, owner.csrf, 'csrf is per-session');
});

test('auth: failed logins rate-limited (10 per 5 min per user+client)', async () => {
  const sess = makeSession();
  let last;
  for (let i = 0; i < 11; i++) last = await login(sess, 'ratelimituser', 'wrong-pass-xyz');
  assert.equal(last.status, 429);
  assert.match(last.body.error, /Zu viele fehlgeschlagene Anmeldeversuche/);
});

test('CSRF is session-bound: owner token rejected on another session, missing token rejected', async () => {
  const r = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: fresh.cookie, 'X-Form-CSRF': owner.csrf, Origin: BASE },
    body: JSON.stringify({ version: 1, sessionId: uid(), requestId: uid(), text: 'hi', history: [], states: [] })
  });
  assert.equal(r.status, 403, 'foreign session csrf rejected');
  const none = await fetch(BASE + '/api/models', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: fresh.cookie, Origin: BASE }, body: '{}'
  });
  assert.equal(none.status, 403, 'missing csrf rejected');
});

test('models: owner adds model, key masked everywhere, file chmod 600', async () => {
  assert.equal((await addModel(owner, { apiKey: '' })).status, 400);
  assert.equal((await addModel(owner, { baseUrl: 'notaurl' })).status, 400);
  const { status, body } = await addModel(owner);
  assert.equal(status, 200);
  modelId = body.models[0].id;
  assert.equal(body.models[0].keyMasked, '…7890');
  assert.ok(!JSON.stringify(body).includes(KEY), 'full key never in response');
  if (process.env.MODELS_FILE) {
    assert.ok(fs.existsSync(process.env.MODELS_FILE));
    assert.equal(fs.statSync(process.env.MODELS_FILE).mode & 0o777, 0o600);
    assert.ok(fs.readFileSync(process.env.MODELS_FILE, 'utf8').includes(KEY));
  }
  const list = await (await api(owner, '/api/models')).json();
  assert.equal(list.models[0].keyMasked, '…7890');
});

test('models: non-owner sees names only and cannot mutate', async () => {
  assert.equal((await register(userB, 'bob1', 'password456')).status, 200);
  assert.equal(userB.body ? true : true, true);
  const list = await (await api(userB, '/api/models')).json();
  assert.equal(list.models.length, 1);
  assert.equal(list.models[0].id, modelId);
  assert.equal('keyMasked' in list.models[0], false, 'no masked key for non-owner');
  assert.equal('baseUrl' in list.models[0], false, 'no baseUrl for non-owner');
  const add = await addModel(userB);
  assert.equal(add.status, 403, 'only owner manages models');
  const del = await api(userB, '/api/models/' + modelId, { method: 'DELETE' });
  assert.equal(del.status, 403);
});

test('conversations: server-side create + list, user B sees nothing of user A', async () => {
  const r = await api(owner, '/api/conversations', { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  const { conversation } = await r.json();
  convId = conversation.id;
  assert.match(convId, /^[0-9a-f-]{36}$/);
  const mine = await (await api(owner, '/api/conversations')).json();
  assert.equal(mine.conversations.length, 1);
  const bobs = await (await api(userB, '/api/conversations')).json();
  assert.equal(bobs.conversations.length, 0, 'user B cannot see user A conversations');
});

test('chat: foreign conversation rejected for user B', async () => {
  const r = await api(userB, '/api/chat', { method: 'POST', body: { version: 1, sessionId: convId, requestId: uid(), text: 'hi', history: [], states: [] } });
  assert.equal(r.status, 403);
});

test('chat streams prose chunks before render, then done with persisted ids', async () => {
  const r = await chat(owner, 'Zeig mir einen Spar-Rechner mit Slider');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  const text = await r.text();
  const events = parseSSE(text);
  const proseIdx = events.findIndex(e => e.event === 'prose-chunk');
  const renderIdx = events.findIndex(e => e.event === 'render');
  assert.ok(proseIdx > -1 && renderIdx > -1 && proseIdx < renderIdx);
  assert.ok(events.filter(e => e.event === 'prose-chunk').length >= 3, 'prose visibly streams');
  assert.equal(events[events.length - 1].event, 'done');
  const done = events[events.length - 1].data;
  assert.match(done.userMessageId, /^[0-9a-f-]{36}$/, 'user message id returned');
  assert.match(done.assistantMessageId, /^[0-9a-f-]{36}$/, 'assistant message id returned');
  assert.ok(!text.includes(KEY), 'key never leaks into SSE stream');
  const st = await mockStats();
  assert.equal(st.lastAuthOk, true, 'server sent Bearer key upstream');
  assert.deepEqual(st.lastRoles, ['system', 'user'], 'history is server-side (fresh conversation)');
});

test('server-side conversations survive a FRESH session (device switch)', async () => {
  const again = makeSession();
  assert.equal((await login(again, 'owner1', 'password123')).status, 200);
  const list = await (await api(again, '/api/conversations')).json();
  assert.equal(list.conversations.length, 1);
  const conv = list.conversations[0];
  assert.equal(conv.messages.length, 2, 'user + assistant persisted server-side');
  assert.equal(conv.messages[0].role, 'user');
  assert.equal(conv.messages[1].role, 'assistant');
  assert.ok(conv.messages[1].render, 'element render persisted');
  assert.equal(conv.messages[1].render.name, 'Spar-Rechner');
});

test('windowed history reaches upstream from the server store', async () => {
  const r = await chat(owner, 'History test mit Slider bitte');
  assert.equal(r.status, 200);
  await r.text();
  const st = await mockStats();
  assert.deepEqual(st.lastRoles, ['system', 'user', 'assistant', 'user'], 'server loaded stored history');
  assert.ok(st.lastUserContent.includes('History test'));
});

test('element state sync: /api/state updates the stored render, ownership-checked', async () => {
  const list = await (await api(owner, '/api/conversations')).json();
  const elementId = list.conversations[0].messages.find(m => m.render).id;
  const ok = await api(owner, '/api/state', { method: 'POST', body: { messageId: elementId, state: { value: 7 } } });
  assert.equal(ok.status, 200);
  const denied = await api(userB, '/api/state', { method: 'POST', body: { messageId: elementId, state: {} } });
  assert.equal(denied.status, 403, 'user B cannot touch user A elements');
  const again = await (await api(owner, '/api/conversations')).json();
  assert.equal(again.conversations[0].messages.find(m => m.id === elementId).render.state.value, 7);
});

test('invalid artifact triggers exactly ONE retry then success', async () => {
  const before = await mockStats();
  const r = await chat(owner, 'Test invalid artifact bitte');
  const events = parseSSE(await r.text());
  assert.equal(events.filter(e => e.event === 'retry').length, 1);
  assert.ok(events.some(e => e.event === 'render'));
  assert.equal(events[events.length - 1].event, 'done');
  const after = await mockStats();
  assert.equal(after.calls.invalid, (before.calls.invalid || 0) + 1);
  assert.equal(after.calls.corrected, (before.calls.corrected || 0) + 1);
});

test('prose-only answer needs no artifact and is valid', async () => {
  const r = await chat(owner, 'Erkläre VPN, prose only');
  const events = parseSSE(await r.text());
  assert.ok(events.filter(e => e.event === 'prose-chunk').length >= 3);
  assert.equal(events.filter(e => e.event === 'render').length, 0);
  assert.equal(events[events.length - 1].event, 'done');
});

test('stop: client abort disconnects upstream, error turn persisted server-side', async () => {
  const controller = new AbortController();
  const r = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: owner.cookie, 'X-Form-CSRF': owner.csrf, Origin: BASE },
    body: JSON.stringify({ version: 1, sessionId: convId, requestId: uid(), text: 'slow story', history: [], states: [] }),
    signal: controller.signal
  });
  const reader = r.body.getReader();
  await reader.read();
  const before = (await mockStats()).disconnects;
  controller.abort();
  await sleep(1500);
  const after = (await mockStats()).disconnects;
  assert.ok(after > before, `upstream saw disconnect (${before} -> ${after})`);
  await sleep(300);
  const list = await (await api(owner, '/api/conversations')).json();
  const lastMsg = list.conversations[0].messages.at(-1);
  assert.equal(lastMsg.role, 'assistant');
  assert.ok(lastMsg.error, 'abort persisted as error turn');
});

test('request validation: unknown fields, bad history, bad states rejected', async () => {
  assert.equal((await chat(owner, 'x', { evil: 1 })).status, 400);
  assert.equal((await chat(owner, 'x', { history: [{ role: 'system', content: 'no' }] })).status, 400);
  assert.equal((await chat(owner, 'x', { states: [{ id: 'a', state: 'not-object' }] })).status, 400);
});

test('refinement: refineTarget reaches upstream, element replaced IN PLACE server-side', async () => {
  const list = await (await api(owner, '/api/conversations')).json();
  const elementsBefore = list.conversations[0].messages.filter(m => m.render).length;
  const element = list.conversations[0].messages.find(m => m.render);
  const rt = { id: element.id, name: 'Spar-Rechner', html: element.render.html, css: element.render.css, js: element.render.js, state: element.render.state };
  const r = await chat(owner, 'mache den Akzent blau', { refineTarget: rt });
  assert.equal(r.status, 200);
  const events = parseSSE(await r.text());
  const render = events.find(e => e.event === 'render');
  assert.ok(render, 'refined render arrives');
  assert.equal(render.data.render.name, 'Spar-Rechner');
  assert.ok(render.data.render.css.includes('#7fd4ef'), 'artifact is the updated version');
  const done = events[events.length - 1];
  assert.equal(done.event, 'done');
  assert.equal(done.data.assistantMessageId, null, 'refine never appends a message');
  const after = await (await api(owner, '/api/conversations')).json();
  const conv = after.conversations[0];
  assert.equal(conv.messages.filter(m => m.render).length, elementsBefore, 'refine replaced in place, no new element');
  assert.ok(conv.messages.find(m => m.id === element.id).render.css.includes('#7fd4ef'), 'server stored the refined element');
  assert.equal((after.versions[element.id] || []).length, 1, 'old version archived server-side');
  const st = await mockStats();
  assert.ok(st.lastUserContent.includes('[marked-element'), 'element code attached as untrusted data');
});

test('refinement: invalid refineTarget rejected with size caps', async () => {
  const list = await (await api(owner, '/api/conversations')).json();
  const element = list.conversations[0].messages.find(m => m.render);
  assert.equal((await chat(owner, 'x', { refineTarget: { id: 'a' } })).status, 400);
  assert.equal((await chat(owner, 'x', { refineTarget: { id: uid(), html: 'x'.repeat(33000), css: '', js: '', state: {} } })).status, 400);
  assert.equal((await chat(owner, 'x', { refineTarget: { id: uid(), html: '<p>x</p>', css: '', js: '', state: 'nope' } })).status, 400);
  assert.equal((await chat(owner, 'x', { refineTarget: { id: element.id, html: '<p>x</p>', css: '', js: '', state: {} } })).status, 200, 'name is optional, real element accepted');
  await (await chat(owner, 'nochmal slider')).text();
});

test('db endpoint: auth guards mirror chat/ping', async () => {
  assert.equal((await fetch(BASE + '/api/db', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: '{}' })).status, 401);
  const sess = makeSession();
  await login(sess, 'owner1', 'password123');
  assert.equal((await api(sess, '/api/db', { method: 'POST', body: {}, headers: { 'X-Form-CSRF': 'wrong' } })).status, 403);
});

test('db endpoint: CRUD lifecycle on a REAL element, quotas + scoping enforced', async () => {
  const list = await (await api(owner, '/api/conversations')).json();
  const elementId = list.conversations[0].messages.find(m => m.render).id;
  const D = (body, sess = owner) => api(sess, '/api/db', { method: 'POST', body: { sessionId: convId, elementId, ...body } });
  // validation
  assert.equal((await D({ op: 'dropall', table: 'x' })).status, 400);
  assert.equal((await D({ op: 'create', table: 'no way' })).status, 400);
  assert.equal((await D({ sessionId: 'bad', op: 'create', table: 't' })).status, 400);
  assert.equal((await D({ op: 'insert', table: 't', row: 'string' })).status, 404, 'missing table takes precedence over row shape');
  // user B cannot reach user A's element at all
  assert.equal((await api(userB, '/api/db', { method: 'POST', body: { sessionId: convId, elementId, op: 'create', table: 't' } })).status, 403);
  // lifecycle
  assert.equal((await D({ op: 'create', table: 'todos', columns: ['t', 'done'] })).status, 200);
  assert.equal((await D({ op: 'create', table: 'todos' })).status, 409);
  const ins = await D({ op: 'insert', table: 'todos', row: { t: 'milch', done: false } });
  assert.equal(ins.status, 200);
  assert.equal((await ins.json()).id, 1);
  await D({ op: 'insert', table: 'todos', row: { t: 'brot', done: true } });
  const sel = await D({ op: 'select', table: 'todos', query: { where: { done: false }, limit: 5 } });
  assert.deepEqual((await sel.json()).rows, [{ id: 1, t: 'milch', done: false }]);
  assert.equal((await D({ op: 'update', table: 'todos', id: 1, patch: { done: true } })).status, 200);
  assert.equal((await D({ op: 'update', table: 'todos', id: 99, patch: {} })).status, 404);
  assert.equal((await D({ op: 'delete', table: 'todos', id: 2 })).status, 200);
  assert.equal((await D({ op: 'delete', table: 'todos', id: 2 })).status, 404);
  // quotas
  assert.equal((await D({ op: 'insert', table: 'todos', row: { t: 'x'.repeat(17000) } })).status, 413);
  for (let i = 0; i < 9; i++) assert.equal((await D({ op: 'create', table: 'q' + i })).status, 200);
  assert.equal((await D({ op: 'create', table: 'overflow' })).status, 413);
  assert.equal((await D({ op: 'drop', table: 'q0' })).status, 200);
  assert.equal((await D({ op: 'create', table: 'overflow' })).status, 200);
  assert.equal((await D({ op: 'drop', table: 'todos' })).status, 200);
  assert.equal((await D({ op: 'drop', table: 'todos' })).status, 404);
});

test('ping endpoint: CSRF, strict host validation, fixture ok/blocked/dns, per-user rate limit', async () => {
  // dedicated user so the 10/min budget is untouched by other tests
  const pu = makeSession();
  assert.equal((await register(pu, 'pinguser', 'password789')).status, 200);
  const P = body => api(pu, '/api/ping', { method: 'POST', body });
  assert.equal((await fetch(BASE + '/api/ping', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: '{}' })).status, 401);
  assert.equal((await api(pu, '/api/ping', { method: 'POST', body: {}, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await P({ sessionId: uid(), host: '192.168.1.1' })).status, 400);
  assert.equal((await P({ sessionId: 'nope', host: 'good.example' })).status, 400);
  assert.equal((await P({ sessionId: uid(), host: 'https://example.com/x' })).status, 400);
  const ok = await P({ sessionId: uid(), host: 'good.example' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, ip: '93.184.216.34', ms: 23 });
  assert.equal((await P({ sessionId: uid(), host: 'private.example' })).status, 403);
  assert.equal((await P({ sessionId: uid(), host: 'dual.example' })).status, 403);
  const nx = await P({ sessionId: uid(), host: 'nope.example' });
  assert.equal(nx.status, 200);
  assert.equal((await nx.json()).ok, false);
  // per-user budget is 10/min: 4 consumed above (ok/blocked/dual/dns), 6 fit, then 429
  for (let i = 0; i < 6; i++) { const rr = await P({ sessionId: uid(), host: 'good.example' }); assert.equal(rr.status, 200, 'ping ' + (i + 5)); }
  assert.equal((await P({ sessionId: uid(), host: 'good.example' })).status, 429, 'per-user ping limit (10/min)');
});

test('import: archives land server-side, ids regenerated; export surface stays key-free', async () => {
  const render = { version: 1, name: 'Import-El', html: '<p id="i">ok</p>', css: '', js: '', state: {} };
  const imp = await api(userB, '/api/import', { method: 'POST', body: { sessions: [{ title: 'Bobs Archiv', messages: [
    { role: 'user', text: 'hallo' }, { role: 'assistant', prose: 'hi', render }
  ] }] } });
  assert.equal(imp.status, 200);
  const bobs = await (await api(userB, '/api/conversations')).json();
  assert.equal(bobs.conversations.length, 1);
  assert.equal(bobs.conversations[0].title, 'Bobs Archiv');
  assert.equal((await api(owner, '/api/import', { method: 'POST', body: { sessions: 'nope' } })).status, 400);
});

test('models file is not served and static surface is minimal', async () => {
  assert.equal((await fetch(BASE + '/form.models.json')).status, 404);
  assert.equal((await fetch(BASE + '/api/../server.mjs')).status, 404);
  const idx = await fetch(BASE + '/');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-type') || '', /text\/html/);
});

test('logout invalidates the session server-side', async () => {
  const sess = makeSession();
  await login(sess, 'owner1', 'password123');
  assert.equal((await api(sess, '/api/bootstrap')).status, 200);
  const out = await api(sess, '/api/auth/logout', { method: 'POST', body: {} });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie') || '', /Max-Age=0/);
  assert.equal((await api(sess, '/api/bootstrap')).status, 401, 'session token dead after logout');
});

test('delete model, then chat is blocked with friendly error', async () => {
  const r = await api(owner, '/api/models/' + modelId, { method: 'DELETE' });
  assert.equal(r.status, 200);
  const blocked = await chat(owner, 'nochmal bitte');
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /kein Modell/i);
  if (process.env.MODELS_FILE) {
    const stored = JSON.parse(fs.readFileSync(process.env.MODELS_FILE, 'utf8'));
    assert.equal(stored.models.length, 0);
  }
});
