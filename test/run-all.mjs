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

step('revision-bound static CSS evidence',run('node',['--test','test/reply-evidence.test.mjs','test/element-diagnostics.test.mjs','test/element-context.test.mjs']));
step('guided planning metadata',run('node',['--test','test/planning-offer.test.mjs','test/planning-offer-state.test.mjs']));
step('build (esbuild + bridge hash + wasm)', run('node', ['build.mjs']));
step('current-contract browser core (login, settings, approval, streaming, persistence)',run('node',['test/browser-core.test.mjs']));
step('chat and plan activity transitions, reduced motion and cleanup',run('node',['test/activity.test.mjs']));
step('editor lifecycle (pin, overlay, version restore, sanitizer)',run('node',['test/editor-lifecycle.test.mjs']));
step('cross-conversation collection, state ownership and mobile surfaces',run('node',['test/collection-browser.test.mjs']));
step('approved in-place refinement browser',run('node',['test/refinement-browser.test.mjs']));
step('refinement transactional conflict and writer locking',run('node',['--test','test/refinement-cas.test.mjs']));
step('ping callback bridge (mocked success, denial, rate limit)',run('node',['test/ping-browser.test.mjs']));
step('real database CRUD bridge, scope, quotas and reload',run('node',['test/db-crud-browser.test.mjs']));
step('sandbox boundary, safe fragments and cache secrets',run('node',['test/sandbox-boundary-browser.test.mjs']));
step('initial static-only HTML preflight',run('node',['test/html-preflight.mjs']));
step('HTML removal diagnostics (bounded reasons, trusted desktop/mobile feedback)',run('node',['test/html-diagnostics.test.mjs']));
step('mixed SVG/HTML retention and sanitizer boundary',run('node',['test/mixed-svg-fragments.mjs']));
step('dynamic namespace-aware HTML diagnostics',run('node',['test/dynamic-html-diagnostics.mjs']));
step('scoped diagnostic chat browser',run('node',['test/element-diagnostics-browser.mjs']));
step('bounded live diagnostics transport',run('node',['--test','test/live-diagnostics.test.mjs']));
step('live diagnostic private-channel lifecycle',run('node',['test/live-diagnostics-renderer.mjs']));
step('live diagnostics HTTP boundaries',run('node',['test/live-diagnostics-http.mjs']));
step('explicit owner browser observation and chat provenance',run('node',['test/live-diagnostics-browser.mjs']));
step('contextual planning offer browser',run('node',['test/guided-planning.test.mjs']));
step('account-scoped conversation selection',run('node',['--test','test/session-selection.test.mjs']));
step('DB-dependent Element initialization and reload',run('node',['test/db-element-lifecycle.test.mjs']));
step('unchanged feed Elements survive real updates',run('node',['test/feed-stability.test.mjs']));
step('job snapshots preserve unchanged Element frames',run('node',['test/snapshot-stability.test.mjs']));
step('session entry bottom without submit movement',run('node',['test/session-entry.test.mjs']));
step('momentum bounds and teardown',run('node',['--test','test/feed-momentum.test.mjs']));
step('mobile Element flick momentum and cancellation',run('node',['test/element-momentum.test.mjs']));
step('navigation preserves background chat and plans',run('node',['test/navigation-jobs.test.mjs']));
step('shared element grants, stream and database revisions',run('node',['--test','test/element-sharing.test.mjs','test/element-stream.test.mjs','test/element-db-revision.test.mjs']));
step('shared element HTTP stream',run('node',['test/element-stream-http.mjs']));
step('shared element browser flow',run('node',['test/shared-elements-browser.mjs']));
step('shared HTML diagnostics and invalidation',run('node',['test/shared-html-diagnostics.mjs']));
step('unified settings and field layout',run('node',['test/settings-layout.test.mjs']));
step('session navigation preserves jobs',run('node',['test/navigation-jobs.test.mjs']));
step('private connection schema, vault, grants and SDK',run('node',['--test','test/connection-contract.test.mjs','test/connection-vault.test.mjs','test/connection-mcp.test.mjs','test/element-connections.test.mjs']));
step('private connection HTTP boundaries',run('node',['test/connection-http.test.mjs']));
step('element settings browser and sandbox',run('node',['test/connection-browser.test.mjs']));
step('owner receipt and missing animation declarations',run('node',['--test','test/owner-save-contract.test.mjs','test/animation-declaration.test.mjs']));
step('post-it persist has no remount or scroll jump',run('node',['test/postit-save-regression.mjs']));
step('animation verifier private transport',run('node',['--test','test/animation-verifier-client.test.mjs']));
step('provider budget and reasoning metadata',run('node',['--test','test/provider-budget.test.mjs']));
step('build recovery and animation correction',run('node',['--test','--test-concurrency=1','test/build-recovery.test.mjs']));
step('build failure UX',run('node',['test/build-recovery-browser.mjs']));
step('trusted bootstrap and unchanged guest execution budget',run('node',['test/worker-bootstrap-budget.mjs']));
step('observed animated startup dynamic HTML preflight',run('node',['test/animation-dynamic-html.mjs']));
step('initial animated HTML sanitizer preflight',run('node',['test/animation-html-preflight.mjs']));
step('animation schema and budgets',run('node',['--test','test/animation-policy.test.mjs']));
step('animation stack interaction and persistence recovery',run('node',['test/animation.test.mjs']));
step('isolated animation startup and declared-clip verifier',run('node',['test/animation-verification.test.mjs']));
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
try { fs.rmSync(modelsFile, { force: true }); } catch {}
const mock = spawn('node', ['test/mock-provider.mjs'], { cwd: root, env: { ...process.env, MOCK_PORT }, stdio: ['ignore', 'pipe', 'inherit'] });
const server = spawn('node', ['server.mjs'], { cwd: root, env: { ...process.env, PORT, FORM3_MODELS: modelsFile, FORM3_DATA: dataDir, FORM3_PING_FIXTURE: '1', FORM3_DB_RATE: '600', FORM3_REGISTRATION: '1', FORM3_JOB_CONCURRENCY: '2' }, stdio: ['ignore', 'pipe', 'inherit'] });
let apiOk = false;
try {
  await waitReady(mock, 'mock provider');
  await waitReady(server, 'dev server');
  apiOk = run('node', ['--test', 'test/api.test.mjs'], { BASE_URL: BASE, MOCK_URL: MOCK, MODELS_FILE: modelsFile });
  step('api tests (auth, scoping, models, SSE, retry, stop, CSRF, ui.db, jobs)', apiOk);
  const jobsOk = run('node', ['--test', 'test/jobs.test.mjs'], { BASE_URL: BASE, MOCK_URL: MOCK });
  step('jobs tests (background builds, reverse order, cancel, delete race, restart)', jobsOk);
  // Legacy browser.test.cjs retained as historical source; current-contract
  // coverage runs above. See docs/LEGACY-BROWSER-MAP.md.
} catch (e) {
  console.error('orchestration error:', e.message);
  failed.push('orchestration: ' + e.message);
} finally {
  mock.kill('SIGTERM');
  server.kill('SIGTERM');
  try { fs.rmSync(modelsFile, { force: true }); } catch {}
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
}
if (failed.length) { console.error('\nFAILED:', failed.join(' | ')); process.exit(1); }
console.log('\nALL TEST SUITES PASSED');
