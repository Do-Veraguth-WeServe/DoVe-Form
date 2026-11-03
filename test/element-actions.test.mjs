import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {Store} from '../store.mjs';import {ElementActions} from '../element-actions.mjs';
test('element actions bind owner, tool revision and reject concurrent clicks',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-action-'));const s=new Store(dir);
 try{const u=s.createUser('owner','password123','owner'),b=s.createUser('bob','password123','user'),c=s.createConversation(u.id,'Action');const mid=s.appendMessage(c.id,'assistant',{render:{version:1,html:'<p>Hello</p>',css:'',js:'',state:{}}});let fingerprint='v1',resolve;
 const mcp={catalog:()=>[{name:'read',fingerprint}]};const execution={execute:()=>new Promise(r=>{resolve=r})};const a=new ElementActions(s,mcp,execution);
 const id=a.add(u.id,{messageId:mid,label:'Refresh',tool:'read',args:{}});assert.throws(()=>a.list(b.id,mid));assert.throws(()=>a.run(b.id,id));fingerprint='v2';assert.throws(()=>a.run(u.id,id),/Konfiguration/);fingerprint='v1';const job=a.run(u.id,id);assert.ok(job);assert.throws(()=>a.run(u.id,id),/bereits/);resolve({});await new Promise(r=>setImmediate(r));assert.equal(s.getJob(job).state,'ready');a.remove(u.id,id);assert.deepEqual(a.list(u.id,mid),[]);
 }finally{s.db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
