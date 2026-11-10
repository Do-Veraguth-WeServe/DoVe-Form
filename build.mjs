import { build } from 'esbuild';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';

fs.mkdirSync('dist', { recursive: true });
let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes('</body>')) throw Error('index.html: </body> missing');
html = html.replace('</body>', '<script type="module" src="/app.js"></script></body>');
fs.writeFileSync('dist/index.html', html);

await build({ entryPoints: ['src/app.js', 'src/worker.js', 'src/animation-verification.js'], bundle: true, outdir: 'dist', format: 'esm', platform: 'browser', minify: false });

// Extract the sandbox bridge function and hash it for the page CSP
// (the srcdoc iframe inherits the parent CSP, so the trusted bootstrap
// needs an explicit sha256 allowance).
const bundled = fs.readFileSync('dist/app.js', 'utf8');
const a = bundled.indexOf('function bridge(');
const b = bundled.indexOf('function renderUI(');
if (a === -1 || b === -1 || b <= a) throw Error('bridge extraction failed');
const source = bundled.slice(a, b).trim();
const inputStart = bundled.indexOf('function installScrollInput(');
if(inputStart<0)throw Error('scroll input extraction failed');
const inputSource = bundled.slice(inputStart,bundled.indexOf('\n}',inputStart)+2);
const input = vm.runInNewContext('('+inputSource+')');
const fn = vm.runInNewContext('(' + source + ')');
fs.writeFileSync('dist/bridge-hash.txt', crypto.createHash('sha256').update('(' + fn.toString() + ')(' + input.toString() + ');').digest('base64'));

const wasm = 'node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm';
if (fs.existsSync(wasm)) fs.copyFileSync(wasm, 'dist/quickjs.wasm');
else if (!fs.existsSync('dist/quickjs.wasm')) throw Error('quickjs wasm missing — run npm ci first');
for (const f of ['manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png','assetlinks.json']) fs.copyFileSync('assets/'+f,'dist/'+f);
console.log('build ok: dist/');
