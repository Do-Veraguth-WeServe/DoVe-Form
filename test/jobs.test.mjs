// Server-owned generation jobs — the PROVIDER CALL itself must run detached
// from any HTTP connection. All acceptance flows below hold the mock
// provider's SSE open (nothing/postponed artifact) and steer it via
// POST /admin/release — no synthetic post-render delays anywhere.
// Env: MOCK_URL from run-all; this file spawns/stops its own server.
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
  const proc = spawn('node', ['server.mjs'], {
    cwd: process.env.FORM_TEST_ROOT || root,
    env: {
      ...process.env, PORT,
      FORM3_DATA: dataDir, FORM3_MODELS: modelsFile,
      FORM3_REGISTRATION: '1', FORM3_JOB_CONCURRENCY: '2',
      FORM3_ORIGIN: BASE
    },
    stdio: ['ignore', 'pipe', 'inherit']
  });
  return proc;
}
const waitReady = proc => new Promise((resolve, reject) => {
  let out = '';
  const t = setTimeout(() => reject(Error('server not ready')), 20000);
  proc.stdout.on('data', d => { out += d; if (/ready/.test(out)) { clearTimeout(t); resolve(); } });
  proc.on('exit', code => { clearTimeout(t); reject(Error('server exited early: ' + code)); });
});
const stopServer = () => new Promise(resolve => {
  const proc = server; // capture NOW — `server` is reassigned on restart; a
  // late fallback must never kill the NEW process (that was this test's bug)
  if (!proc) return resolve();
  proc.on('exit', resolve);
  proc.kill('SIGTERM');
  const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} resolve(); }, 5000);
  proc.on('exit', () => clearTimeout(t));
});

