import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {execFileSync} from 'node:child_process';
const target='/opt/form',rollback=target+'/.rollback/20261110-minimax-budget';
const files=['provider.mjs','contract.mjs','test/minimax-budget.test.mjs','test/css-preflight.test.mjs','test/run-all.mjs','docs/MINIMAX-OUTPUT-BUDGET.md'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const idle=()=>{const d=new DatabaseSync(target+'/data/form.db',{readOnly:true});try{assert.equal(d.prepare('SELECT count(*) n FROM jobs WHERE state NOT IN (?,?,?)').get('ready','failed','cancelled').n,0,'active jobs prohibit restart');}finally{d.close();}};
assert.equal(hash(target+'/provider.mjs'),'7dd25abca70a51f036c4ee352ae7df88dce87a506c5c71d953a535c03b53a3e7');
assert.equal(hash(target+'/contract.mjs'),'2ac89c8c50fd50d1ad6f30e7c716bef5267c908ec93890894dfe657c4ade90c1');
for(const name of ['gate','css-gate'])assert.match(fs.readFileSync('docs/test-results/2026-11-10-minimax-'+name+'.txt','utf8'),/fail 0/);
assert.match(fs.readFileSync('docs/test-results/2026-11-10-minimax-browser.txt','utf8'),/PASS browser-core: 24 checks/);
assert.ok(!fs.existsSync(rollback),'reconcile prior release before retry');idle();fs.mkdirSync(rollback,{mode:0o700});
const previous=[];for(const f of files){if(fs.existsSync(target+'/'+f)){fs.mkdirSync(path.dirname(rollback+'/'+f),{recursive:true,mode:0o700});fs.copyFileSync(target+'/'+f,rollback+'/'+f);previous.push(f);}}
fs.copyFileSync(target+'/.pm2/dump.pm2',rollback+'/pm2-dump.json');fs.chmodSync(rollback+'/pm2-dump.json',0o600);
const owner=fs.statSync(target+'/provider.mjs'),appHash=hash(target+'/dist/app.js');
const restart=()=>execFileSync('su',['-','form','-c','pm2 restart form && pm2 save'],{stdio:'pipe'});
idle();for(const f of files){const dst=target+'/'+f;fs.copyFileSync(f,dst+'.new');fs.chownSync(dst+'.new',owner.uid,owner.gid);fs.chmodSync(dst+'.new',0o644);fs.renameSync(dst+'.new',dst);}
idle();restart();
let ready=false;for(let i=0;i<20;i++){try{ready=(await fetch('http://127.0.0.1:5177/api/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'startup deadline');
for(const base of ['http://127.0.0.1:5177','https://form.dove-it.net','https://fhisling.tail11036c.ts.net:9444']){assert.equal((await fetch(base+'/api/health')).status,200);const home=await fetch(base);assert.equal(home.status,200);assert.ok(home.headers.get('content-security-policy').includes(fs.readFileSync(target+'/dist/bridge-hash.txt','utf8').trim()));assert.equal((await fetch(base+'/api/elements/grants')).status,401);assert.equal((await(await fetch(base+'/api/auth/status')).json()).registration,false);assert.equal(crypto.createHash('sha256').update(Buffer.from(await(await fetch(base+'/app.js')).arrayBuffer())).digest('hex'),appHash);}
for(const f of files)assert.equal(hash(f),hash(target+'/'+f));
const result={ok:true,rollback,previous,files:Object.fromEntries(files.map(f=>[f,hash(f)])),appHash,proof:'three idle checkpoints; form-user restart/save; loopback and both public routes health/CSP/auth/registration and unchanged frontend hash; no user artifact changes'};fs.writeFileSync(target+'/minimax-budget-release.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
