import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
const target='/opt/form',rollback=target+'/.rollback/20261110-entry-settling';
const files=['src/session-entry.js','src/app.js','dist/app.js','docs/SESSION-ENTRY.md','test/session-entry.test.mjs'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const idle=()=>{const d=new DatabaseSync(target+'/data/form.db',{readOnly:true});try{assert.equal(d.prepare('SELECT count(*) n FROM jobs WHERE state NOT IN (?,?,?)').get('ready','failed','cancelled').n,0,'active jobs');}finally{d.close();}};
assert.equal(hash(target+'/dist/app.js'),'a6ce192782b5bc23c2cdd60b69590bacacc61a22ddd3683806cc7a9c5c326ca1','installed bundle drift');
assert.equal(hash('dist/bridge-hash.txt'),hash(target+'/dist/bridge-hash.txt'),'CSP bridge unchanged');
assert.match(fs.readFileSync('docs/test-results/2026-11-10-session-entry-scoped.txt','utf8'),/PASS session entry desktop/);
const core=fs.readFileSync('docs/test-results/2026-11-10-entry-core.txt','utf8');assert.ok(!/AssertionError|TimeoutError/.test(core));assert.match(core,/PASS browser-core: 24 checks/);
idle();assert.ok(!fs.existsSync(rollback),'reconcile existing rollback');fs.mkdirSync(rollback,{mode:0o700});const owner=fs.statSync(target+'/dist/app.js');for(const f of files){fs.mkdirSync(path.dirname(rollback+'/'+f),{recursive:true,mode:0o700});fs.copyFileSync(target+'/'+f,rollback+'/'+f);}
const unchanged=['dist/index.html','dist/worker.js','dist/animation-verification.js','server.mjs'].map(f=>[f,hash(target+'/'+f)]);
idle();for(const f of files){const dst=target+'/'+f;fs.copyFileSync(f,dst+'.new');fs.chownSync(dst+'.new',owner.uid,owner.gid);fs.chmodSync(dst+'.new',0o644);fs.renameSync(dst+'.new',dst);}
for(const base of ['http://127.0.0.1:5177','https://form.dove-it.net','https://fhisling.tail11036c.ts.net:9444']){assert.equal((await fetch(base+'/api/health')).status,200);const home=await fetch(base);assert.equal(home.status,200);assert.ok(home.headers.get('content-security-policy').includes(fs.readFileSync('dist/bridge-hash.txt','utf8').trim()));assert.equal((await fetch(base+'/api/elements/grants')).status,401);assert.equal((await(await fetch(base+'/api/auth/status')).json()).registration,false);assert.equal(crypto.createHash('sha256').update(Buffer.from(await(await fetch(base+'/app.js')).arrayBuffer())).digest('hex'),hash('dist/app.js'));}
for(const [f,h]of unchanged)assert.equal(hash(target+'/'+f),h);
const result={ok:true,rollback,appSha256:hash('dist/app.js'),files,proof:'idle twice; frontend only; loopback and both public routes exact app hash, health, CSP, anonymous denial, registration closed; no restart or user-data changes'};fs.writeFileSync(target+'/entry-settling-release.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