let cookie = '', csrf = '', convId = '';
async function register() {
  const r = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ username: 'jobsowner', password: 'password123456' })
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
// start a chat and consume its SSE until `until(event)` fires (or 'done');
// returns { events, detach } where detach closes the connection like a
// reload / tab close would.
async function chatStream(text, { until = () => false, refineTarget, mode = 'chat' } = {}) {
  const r = await api('/api/chat', {
    method: 'POST',
    body: { version: 1, mode, sessionId: convId, requestId: uid(), text, history: [], states: [], ...(refineTarget ? { refineTarget } : {}) }
  });
  assert.equal(r.status, 200, 'chat accepted');
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  const events = [];
  let buf = '', stopped = false;
  const pump = async () => {
    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          let event = 'message', data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (data) {
            let parsed = {}; try { parsed = JSON.parse(data); } catch {}
            events.push({ event, data: parsed });
            if (event === 'done' || until(parsed, event)) return;
          }
        }
      }
    } catch { /* detached */ }
  };
  return {
    events,
    finished: pump(),
    detach() { stopped = true; void reader.cancel().catch(()=>{}); }
  };
}
// Exercise the real plan -> explicit approval -> durable build protocol.
async function approvedBuild(text) {
  const before = (await convs()).conversations.find(c => c.id === convId).messages.filter(m => m.render).length;
  const plan = await chatStream(text, {mode:'plan'}); await plan.finished;
  assert.ok(!plan.events.some(e => e.event === 'error'), 'planning succeeds');
  const conversation = (await convs()).conversations.find(c => c.id === convId);
  assert.equal(conversation.messages.filter(m => m.render).length, before, 'planning does not build');
  const bp = conversation.blueprint;
  assert.ok(bp?.ready && !bp.executedJobId, 'fresh unexecuted plan ready');
  const stream = await api('/api/jobs/stream');
  assert.equal(stream.status,200);
  const reader=stream.body.getReader(), dec=new TextDecoder(), events=[];
  let stopped=false;
  const detach=()=>{stopped=true;void reader.cancel().catch(()=>{});};
  const started=await api('/api/blueprints/execute',{method:'POST',body:{sessionId:convId,blueprintId:bp.id,revision:bp.revision}});
  assert.equal(started.status,200,'explicit revision-bound approval accepted');
  const {job}=await started.json();events.push({event:'element-job',data:{job}});
  const finished=(async()=>{
    let buf='';
    try{while(!stopped){
      const {done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});let index;
      while((index=buf.indexOf('\n\n'))!==-1){
        const block=buf.slice(0,index);buf=buf.slice(index+2);
        const lines=block.split('\n'),kind=lines.find(l=>l.startsWith('event:'))?.slice(6).trim();
        const data=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('');
        if(kind!=='job'||!data)continue;
        const observed=JSON.parse(data);if(observed.id!==job.id)continue;
        events.push({event:'element-job',data:{job:observed}});
        if(observed.phase==='artifact')events.push({event:'artifact-start',data:{}});
        if(['ready','failed','cancelled'].includes(observed.state))return;
      }
    }}finally{detach();}
  })();
  return {events,finished,detach};
}
const jobOf = events => events.find(e => e.event === 'element-job')?.data.job;
const mockStats = async () => (await (await fetch(MOCK + '/admin/stats')).json());
const release = async group => (await (await fetch(MOCK + '/admin/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group }) })).json());
const jobsSnap = async () => (await (await api('/api/jobs')).json());
const convs = async () => (await (await api('/api/conversations')).json());
const jobById = async id => (await jobsSnap()).jobs.find(j => j.id === id) || null;
async function waitFor(pred, timeout = 12000, what = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const v = await pred();
    if (v) return v;
    await sleep(80);
  }
  throw Error('timeout waiting for ' + what);
}
async function waitJobsSettled(timeout = 15000) {
  return waitFor(async () => {
    const s = await jobsSnap();
    return !s.jobs.some(j => ['queued', 'building', 'validating'].includes(j.state)) ? s : null;
  }, timeout, 'jobs settled');
}

test('setup: dedicated server, owner, model, conversation', async () => {
  server = startServer();
  await waitReady(server);
  await register();
  const m = await api('/api/models', { method: 'POST', body: { label: 'Mock', baseUrl: MOCK + '/v1', model: 'mock-model', apiKey: KEY } });
  assert.equal(m.status, 200);
  const c = await api('/api/conversations', { method: 'POST', body: '{}' });
  convId = (await c.json()).conversation.id;
});

test('(1) second chat answers while the FIRST provider response is still streaming', async () => {
  const first = await chatStream('erste antwort holdprose bitte');
  await waitFor(() => first.events.some(e => e.event === 'element-job'), 8000, 'element-job');
  await waitFor(async()=>((await mockStats()).active.holdprose||0)>=1,8000,'first chat provider connected');
  const st0 = await mockStats();
  assert.ok((st0.active.holdprose || 0) >= 1, 'first provider connection is OPEN (held)');
  // the chat turn returned; a second message must be accepted AND answered now
  const second = await chatStream('Erkläre mir kurz, was ein VPN macht');
  await second.finished;
  assert.ok(second.events.some(e => e.event === 'prose-chunk'), 'second answer streams');
  assert.ok(second.events.at(-1).event === 'done', 'second answer COMPLETED');
  const st1 = await mockStats();
  assert.ok((st1.active.holdprose || 0) >= 1, 'first upstream STILL active while second finished');
  // release the first: prose-only turn completes and persists
  await release('holdprose');
  await first.finished;
  await waitJobsSettled();
  const list = await convs();
  const firstJob = jobOf(first.events);
  const msg = list.conversations[0].messages.find(m => m.id === firstJob.messageId);
  assert.ok(msg.prose && msg.prose.includes('Virtual Private Network'), 'prose-only result persisted without any artifact');
  assert.ok(!msg.render, 'no element for a prose-only turn');
  const st2 = await mockStats();
  assert.equal(st2.active.holdprose, 0, 'held upstream closed after release');
});

test('(2) closing the connection (tab close) does NOT abort the provider; result persists with zero subscribers', async () => {
  const callsBefore = (await mockStats()).calls.sitehold || 0;
  const discBefore = (await mockStats()).disconnects;
  const s = await approvedBuild('baue ein element sitehold bitte');
  // wait until the artifact phase is live (fence seen by the parser)
  await waitFor(async () => {
    const ev = s.events.find(e => e.event === 'element-job');
    return ev && (ev.data.job.phase === 'artifact' || s.events.some(e => e.event === 'artifact-start'));
  }, 8000, 'artifact phase');
  s.detach(); // tab close / reload: connection gone
  await sleep(1000);
  let st = await mockStats();
  assert.ok((st.active.sitehold || 0) >= 1, 'upstream STILL streaming after the client detached');
  assert.equal(st.disconnects, discBefore, 'provider saw NO disconnect');
  await release('sitehold');
  await waitJobsSettled();
  st = await mockStats();
  assert.equal(st.calls.sitehold, callsBefore + 1, 'exactly ONE provider call');
  const list = await convs();
  const job = s.events.length ? jobOf(s.events) : null;
  assert.ok(job, 'job id known');
  const msg = list.conversations[0].messages.find(m => m.id === job.messageId);
  assert.ok(msg.render, 'element persisted although no browser was attached');
  assert.equal(msg.render.name, 'Baustellen-Element');
  assert.equal(list.conversations[0].messages.filter(m => m.render?.name === 'Baustellen-Element').length, 1, 'exactly ONE element');
});

test('(3) reload during the upstream stream: same job, completion lands exactly once', async () => {
  const s = await approvedBuild('nochmal sitehold element bauen');
  await waitFor(() => s.events.some(e => e.event === 'element-job'), 8000, 'job created');
  const jobId = jobOf(s.events).id;
  // reload DURING the artifact stream: wait until the fence has been parsed
  await waitFor(async () => (await jobById(jobId))?.phase === 'artifact', 8000, 'artifact phase before reload');
  s.detach(); // reload
  const snap = await waitFor(async () => {
    const j = await jobById(jobId);
    return j && ['queued', 'building', 'validating'].includes(j.state) ? j : null;
  }, 8000, 'job visible after reload');
  assert.equal(snap.id, jobId, 'SAME job id after reload');
  assert.equal(snap.phase, 'artifact', 'honest artifact phase restored');
  await release('sitehold');
  await waitFor(async () => (await jobById(jobId)) === null, 12000, 'job ready');
  const list = await convs();
  const msgs = list.conversations[0].messages.filter(m => m.render?.name === 'Baustellen-Element');
  assert.equal(msgs.length, 2, 'both sitehold elements present, no duplicates from the reload');
});

test('(4) explicit cancel DOES abort the upstream provider call', async () => {
  const discBefore = (await mockStats()).disconnects;
  const s = await chatStream('dieses holdprose element abbrechen');
  await waitFor(() => s.events.some(e => e.event === 'element-job'), 8000, 'job created');
  const job = jobOf(s.events);
  await waitFor(async () => ((await mockStats()).active.holdprose || 0) >= 1, 8000, 'provider connected before cancel');
  const c = await api('/api/jobs/cancel', { method: 'POST', body: { jobId: job.id } });
  assert.equal(c.status, 200);
  s.detach();
  await sleep(800);
  const st = await mockStats();
  assert.ok(st.disconnects > discBefore, `cancel aborted the upstream (${discBefore} -> ${st.disconnects})`);
  assert.equal(st.active.holdprose || 0, 0, 'no held stream left');
  const j = await jobById(job.id);
  assert.equal(j.state, 'cancelled');
  const list = await convs();
  const msg = list.conversations[0].messages.find(m => m.id === job.messageId);
  assert.equal(msg.error, 'Abgebrochen.', 'honest cancellation on the message');
  assert.ok(!msg.render);
  // retry is only for failed jobs
  assert.equal((await api('/api/jobs/retry', { method: 'POST', body: { jobId: job.id } })).status, 409);
});

test('(5) reverse provider completion: two held jobs land on their own containers', async () => {
  const a = await approvedBuild('erstes element holda');
  await waitFor(() => a.events.some(e => e.event === 'element-job'), 8000, 'job A');
  const b = await approvedBuild('zweites element holdb');
  await waitFor(() => b.events.some(e => e.event === 'element-job'), 8000, 'job B');
  await waitFor(async () => {const st=await mockStats();return (st.active.holda||0)>=1&&(st.active.holdb||0)>=1;},8000,'both provider connections open');
  const st = await mockStats();
  assert.ok((st.active.holda || 0) >= 1 && (st.active.holdb || 0) >= 1, 'BOTH upstreams open concurrently (bounded parallel generation)');
  const jobA = jobOf(a.events), jobB = jobOf(b.events);
  assert.notEqual(jobA.id, jobB.id);
  await release('holdb'); // second finishes FIRST
  await waitFor(async () => (await jobById(jobB.id)) === null, 12000, 'B ready');
  const stMid = await mockStats();
  assert.ok((stMid.active.holda || 0) >= 1, 'A still streaming after B completed');
  await release('holda');
  await waitJobsSettled();
  const list = await convs();
  const find = id => list.conversations[0].messages.find(m => m.id === id);
  assert.equal(find(jobA.messageId).render.name, 'Baustellen-Element', 'A landed on A container');
  assert.equal(find(jobB.messageId).render.name, 'Zweites Element', 'B landed on B container');
  const idxA = list.conversations[0].messages.findIndex(m => m.id === jobA.messageId);
  const idxB = list.conversations[0].messages.findIndex(m => m.id === jobB.messageId);
  assert.ok(idxA < idxB, 'conversation order preserved regardless of completion order');
});

test('deletion race: conversation deleted while the provider streams — nothing resurrects', async () => {
  const s = await approvedBuild('sitehold im gleich geloeschten gespraech');
  await waitFor(() => s.events.some(e => e.event === 'element-job'), 8000, 'job created');
  s.detach();
  const del = await api('/api/conversations/' + convId, { method: 'DELETE' });
  assert.equal(del.status, 200);
  await release('sitehold');
  await sleep(1500);
  const list = await convs();
  assert.equal(list.conversations.length, 0, 'conversation stays deleted');
  assert.equal((await jobsSnap()).jobs.length, 0, 'job rows cascade-deleted');
  const health = await (await fetch(BASE + '/api/health')).json();
  assert.equal(health.ok, true, 'server healthy after the race');
  const c = await api('/api/conversations', { method: 'POST', body: '{}' });
  convId = (await c.json()).conversation.id;
});

test('server restart honestly fails running provider jobs; explicit retry MAY re-call the provider and then succeeds', async () => {
  const callsBefore = (await mockStats()).calls.sitehold || 0;
  const s = await approvedBuild('sitehold ueber den neustart');
  await waitFor(() => s.events.some(e => e.event === 'element-job'), 8000, 'job created');
  const job = jobOf(s.events);
  await waitFor(async () => ((await mockStats()).calls.sitehold || 0) === callsBefore + 1, 8000, 'first provider connected before restart');
  s.detach();
  await stopServer();
  await sleep(500); // let the listener socket settle before rebinding
  server = startServer();
  await waitReady(server);
  const j = await waitFor(async () => {
    const x = await jobById(job.id);
    return x && x.state === 'failed' ? x : null;
  }, 8000, 'interrupted job marked failed');
  assert.match(j.error, /Neustart/);
  const r = await api('/api/jobs/retry', { method: 'POST', body: { jobId: job.id } });
  assert.equal(r.status, 200);
  // retry re-runs the generation from the snapshot -> a NEW provider call
  // (disclosed behaviour, never silent)
  await waitFor(async () => ((await mockStats()).calls.sitehold || 0) === callsBefore + 2, 8000, 'retry called the provider again');
  await release('sitehold');
  await waitFor(async () => (await jobById(job.id)) === null, 12000, 'retried job ready');
  const list = await convs();
  const msg = list.conversations[0].messages.find(m => m.id === job.messageId);
  assert.ok(msg.render, 'retry produced the element');
  assert.equal(msg.render.name, 'Baustellen-Element');
});

test('approved build cancellation aborts the connected provider and never publishes', async()=>{
  const before=(await mockStats()).disconnects;
  const s=await approvedBuild('sitehold explicit build cancellation');
  const job=jobOf(s.events);
  await waitFor(async()=>((await jobById(job.id))?.phase==='artifact')&&((await mockStats()).active.sitehold||0)>=1,8000,'approved build upstream open');
  assert.equal((await api('/api/jobs/cancel',{method:'POST',body:{jobId:job.id}})).status,200);
  await s.finished;
  await waitFor(async()=>(await mockStats()).disconnects>before,8000,'approved build upstream disconnected');
  assert.equal((await jobById(job.id)).state,'cancelled');
  assert.ok(!(await convs()).conversations.find(c=>c.id===convId).messages.find(m=>m.id===job.messageId).render);
  assert.equal((await api('/api/jobs/retry',{method:'POST',body:{jobId:job.id}})).status,409);
});

test('ownership: a foreign user never sees or touches the job', async () => {
  const s = await chatStream('holdprose fremdzugriff');
  await waitFor(() => s.events.some(e => e.event === 'element-job'), 8000, 'job created');
  const job = jobOf(s.events);
  // register a second user (registration stays open via env in this server)
  const r2 = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ username: 'jobsstranger', password: 'password123456' })
  });
  assert.equal(r2.status, 200);
  const strangerCsrf=(await r2.json()).csrf;
  const m2 = (r2.headers.get('set-cookie') || '').match(/form3sess=([^;]+)/);
  const stranger = 'form3sess=' + m2[1];
  const snap = await fetch(BASE + '/api/jobs', { headers: { Cookie: stranger } }).then(x => x.json());
  assert.ok(!snap.jobs.some(x => x.id === job.id), "stranger's snapshot lacks the owner's job");
  const cancel = await fetch(BASE + '/api/jobs/cancel', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: stranger, 'X-Form-CSRF': strangerCsrf, Origin: BASE },
    body: JSON.stringify({ jobId: job.id })
  });
  assert.equal(cancel.status,404,'authenticated stranger with valid CSRF cannot cancel foreign job');
  await api('/api/jobs/cancel', { method: 'POST', body: { jobId: job.id } }); // cleanup
  s.detach();
});

test('teardown', async () => {
  await stopServer();
  try { fs.rmSync(modelsFile, { force: true }); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});
