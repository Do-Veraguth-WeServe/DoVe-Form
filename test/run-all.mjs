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
step('unit tests (contract, stream parser, models, QuickJS sandbox)', run('node', ['--test', 'test/unit.test.mjs']));

const modelsFile = path.join(os.tmpdir(), `form3-test-models-${Date.now()}.json`);
try { fs.rmSync(modelsFile, { force: true }); } catch {}
const mock = spawn('node', ['test/mock-provider.mjs'], { cwd: root, env: { ...process.env, MOCK_PORT }, stdio: ['ignore', 'pipe', 'inherit'] });
const server = spawn('node', ['server.mjs'], { cwd: root, env: { ...process.env, PORT, FORM3_MODELS: modelsFile, FORM3_PING_FIXTURE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let apiOk = false, browserOk = false;
try {
  await waitReady(mock, 'mock provider');
  await waitReady(server, 'dev server');
  apiOk = run('node', ['--test', 'test/api.test.mjs'], { BASE_URL: BASE, MOCK_URL: MOCK, MODELS_FILE: modelsFile });
  step('api tests (models, masking, SSE streaming, retry, stop, CSRF)', apiOk);
  browserOk = run('node', ['test/browser.test.cjs'], { BASE_URL: BASE, MOCK_URL: MOCK });
  step('browser tests (empty state, streaming UX, artifact, boundary, mobile)', browserOk);
} catch (e) {
  console.error('orchestration error:', e.message);
  failed.push('orchestration: ' + e.message);
} finally {
  mock.kill('SIGTERM');
  server.kill('SIGTERM');
  try { fs.rmSync(modelsFile, { force: true }); } catch {}
}
if (failed.length) { console.error('\nFAILED:', failed.join(' | ')); process.exit(1); }
console.log('\nALL TEST SUITES PASSED');
