// Build: derives the production shell from demo/index.html, bundles browser
// entry points, and writes the CSP bridge hash that server.mjs serves.
// NOTE: dist/app.js + dist/bridge-hash.txt must always be deployed together
// with server/server.mjs (the hash pins the only native JS allowed by CSP).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });

// V2 shell = v1 demo markup with live-mode labels. The original demo file
// itself stays untouched under demo/ (served separately as /form-demo).
let html = fs
  .readFileSync(path.join(root, 'demo/index.html'), 'utf8')
  .split('<script>')[0];
html = html
  .replace('Keine KI verbunden. Keine Cloud-Synchronisation.', 'Eigener Form-Agent · keine Systemwerkzeuge.')
  .replace('INTERAKTIVE DEMO', 'FORM / LIVE')
  .replace('FORM / LAB 001', 'FORM / LAB 002')
  .replace('Interaktive Antworten, keine echten Aktionen', 'Aktuelle Interaktionswerte werden nur beim Senden übertragen');
fs.writeFileSync(
  path.join(dist, 'index.html'),
  html + '<script type="module" src="/form/app.js"></script></body></html>'
);

const common = { bundle: true, format: 'esm', platform: 'browser', minify: false };
// Explicit outfiles: server.mjs serves exactly /form/app.js and /form/worker.js.
await build({ ...common, entryPoints: [path.join(root, 'src/app/main.js')], outfile: path.join(dist, 'app.js') });
await build({ ...common, entryPoints: [path.join(root, 'src/sandbox/worker.js')], outfile: path.join(dist, 'worker.js') });

// Bridge hash: the single trusted native function, hashed from the bundle so
// the CSP 'sha256-' entry always matches the shipped code.
const bundled = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
const source = bundled.slice(bundled.indexOf('function bridge()'), bundled.indexOf('function renderUI(')).trim();
const fn = vm.runInNewContext('(' + source + ')');
fs.writeFileSync(
  path.join(dist, 'bridge-hash.txt'),
  crypto.createHash('sha256').update('(' + fn.toString() + ')();').digest('base64')
);

fs.copyFileSync(
  path.join(root, 'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm'),
  path.join(dist, 'quickjs.wasm')
);
