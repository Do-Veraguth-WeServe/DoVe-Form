import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {JobRunner,ROUND_DEADLINE_MS}=await import(pathToFileURL(path.join(root,'jobs.mjs')));
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));

// Regression for #f9c7cfd1/#a8c0f22b: a chat provider round must survive the
// old hard 60s abort (reasoning models think longer before the first visible
// token) and still fail honestly with the bounded timeout label at the new
// round deadline. Uses mock timers on the REAL provider abort path — no real
// waiting, no network, no production stores, no credentials.
test('chat round deadline is 180s, not the former 60s abort',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-chat-round-deadline-'));
  const store=new Store(dir),originalFetch=globalThis.fetch;
  const user=store.createUser('fixture','password123'),conv=store.createConversation(user.id);
  const mid=store.appendMessage(conv.id,'assistant',{});
  const job=store.createJob({userId:user.id,conversationId:conv.id,messageId:mid,kind:'chat',modelId:'fixture',request:{messages:[{role:'user',content:'fixture'}]}});
  let aborts=[];
  // Provider stream that never yields a chunk: only the deadline abort ends it.
  globalThis.fetch=(url,init)=>new Promise((res,rej)=>{
    init.signal.addEventListener('abort',()=>{aborts.push(Date.now());rej(new DOMException('fixture round deadline','AbortError'));},{once:true});
  });
  t.mock.timers.enable({apis:['setTimeout','Date']});
  let run;
  try{
    run=runnerPromise();
    function runnerPromise(){const r=new JobRunner(store,{getModel:()=>({baseUrl:'http://127.0.0.1:1',model:'fixture-model',apiKey:'***'})});return r.run(job.id);}
    // Former bug fired here: the round aborted at exactly +60s.
    t.mock.timers.tick(60000);
    await new Promise(r=>setImmediate(r));
    assert.equal(store.getJob(job.id).state,'building','round must still be running at +60s');
    assert.deepEqual(aborts,[],'no provider abort at +60s');
    // New deadline: the round aborts at ROUND_DEADLINE_MS and the job fails
    // honestly with the bounded label.
    t.mock.timers.tick(ROUND_DEADLINE_MS-60000);
    await new Promise(r=>setImmediate(r));
    await run;
    const result=store.getJob(job.id);
    assert.equal(result.state,'failed');
    assert.equal(result.error,'Zeitlimit beim Modellaufruf erreicht. Bitte erneut versuchen oder die Anfrage aufteilen.');
    assert.equal(aborts.length,1,'exactly one deadline abort');
    assert.equal(store.db.prepare('SELECT error FROM messages WHERE id=?').get(mid).error,result.error);
    assert.equal(runnerActive(),0);
    function runnerActive(){return store.db.prepare('SELECT count(*) n FROM jobs WHERE state IN (\'queued\',\'building\',\'validating\')').get().n;}
  }finally{
    t.mock.timers.reset();
    globalThis.fetch=originalFetch;store.close();fs.rmSync(dir,{recursive:true,force:true});
  }
});
