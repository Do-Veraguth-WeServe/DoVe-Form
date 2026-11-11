import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {JobRunner}=await import(pathToFileURL(path.join(root,'jobs.mjs')));
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const cases=[
 {name:'empty then prose',contents:['','Recovered reply'],calls:2,state:'ready'},
 {name:'reasoning-only then prose',contents:['','Recovered reply'],reasoning:true,calls:2,state:'ready'},
 {name:'whitespace then prose',contents:['  ','Recovered reply'],calls:2,state:'ready'},
 {name:'deadline exhausted before retry',contents:[''],deadline:true,calls:1,state:'failed'},
 {name:'twice empty',contents:['',''],calls:2,state:'failed'},
 {name:'valid reply',contents:['Normal reply'],calls:1,state:'ready'},
 {name:'truncated empty',contents:[''],finish:'length',calls:1,state:'failed'},
 {name:'HTTP429',status:429,calls:1,state:'failed'},
 {name:'HTTP503',status:503,calls:1,state:'failed'},
 {name:'transport failure',transport:true,calls:1,state:'failed'},
 {name:'cancel during second round',contents:['',''],cancel:true,calls:2,state:'cancelled'},
];
for(const c of cases)test(c.name,async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-empty-chat-')),s=new Store(dir),oldFetch=globalThis.fetch,oldNow=Date.now;
 let runner,job,calls=0;const bodies=[];
 try{
  const u=s.createUser('fixture','password123'),conv=s.createConversation(u.id),mid=s.appendMessage(conv.id,'assistant',{});
  job=s.createJob({userId:u.id,conversationId:conv.id,messageId:mid,kind:'chat',modelId:'fixture',request:{messages:[{role:'user',content:'Synthetic discussion only'}]}});
  runner=new JobRunner(s,{getModel:()=>({baseUrl:'http://127.0.0.1:1',model:'fixture',apiKey:'***'})});
  globalThis.fetch=async(_url,opts)=>{
   calls++;bodies.push(JSON.parse(opts.body));
   if(c.cancel&&calls===2){runner.cancel(job.id,u.id);throw new DOMException('fixture cancelled','AbortError');}
   if(c.transport)throw new TypeError('synthetic disconnected transport');
   if(c.status)return new Response(JSON.stringify({error:{message:'synthetic limit'}}),{status:c.status});
   if(c.deadline)Date.now=()=>oldNow()+60001;
   const delta={content:c.contents[calls-1]??''};if(c.reasoning)delta.reasoning_content='Synthetic private reasoning';
   return new Response('data: '+JSON.stringify({choices:[{delta,finish_reason:c.finish||'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  await runner.run(job.id);
  assert.equal(calls,c.calls,'bounded provider calls');
  assert.equal(s.getJob(job.id).state,c.state);
  const message=s.db.prepare('SELECT prose,error,render FROM messages WHERE id=?').get(mid);
  assert.equal(message.render,null);assert.equal(runner.activeCount(),0);
  if(c.state==='ready'){assert.equal(message.prose,c.contents.at(-1));assert.equal(message.error,null);}
  if(c.state==='failed')assert.ok(message.error);
  assert.equal(s.db.prepare('SELECT count(*) n FROM jobs WHERE kind!=?').get('chat').n,0,'no implicit construction');
  for(const body of bodies){assert.equal(body.max_tokens,3200);assert.ok(!body.tools?.length);}
  if(bodies.length===2)assert.deepEqual(bodies[0],bodies[1],'retry preserves original request and token budget');
 }finally{Date.now=oldNow;globalThis.fetch=oldFetch;s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
