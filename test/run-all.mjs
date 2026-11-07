// Test orchestrator: build -> unit -> (mock + server) -> api -> browser.
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.TEST_PORT || '4598';
const MOCK_PORT = process.env.TEST_MOCK_PORT || '4599';
const BASE = `http://127.0.0.1:${PORT}`;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const failed = [];
const step = (name, okFlag) => { console.log(okFlag ? '✅' : '❌', name); if (!okFlag) failed.push(name); };

const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
  return r.status === 0;
};

const waitReady = (proc, tag, pattern = /ready/) => new Promise((resolve, reject) => {
  let out = '';
  const t = setTimeout(() => reject(Error(tag + ' did not become ready')), 20000);
  proc.stdout.on('data', d => { out += d; if (pattern.test(out)) { clearTimeout(t); resolve(); } });
  proc.on('exit', code => { clearTimeout(t); reject(Error(tag + ' exited early (' + code + ')')); });
});

step('build (esbuild + bridge hash + wasm)', run('node', ['build.mjs']));
step('private/shared providers, admin users, deletion and browser account isolation',run('node',['test/accounts.test.mjs']));
step('sidebar scrolling with delete controls',run('node',['test/sidebar-layout.test.mjs']));
step('provider ACL and public network boundaries',run('node',['--test','test/model-access.test.mjs']));
step('standalone MCP + agent loop + approvals', run('node', ['--test', 'test/mcp.test.mjs', 'test/agent-loop.test.mjs', 'test/tool-execution.test.mjs', 'test/memory.test.mjs', 'test/element-actions.test.mjs', 'test/http-tools.test.mjs']));
step('realtime game loop and inputs', run('node', ['test/flappy.test.mjs']));
step('saved calendars + dynamic table sanitizer', run('node', ['test/calendar.test.mjs']));
step('zero-setup public API elements + restart', run('node', ['--test','test/auto-api.test.mjs']));
step('MCP browser approval roundtrip', run('node', ['--test', 'test/mcp-e2e.test.mjs']));
step('unit tests (contract, stream parser, models, QuickJS sandbox)', run('node', ['--test', 'test/unit.test.mjs']));
step('provider transport tests (truncation, error frames, caps, abort/timeout)', run('node', ['--test', 'test/provider.test.mjs']));

const modelsFile = path.join(os.tmpdir(), `form3-test-models-${Date.now()}.json`);
const dataDir = path.join(os.tmpdir(), `form3-test-data-${Date.now()}`);
const dataDir2 = path.join(os.tmpdir(), `form3-test-browser-data-${Date.now()}`);
try { fs.rmSync(modelsFile, { force: true }); } catch {}
const mock = spawn('node', ['test/mock-provider.mjs'], { cwd: root, env: { ...process.env, MOCK_PORT }, stdio: ['ignore', 'pipe', 'inherit'] });
const server = spawn('node', ['server.mjs'], { cwd: root, env: { ...process.env, PORT, FORM3_MODELS: modelsFile, FORM3_DATA: dataDir, FORM3_PING_FIXTURE: '1', FORM3_DB_RATE: '600', FORM3_REGISTRATION: '1', FORM3_JOB_CONCURRENCY: '2' }, stdio: ['ignore', 'pipe', 'inherit'] });
let apiOk = false, browserOk = false;
try {
  await waitReady(mock, 'mock provider');
  await waitReady(server, 'dev server');
  apiOk = run('node', ['--test', 'test/api.test.mjs'], { BASE_URL: BASE, MOCK_URL: MOCK, MODELS_FILE: modelsFile });
  step('api tests (auth, scoping, models, SSE, retry, stop, CSRF, ui.db, jobs)', apiOk);
  const jobsOk = run('node', ['--test', 'test/jobs.test.mjs'], { BASE_URL: BASE, MOCK_URL: MOCK });
  step('jobs tests (background builds, reverse order, cancel, delete race, restart)', jobsOk);
  // browser suite gets its OWN server + fresh data dir so its first
  // registration is the owner (api tests already claimed that role)
  server.kill('SIGTERM');
  const modelsFile2 = modelsFile + '.browser';
  const server2 = spawn('node', ['server.mjs'], { cwd: root, env: { ...process.env, PORT, FORM3_MODELS: modelsFile2, FORM3_DATA: dataDir2, FORM3_PING_FIXTURE: '1', FORM3_DB_RATE: '600', FORM3_REGISTRATION: '1', FORM3_JOB_CONCURRENCY: '2' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await waitReady(server2, 'browser server');
    browserOk = run('node', ['test/browser.test.cjs'], { BASE_URL: BASE, MOCK_URL: MOCK });
  } finally { server2.kill('SIGTERM'); }
  step('browser tests (login, streaming UX, artifact, ui.db, boundary, isolation, mobile)', browserOk);
} catch (e) {
  console.error('orchestration error:', e.message);
  failed.push('orchestration: ' + e.message);
} finally {
  mock.kill('SIGTERM');
  server.kill('SIGTERM');
  try { fs.rmSync(modelsFile, { force: true }); } catch {}
  try { fs.rmSync(modelsFile + '.browser', { force: true }); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(dataDir2, { recursive: true, force: true }); } catch {}
}
if (failed.length) { console.error('\nFAILED:', failed.join(' | ')); process.exit(1); }
console.log('\nALL TEST SUITES PASSED');
