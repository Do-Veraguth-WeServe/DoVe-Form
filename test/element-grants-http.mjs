import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {Store} from '../store.mjs';import {elementCodeRevision} from '../element-sharing.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-grant-http-'));
const s=new Store(dir),users=['alice','bobby','carol'].map(n=>s.createUser(n,'password123'));
const sessions=users.map(u=>s.createSession(u.id));
const conv=s.createConversation(users[0].id),render={version:1,name:'HTTP fixture',html:'<p>Counter</p>',css:'',js:'',state:{n:1}};
const mid=s.appendMessage(conv.id,'assistant',{render});
const base='http://127.0.0.1:4774',prefix='/api/elements/grants';let app;
async function call(who,route='',body,headers={},method){
 const r=await fetch(base+prefix+route,{method:method||(body===undefined?'GET':'POST'),headers:{cookie:'form3sess='+sessions[who]?.token,'content-type':'application/json','x-form-csrf':sessions[who]?.csrf||'',origin:base,...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,data:await r.json()};
}
try{
 app=spawn('node',['server.mjs'],{env:{...process.env,PORT:'4774',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});app.once('exit',()=>{clearTimeout(t);reject(Error('early exit'));});});
 assert.equal((await call(0)).status,200,'grant routes available');
 assert.equal((await call(9)).status,401);
 const offer={messageId:mid,revision:elementCodeRevision(render),recipient:'bobby'};
 for(const headers of [{'x-form-csrf':''},{origin:'https://evil.example'},{'content-type':'text/plain'}])assert.ok([403,415].includes((await call(0,'/offer',offer,headers)).status));
 assert.equal((await call(0,'/offer',offer,{},'PUT')).status,405);
 assert.equal((await call(0,'/unknown',{})).status,404);
 assert.equal((await call(0,'/offer',{...offer,padding:'x'.repeat(41000)})).status,400);
 assert.equal((await call(2,'/offer',offer)).status,404);
 const g=await call(0,'/offer',offer);assert.equal(g.status,200);const id=g.data.id;assert.ok(id);
 assert.deepEqual((await call(2)).data,{grants:[],next:null});
 assert.equal((await call(1,'/view?id='+id)).status,404);
 assert.equal((await call(2,'/accept',{id})).status,404);
 assert.equal((await call(1,'/accept',{id})).status,200);
 const view=await call(1,'/view?id='+id);assert.equal(view.status,200);assert.equal(view.data.render.state.n,1);
 assert.equal(view.data.render.actions,undefined);assert.equal(view.data.canEdit,false);
 assert.equal((await call(2,'/view?id='+id)).status,404);
 assert.deepEqual((await call(2,'/view?id='+id)).data,(await call(2,'/view?id=missing')).data);
 const changed=await call(1,'/state',{id,state:{n:2},expectedRevision:view.data.stateRevision,messageId:'forged'});assert.equal(changed.status,200);
 assert.equal((await call(0,'/state',{id,state:{n:3},expectedRevision:view.data.stateRevision})).status,409);
 assert.equal(s.getRender(mid).state.n,2);
 assert.equal((await call(0,'/db',{id,op:'create',table:'counter'})).status,200);
 assert.equal((await call(1,'/db',{id,op:'create',table:'counter'})).status,409);
 assert.equal((await call(1,'/db',{id,op:'insert',table:'counter',row:{n:7}})).status,200);
 assert.equal((await call(0,'/db',{id,op:'select',table:'counter'})).data.rows[0].n,7);
 assert.equal((await call(1,'/db',{id,op:'drop',table:'counter'})).status,404);
 // Row identity is separate from grant identity.
 assert.equal((await call(1,'/db',{id,op:'update',table:'counter',rowId:1,patch:{n:8}})).status,200);
 assert.equal((await call(0,'/db',{id,op:'select',table:'counter'})).data.rows[0].n,8);
 s.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(users[1].id);
 assert.equal((await call(1,'/view?id='+id)).status,401);
 assert.equal((await call(0,'/view?id='+id)).status,404);
 s.db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(users[1].id);
 // Shared recipients cannot edit source code through the existing owner endpoint.
 const deniedEdit=await fetch(base+'/api/state',{method:'POST',headers:{cookie:'form3sess='+sessions[1].token,'content-type':'application/json','x-form-csrf':sessions[1].csrf,origin:base},body:JSON.stringify({messageId:mid,render:{...render,html:'Changed'}})});
 assert.equal(deniedEdit.status,403);assert.equal(s.getRender(mid).html,render.html);
 assert.equal((await call(0,'/close',{id})).status,200);
 for(const route of ['/state','/db','/accept'])assert.equal((await call(1,route,{id,state:{n:9},op:'select',table:'counter'})).status,404);
 assert.equal((await call(1,'/view?id='+id)).status,404);
 // Hold the request body open, prove initial session lookup happened via sliding
 // expiry, then log out before the final byte. No stale session may offer a grant.
 const tokenHash=crypto.createHash('sha256').update(sessions[0].token).digest('hex');
 const initialExpiry=Date.now()+60000;
 s.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(initialExpiry,tokenHash);
 let req;
 const response=new Promise((resolve,reject)=>{
   req=http.request(base+prefix+'/offer',{method:'POST',headers:{cookie:'form3sess='+sessions[0].token,'content-type':'application/json','x-form-csrf':sessions[0].csrf,origin:base}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);
 });
 req.write(JSON.stringify(offer).slice(0,-1));
 await new Promise(r=>setTimeout(r,100));
 assert.ok(s.db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(tokenHash).expires_at>initialExpiry,'initial auth completed before logout');
 s.deleteSession(sessions[0].token);req.end('}');assert.equal(await response,401);
 sessions[0]=s.createSession(users[0].id);
 assert.equal((await call(0)).data.grants.filter(g=>g.status==='pending').length,0);
 // Contention is recoverable and never leaks SQL internals.
 s.db.exec('BEGIN IMMEDIATE');try{const locked=await call(0);assert.equal(locked.status,503);assert.equal(locked.data.error,'Dienst beschäftigt. Bitte neu laden.');}finally{s.db.exec('ROLLBACK');}
 assert.equal((await call(0)).status,200);
 let limited=false;for(let i=0;i<65;i++){if((await call(2)).status===429){limited=true;break;}}assert.ok(limited);
 console.log('PASS grant HTTP: three-account ACL, auth/CSRF/Origin/type/method/size/rate, opt-in, state conflict, row identity, disabled users, revocation, lock recovery.');
}finally{if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit');}s.close();fs.rmSync(dir,{recursive:true,force:true});}
