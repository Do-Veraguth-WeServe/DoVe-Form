// Durable background element jobs — full lifecycle against a DEDICATED server
// instance (own data dir) so a restart can be exercised safely.
// Env: BASE_URL/MOCK_URL from run-all; this file spawns/stops its own server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:4599';
const PORT = process.env.JOBS_TEST_PORT || '4593';
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = 'test-key-1234567890';
const uid = () => crypto.randomUUID();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const dataDir = path.join(os.tmpdir(), `form3-jobs-test-${Date.now()}`);
const modelsFile = path.join(os.tmpdir(), `form3-jobs-models-${Date.now()}.json`);
let server = null;

function startServer() {
  return spawn('node', ['server.mjs'], {
    cwd: root,
    env: {
      ...process.env, PORT,
      FORM3_DATA: dataDir, FORM3_MODELS: modelsFile,
      FORM3_REGISTRATION: '1', FORM3_JOB_TEST_DELAYS: '1', FORM3_JOB_CONCURRENCY: '2',
      FORM3_ORIGIN: BASE
    },
    stdio: ['ignore', 'pipe', 'inherit']
  });
}
const waitReady = proc => new Promise((resolve, reject) => {
  let out = '';
  const t = setTimeout(() => reject(Error('server not ready')), 20000);
  proc.stdout.on('data', d => { out += d; if (/ready/.test(out)) { clearTimeout(t); resolve(); } });
  proc.on('exit', code => { clearTimeout(t); reject(Error('server exited early: ' + code)); });
});
const stopServer = () => new Promise(resolve => {
  if (!server) return resolve();
  server.on('exit', resolve);
  server.kill('SIGTERM');
  setTimeout(() => { try { server.kill('SIGKILL'); } catch {} resolve(); }, 5000);
});

