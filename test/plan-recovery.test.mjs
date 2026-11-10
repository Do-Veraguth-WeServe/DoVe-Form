import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {JobRunner}=await import(pathToFileURL(path.join(root,'jobs.mjs')));
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const valid='<reply>Plan korrigiert.</reply><title>Liste</title><summary>Liste mit gespeicherten Aufgaben.</summary><questions></questions><ready>true</ready>';
async function fixture(replies,check,{cancel=false}={}){
 const requests=[];let runner,job;
 const upstream=http.createServer(async(req,res)=>{
  let body='';for await(const c of req)body+=c;requests.push(JSON.parse(body));
  if(cancel&&requests.length===2){runner.cancel(job.id);res.destroy();return;}
  const value=replies[Math.min(requests.length-1,replies.length-1)];
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end('data: '+JSON.stringify({choices:[{delta:{content:value.text},finish_reason:value.finish||'stop'}]})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-plan-recovery-')),store=new Store(dir);
 try{
  const u=store.createUser('fixture','password123'),conv=store.createConversation(u.id);
  const mid=store.appendMessage(conv.id,'assistant',{});
  job=store.createJob({userId:u.id,conversationId:conv.id,messageId:mid,kind:'plan',modelId:'fixture',request:{baseRevision:1,messages:[{role:'system',content:'Planning only. No tools.'},{role:'user',content:'A persistent list.'}]}});
  store.saveBlueprint({...job,request:{baseRevision:0}},{reply:'Original',title:'Original',summary:'Prior agreed requirements',questions:[],ready:true});
  runner=new JobRunner(store,{getModel:()=>({baseUrl:'http://127.0.0.1:'+upstream.address().port,model:'fixture',apiKey:'***'})});
  const events=[];runner.subscribe(u.id,e=>events.push(e));
  await runner.run(job.id);
  await check({requests,store,job:store.getJob(job.id),plan:store.latestBlueprint(conv.id),events});
  assert.equal(store.db.prepare('SELECT count(*) n FROM messages WHERE render IS NOT NULL').get().n,0);
  assert.equal(store.db.prepare('SELECT count(*) n FROM jobs').get().n,1,'no implicit build or extra job');
  for(const req of requests){assert.ok(!req.tools);assert.ok(req.max_tokens<=3000);}
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});upstream.closeAllConnections();await new Promise(r=>upstream.close(r));}
}
for(const [name,invalid] of Object.entries({malformed:{text:'<reply>Incomplete</reply><title>List'},truncated:{text:valid,finish:'length'},questions:{text:valid.replace('<questions></questions>','<questions><question></question></questions>')},oversized:{text:valid.replace('Liste</title>','x'.repeat(101)+'</title>')}})){
 test(name+' planner output receives exactly one validated correction',()=>fixture([invalid,{text:valid}],({requests,job,plan})=>{
  assert.equal(requests.length,2);assert.equal(job.state,'ready');assert.equal(plan.revision,2);assert.equal(plan.title,'Liste');
  assert.equal(requests[1].messages.at(-2).role,'assistant');assert.equal(requests[1].messages.at(-2).content,invalid.text);
  assert.match(requests[1].messages.at(-1).content,/No construction/);
 }));
}
test('double invalid response fails closed and preserves previous blueprint',()=>fixture([{text:'invalid'}],({requests,job,plan})=>{assert.equal(requests.length,2);assert.equal(job.state,'failed');assert.equal(plan.revision,1);assert.equal(plan.title,'Original');}));
test('valid first response needs no correction',()=>fixture([{text:valid}],({requests,job})=>{assert.equal(requests.length,1);assert.equal(job.state,'ready');}));
test('cancellation during correction cannot publish',()=>fixture([{text:'invalid'}],({requests,job,plan})=>{assert.equal(requests.length,2);assert.equal(job.state,'cancelled');assert.equal(plan.revision,1);},{cancel:true}));
