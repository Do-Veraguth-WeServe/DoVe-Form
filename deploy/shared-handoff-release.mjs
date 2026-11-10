// Frontend-only; run after shared handoff and renderer regression gates pass.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
const target='/opt/form',rollback=target+'/.rollback/20261110-shared-handoff';
const files=['src/renderer.js','src/shared-elements.js','dist/app.js','docs/SHARED-REFRESH-HANDOFF.md','test/shared-elements-browser.mjs'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const idle=()=>{const db=new DatabaseSync(target+'/data/form.db',{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) n FROM jobs WHERE state NOT IN (?,?,?)').get('ready','failed','cancelled').n,0,'Active jobs block publication');}finally{db.close();}};
assert.equal(hash('dist/bridge-hash.txt'),hash(target+'/dist/bridge-hash.txt'),'CSP bridge must not change');
assert.ok(!fs.existsSync(rollback),'Reconcile existing release instead of retrying blindly');idle();
fs.mkdirSync(rollback,{mode:0o700});const prior=[];
for(const file of files){const dst=target+'/'+file;if(fs.existsSync(dst)){fs.mkdirSync(path.dirname(rollback+'/'+file),{recursive:true,mode:0o700});fs.copyFileSync(dst,rollback+'/'+file);prior.push(file);}}
const owner=fs.statSync(target+'/dist/app.js');idle();
try{for(const file of files){const dst=target+'/'+file;fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(file,dst+'.new');fs.chownSync(dst+'.new',owner.uid,owner.gid);fs.chmodSync(dst+'.new',0o644);fs.renameSync(dst+'.new',dst);assert.equal(hash(file),hash(dst));}
for(const base of ['http://127.0.0.1:5177','https://fhisling.tail11036c.ts.net:9444']){const home=await fetch(base);assert.equal(home.status,200);assert.ok(home.headers.get('content-security-policy').includes(fs.readFileSync('dist/bridge-hash.txt','utf8').trim()));assert.equal((await fetch(base+'/api/health')).status,200);assert.equal((await fetch(base+'/api/elements/grants')).status,401);const app=await fetch(base+'/app.js');assert.equal(app.status,200);assert.equal(crypto.createHash('sha256').update(Buffer.from(await app.arrayBuffer())).digest('hex'),hash('dist/app.js'));}
const result={ok:true,rollback,restart:false,files:Object.fromEntries(files.map(f=>[f,hash(f)])),proof:'zero jobs; matching served bundle and unchanged CSP; health200 and anonymous401 on both routes'};
fs.writeFileSync(target+'/shared-handoff-release.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(e){for(const file of prior){const dst=target+'/'+file;fs.copyFileSync(rollback+'/'+file,dst+'.rollback');fs.chownSync(dst+'.rollback',owner.uid,owner.gid);fs.renameSync(dst+'.rollback',dst);}throw e;}