let cookie = '', csrf = '', convId = '';
async function register() {
  const r = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ username: 'jobsowner', password: 'password123' })
  });
  const body = await r.json();
  const m = (r.headers.get('set-cookie') || '').match(/form3sess=([^;]+)/);
  cookie = m ? 'form3sess=' + m[1] : '';
  csrf = body.csrf || '';
}
function api(p, { method = 'GET', body } = {}) {
  return fetch(BASE + p, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      Cookie: cookie, 'X-Form-CSRF': csrf, Origin: BASE
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
async function chat(text) {
  const r = await api('/api/chat', { method: 'POST', body: { version: 1, sessionId: convId, requestId: uid(), text, history: [], states: [] } });
  assert.equal(r.status, 200, 'chat accepted');
  const raw = await r.text();
  const events = [];
  for (const block of raw.split('\n\n')) {
    let event = 'message', data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (data) { try { events.push({ event, data: JSON.parse(data) }); } catch {} }
  }
  return events;
}
const jobOf = events => events.find(e => e.event === 'element-job')?.data.job;
const mockStats = async () => (await (await fetch(MOCK + '/admin/stats')).json());
async function waitFor(pred, timeout = 10000, what = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await pred();
    if (v) return v;
    await sleep(80);
  }
  throw Error('timeout waiting for ' + what);
}
const jobsSnap = async () => (await (await api('/api/jobs')).json());
const convs = async () => (await (await api('/api/conversations')).json());
const jobById = async id => (await jobsSnap()).jobs.find(j => j.id === id) || null;

test('setup: dedicated server, owner, model, conversation', async () => {
  server = startServer();
  await waitReady(server);
  await register();
  const m = await api('/api/models', { method: 'POST', body: { label: 'Mock', baseUrl: MOCK + '/v1', model: 'mock-model', apiKey: KEY } });
  assert.equal(m.status, 200);
  const c = await api('/api/conversations', { method: 'POST', body: {} });
  convId = (await c.json()).conversation.id;
});

test('chat answers a SECOND message while the first element is still building', async () => {
  const callsBefore = (await mockStats()).calls.slowbuild || 0;
  const ev = await chat('baue ein slowbuild element build:5000');
  const job = jobOf(ev);
  assert.ok(job, 'element-job event');
  // the chat turn is DONE — a new message must be accepted and answered now
  const ev2 = await chat('Erkläre mir kurz, was ein VPN macht');
  assert.ok(ev2.some(e => e.event === 'prose-chunk'), 'second answer streams while job runs');
  assert.equal(jobOf(ev2), undefined, 'prose-only turn creates no job');
  const snap = await jobsSnap();
  const still = snap.jobs.find(j => j.id === job.id);
  assert.ok(still && ['queued', 'building', 'validating'].includes(still.state), 'first element still building: ' + still?.state);
  await waitFor(async () => (await jobById(job.id)) === null, 10000, 'job ready');
  const list = await convs();
  const msg = list.conversations[0].messages.find(m2 => m2.id === job.messageId);
  assert.ok(msg.render, 'element attached after background completion');
  assert.equal(msg.render.name, 'Baustellen-Element');
  const st = await mockStats();
  assert.equal(st.calls.slowbuild, callsBefore + 1, 'exactly one provider call for the element');
});

test('two jobs complete in REVERSE order and land on the correct messages', async () => {
  const evA = await chat('nochmal slowbuild build:4000');
  const evB = await chat('weiter mit slowbuild2 build:600');
  const jobA = jobOf(evA), jobB = jobOf(evB);
  assert.ok(jobA && jobB && jobA.id !== jobB.id);
  let aReady = null, bReady = null;
  await waitFor(async () => {
    const s = await jobsSnap();
    const gone = id => !s.jobs.some(j => j.id === id);
    if (bReady === null && gone(jobB.id)) bReady = Date.now();
    if (aReady === null && gone(jobA.id)) aReady = Date.now();
    return aReady !== null && bReady !== null;
  }, 12000, 'both jobs ready');
  assert.ok(bReady < aReady, 'second (shorter) job finished first');
  const list = await convs();
  const find = id => list.conversations[0].messages.find(m => m.id === id);
  assert.equal(find(jobA.messageId).render.name, 'Baustellen-Element', 'first container got first element');
  assert.equal(find(jobB.messageId).render.name, 'Zweites Element', 'second container got second element');
  const idxA = list.conversations[0].messages.findIndex(m => m.id === jobA.messageId);
  const idxB = list.conversations[0].messages.findIndex(m => m.id === jobB.messageId);
  assert.ok(idxA < idxB, 'conversation order preserved regardless of completion order');
});

test('cancel stops the build; message never gains a render', async () => {
  const ev = await chat('slowbuild der abgebrochen wird build:8000');
  const job = jobOf(ev);
  const c = await api('/api/jobs/cancel', { method: 'POST', body: { jobId: job.id } });
  assert.equal(c.status, 200);
  assert.equal((await c.json()).job.state, 'cancelled');
  await sleep(1200); // former build aborts immediately, not after the full delay
  const j = await jobById(job.id);
  assert.equal(j.state, 'cancelled');
  const list = await convs();
  assert.ok(!list.conversations[0].messages.find(m => m.id === job.messageId).render);
  // retry is explicit and only for failed jobs
  assert.equal((await api('/api/jobs/retry', { method: 'POST', body: { jobId: job.id } })).status, 409);
});

test('conversation deletion during a build: late result resurrects nothing', async () => {
  const before = (await mockStats()).disconnects;
  const ev = await chat('slowbuild im gelöschten gespräch build:4000');
  const job = jobOf(ev);
  const del = await api('/api/conversations/' + convId, { method: 'DELETE' });
  assert.equal(del.status, 200);
  await sleep(5000); // build would have completed by now
  const list = await convs();
  assert.equal(list.conversations.length, 0, 'conversation stays deleted');
  assert.equal((await jobsSnap()).jobs.length, 0, 'job rows cascade-deleted with the conversation');
  const health = await (await fetch(BASE + '/api/health')).json();
  assert.equal(health.ok, true, 'server healthy after the race');
  // fresh conversation for the restart test
  const c = await api('/api/conversations', { method: 'POST', body: {} });
  convId = (await c.json()).conversation.id;
});

test('server restart marks interrupted jobs failed; explicit retry completes WITHOUT a second provider call', async () => {
  const callsBefore = (await mockStats()).calls.slowbuild || 0;
  const ev = await chat('slowbuild über neustart build:3000');
  const job = jobOf(ev);
  await waitFor(async () => ['building', 'validating'].includes((await jobById(job.id))?.state), 5000, 'building state');
  await stopServer();
  server = startServer();
  await waitReady(server);
  // old session cookie survives (sessions are persisted) — reconnect sees the honest state
  const j = await waitFor(async () => {
    const x = await jobById(job.id);
    return x && x.state === 'failed' ? x : null;
  }, 8000, 'interrupted job marked failed');
  assert.match(j.error, /Neustart/);
  const listAfterCrash = await convs();
  assert.ok(!listAfterCrash.conversations[0].messages.find(m => m.id === job.messageId).render, 'no silent stuck building');
  // retry: explicit, cheap, no automatic double provider charge
  const r = await api('/api/jobs/retry', { method: 'POST', body: { jobId: job.id } });
  assert.equal(r.status, 200);
  await waitFor(async () => (await jobById(job.id)) === null, 8000, 'retried job ready');
  const list = await convs();
  const msg = list.conversations[0].messages.find(m => m.id === job.messageId);
  assert.ok(msg.render, 'retry attaches exactly one element');
  const msgs = list.conversations[0].messages.filter(m => m.render);
  assert.equal(msgs.filter(m => m.id === job.messageId).length, 1, 'exactly one element for the retried job');
  const callsAfter = (await mockStats()).calls.slowbuild || 0;
  assert.equal(callsAfter, callsBefore + 1, 'restart+retry caused NO additional provider call');
});

test('teardown', async () => {
  await stopServer();
  for (const p of [modelsFile]) { try { fs.rmSync(p, { force: true }); } catch {} }
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});
