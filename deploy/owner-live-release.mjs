import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {execFileSync} from 'node:child_process';
const target='/opt/form',rollback=target+'/.rollback/20261110-owner-live-ready';
const files=['server.mjs','db.mjs','owner-stream.mjs','src/app.js','src/owner-subscription.js','src/owner-live-view.js','src/owner-db-ack.js','src/job-snapshot.js','dist/app.js','docs/OWNER-LIVE-SYNC.md','test/owner-live-browser.mjs','test/owner-initial-browser.mjs','test/owner-stream-http.mjs','test/owner-stream.test.mjs','test/owner-subscription.test.mjs','test/owner-db-ack.test.mjs','test/owner-persistence-browser.mjs','test/job-snapshot.test.mjs','test/snapshot-stability.test.mjs','test/browser-core.test.mjs','test/run-all.mjs'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const idle=()=>{const db=new DatabaseSync(target+'/data/form.db',{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) n FROM jobs WHERE state NOT IN (?,?,?)').get('ready','failed','cancelled').n,0,'Active jobs block restart');}finally{db.close();}};
const verifierHash=hash(target+'/dist/animation-verification.js');
for(const f of ['bridge-hash.txt','worker.js'])assert.equal(hash('dist/'+f),hash(target+'/dist/'+f),'unchanged boundary '+f);
assert.match(fs.readFileSync('docs/test-results/2026-11-10-job-shape-core-after.txt','utf8'),/PASS browser-core: 24 checks/);
assert.match(fs.readFileSync('docs/test-results/2026-11-10-owner-release-final.txt','utf8'),/PASS owner state sync/);
assert.ok(!fs.existsSync(rollback),'Existing release must be reconciled');idle();fs.mkdirSync(rollback,{mode:0o700});
const prior=[];for(const file of files){const dst=target+'/'+file;if(fs.existsSync(dst)){fs.mkdirSync(path.dirname(rollback+'/'+file),{recursive:true,mode:0o700});fs.copyFileSync(dst,rollback+'/'+file);prior.push(file);}}
fs.copyFileSync(target+'/.pm2/dump.pm2',rollback+'/pm2-dump.json');fs.chmodSync(rollback+'/pm2-dump.json',0o600);
fs.writeFileSync(rollback+'/manifest.json',JSON.stringify({files,prior},null,2));
const owner=fs.statSync(target+'/dist/app.js');
const restart=()=>execFileSync('su',['-','form','-c','pm2 restart form && pm2 save'],{stdio:'pipe'});
idle();
try{
 for(const file of files){const dst=target+'/'+file;fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(file,dst+'.new');fs.chownSync(dst+'.new',owner.uid,owner.gid);fs.chmodSync(dst+'.new',0o644);fs.renameSync(dst+'.new',dst);assert.equal(hash(file),hash(dst));}
 idle();restart();
 let ready=false;for(let attempt=0;attempt<20;attempt++){try{ready=(await fetch('http://127.0.0.1:5177/api/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'service startup deadline');
 for(const base of ['http://127.0.0.1:5177','https://fhisling.tail11036c.ts.net:9444']){
  const home=await fetch(base);assert.equal(home.status,200);assert.ok(home.headers.get('content-security-policy').includes(fs.readFileSync('dist/bridge-hash.txt','utf8').trim()));assert.equal((await fetch(base+'/api/health')).status,200);assert.equal((await fetch(base+'/api/elements/owner/view?id=nonexistent')).status,401);
  const app=await fetch(base+'/app.js');assert.equal(app.status,200);assert.equal(crypto.createHash('sha256').update(Buffer.from(await app.arrayBuffer())).digest('hex'),hash('dist/app.js'));
 }
 assert.equal(hash(target+'/dist/animation-verification.js'),verifierHash,'installed verifier preserved');
 const result={ok:true,rollback,restart:true,files:Object.fromEntries(files.map(f=>[f,hash(f)])),proof:'three idle checkpoints; exact served bundle; unchanged bridge/worker/verifier; dual-route home/CSP/health/auth'};
 fs.writeFileSync(target+'/owner-live-release.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){idle();for(const file of prior){const dst=target+'/'+file;fs.copyFileSync(rollback+'/'+file,dst+'.rollback');fs.chownSync(dst+'.rollback',owner.uid,owner.gid);fs.renameSync(dst+'.rollback',dst);}restart();throw error;}
