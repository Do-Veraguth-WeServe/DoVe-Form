import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../store.mjs';import {ToolExecution} from '../tool-execution.mjs';
test('tool requires owner approval, persists outcome, isolates other users',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-approval-'));const s=new Store(dir);
 try{
 const u=s.createUser('owner','password123','owner'),other=s.createUser('other','password123','user');
 const c=s.createConversation(u.id,'Tools');const job=s.createJob({userId:u.id,conversationId:c.id,kind:'create',modelId:'fixture',request:{messages:[]}});
 let executed=0;const mcp={catalog:()=>[{name:'count'}],call:async()=>{executed++;return {count:3}}};const t=new ToolExecution(s,mcp,{requireApproval:true});
 const result=t.execute(job,{function:{name:'count'}},{},{signal:new AbortController().signal});
 const pending=t.list(u.id)[0];assert.equal(pending.state,'pending');assert.equal(executed,0);assert.deepEqual(t.list(other.id),[]);
 assert.throws(()=>t.decide(other.id,pending.id,true));t.decide(u.id,pending.id,true);
 assert.deepEqual(await result,{count:3});assert.equal(executed,1);assert.equal(t.list(u.id)[0].state,'completed');assert.ok(t.hasCalls(job.id));assert.throws(()=>t.decide(u.id,pending.id,true));
 const bad=t.execute(job,{function:{name:'count'}},{},{signal:new AbortController().signal});const second=t.list(u.id).find(x=>x.state==='pending');t.decide(u.id,second.id,false);await assert.rejects(bad,/abgelehnt/);assert.equal(executed,1);
 }finally{s.db.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test('default tools execute immediately without pending approval, retaining owner isolation and unknown outcomes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-auto-tool-'));const s=new Store(dir);try{
 const u=s.createUser('owner','password123','owner'),other=s.createUser('other','password123','user'),c=s.createConversation(u.id,'Tools');const job=s.createJob({userId:u.id,conversationId:c.id,kind:'action',modelId:'',request:{messages:[]}});let count=0;
 const mcp={catalog:()=>[{name:'read',fingerprint:'v1'}],call:async()=>{count++;return {ok:true}}},t=new ToolExecution(s,mcp);
 assert.deepEqual(await t.execute(job,{function:{name:'read'}},{},{signal:new AbortController().signal}),{ok:true});assert.equal(count,1);assert.equal(t.list(u.id)[0].state,'completed');assert.ok(!t.list(u.id).some(c=>c.state==='pending'));assert.deepEqual(t.list(other.id),[]);
 await assert.rejects(t.execute({...job,userId:other.id},{function:{name:'read'}},{},{}),/Owner/);assert.equal(count,1);
 mcp.call=async()=>{count++;throw Error('lost response')};await assert.rejects(t.execute(job,{function:{name:'read'}},{},{}),/Nicht automatisch/);assert.equal(count,2);assert.equal(t.list(u.id).filter(c=>c.state==='unknown').length,1);
 }finally{s.db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
