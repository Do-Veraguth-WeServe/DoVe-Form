import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {JobRunner}=await import(pathToFileURL(path.join(root,'jobs.mjs')));
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
// Exercise the actual provider abort classification and durable job error path.
// No 60-second sleeps, network requests, production stores or provider credentials.
for(const kind of ['plan','chat','build'])for(const totalMs of [0,120000]){
 test(kind+' timeout has no invented duration (totalMs='+totalMs+')',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-timeout-label-'));
  const store=new Store(dir),originalFetch=globalThis.fetch;
  try{
   const user=store.createUser('fixture','password123'),conv=store.createConversation(user.id);
   const mid=store.appendMessage(conv.id,'assistant',{});
   const job=store.createJob({userId:user.id,conversationId:conv.id,messageId:mid,kind,modelId:'fixture',request:{messages:[{role:'user',content:'fixture'}]}});
   let calls=0;
   globalThis.fetch=async()=>{calls++;throw new DOMException('fixture deadline','AbortError');};
   const runner=new JobRunner(store,{totalMs,getModel:()=>({baseUrl:'http://127.0.0.1:1',model:'fixture',apiKey:'fixture'})});
   await runner.run(job.id);
   const result=store.getJob(job.id);
   assert.equal(result.state,'failed');
   assert.equal(result.error,'Zeitlimit beim Modellaufruf erreicht. Bitte erneut versuchen oder die Anfrage aufteilen.');
   assert.doesNotMatch(result.error,/Infinity|NaN|120 s/);
   assert.equal(calls,1,'deadline failures are not transport retries');
   assert.equal(store.db.prepare('SELECT error FROM messages WHERE id=?').get(mid).error,result.error);
   assert.equal(store.db.prepare('SELECT count(*) n FROM messages WHERE render IS NOT NULL').get().n,0);
   assert.equal(runner.activeCount(),0);
  }finally{globalThis.fetch=originalFetch;store.close();fs.rmSync(dir,{recursive:true,force:true});}
 });
}
