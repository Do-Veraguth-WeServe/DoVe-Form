import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {parseArtifact,validateRender,validateGeneratedCSS}=await import(pathToFileURL(path.join(root,'contract.mjs')));
const {executeTurn,JobRunner}=await import(pathToFileURL(path.join(root,'jobs.mjs')));
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const artifact=(css,state={count:0})=>({version:1,html:'<span class="icon">*</span>',css,js:'',state});
const unsupported=[
 '.icon::before{content:"";position:absolute;background:linear-gradient(red,orange)}',
 '.icon::AFTER{CONTENT:"private-marker";POSITION:absolute}',
 '.icon{transform:rotate(45deg)}',
 '@media(max-width:400px){.icon{color:red}}',
 '.icon{background:url(https://invalid.example/private-marker)}',
 '.icon{--x:private-marker;color:var(--x)}',
];
test('new output rejects every reported unsupported variation, existing artifacts remain readable and unchanged',()=>{
 for(const count of [0,3])for(const css of unsupported){
  const r=artifact(css,{count});const before=JSON.stringify(r);
  assert.throws(()=>validateGeneratedCSS(parseArtifact(before)),e=>e.message.includes('CSS capability preflight')&&!e.message.includes('private-marker')&&!e.message.includes('invalid.example'));
  assert.deepEqual(validateRender(r),r);assert.equal(JSON.stringify(r),before);
 }
 assert.deepEqual(parseArtifact(JSON.stringify(artifact('.icon{display:inline-block;color:orange}'))),artifact('.icon{display:inline-block;color:orange}'));
});
async function fixture(replies,fn){
 const requests=[];
 const s=http.createServer(async(req,res)=>{
  let b='';for await(const c of req)b+=c;requests.push(JSON.parse(b));
  const reply=replies[Math.min(requests.length-1,replies.length-1)];
  const content='Fixture. '+String.fromCharCode(96).repeat(3)+'json\n'+JSON.stringify(reply)+'\n'+String.fromCharCode(96).repeat(3);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
 });
 await new Promise(r=>s.listen(0,'127.0.0.1',r));
 try{await fn({baseUrl:'http://127.0.0.1:'+s.address().port,model:'fixture',apiKey:'test-only'},requests);}finally{await new Promise(r=>s.close(r));}
}
test('real SSE generation corrects unsupported CSS exactly once with policy evidence',async()=>{
 for(const count of [0,3])await fixture([artifact(unsupported[0],{count}),artifact('.icon{color:orange}',{count})],async(model,requests)=>{
  const events=[];const out=await executeTurn(model,[{role:'user',content:'Isolated icon fixture'}],{},e=>events.push(e));
  assert.equal(requests.length,2);assert.equal(out.rounds,2);assert.equal(out.failure,null);assert.equal(out.render.state.count,count);
  assert.equal(events.filter(e=>e.type==='retry').length,1);
  assert.match(requests[1].messages.at(-1).content,/CSS capability preflight/);
  assert.match(requests[1].messages.at(-1).content,/real HTML spans/);
 });
});
test('second unsupported output fails honestly with no render and no third attempt',async()=>{
 await fixture([artifact(unsupported[0]),artifact(unsupported[1])],async(model,requests)=>{
  const out=await executeTurn(model,[{role:'user',content:'Isolated icon fixture'}],{},()=>{});
  assert.equal(requests.length,2);assert.equal(out.rounds,2);assert.equal(out.render,null);assert.match(out.failure,/CSS capability preflight/);
 });
});
test('persisted failed refinement preserves original; corrected build becomes ready',async()=>{
 for(const correct of [false,true])await fixture([artifact(unsupported[0]),artifact(correct?'.icon{color:orange}':unsupported[1])],async(model,requests)=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-css-job-'));const store=new Store(dir);
  try{
   const user=store.createUser('fixture','password123');const conv=store.createConversation(user.id);
   const original=artifact('.icon{color:blue}',{count:9});
   const target=store.appendMessage(conv.id,'assistant',{render:original});
   const messageId=store.appendMessage(conv.id,'assistant',{});
   const job=store.createJob({userId:user.id,conversationId:conv.id,messageId,targetMessageId:target,kind:'refine',modelId:'fixture',request:{messages:[{role:'user',content:'Fixture approved build'}]}});
   const runner=new JobRunner(store,{getModel:()=>model});await runner.run(job.id);
   assert.equal(requests.length,2);assert.equal(store.getJob(job.id).state,correct?'ready':'failed');
   if(!correct){assert.deepEqual(store.getRender(target),original);assert.match(store.getJob(job.id).error,/CSS capability preflight/);}
   else assert.equal(store.getRender(target).css,'.icon{color:orange}');
  }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
 });
});
test('supported output stays one round',async()=>{
 await fixture([artifact('.icon{display:flex;color:rgb(1,2,3)}')],async(model,requests)=>{
  const out=await executeTurn(model,[],{},()=>{});assert.equal(requests.length,1);assert.equal(out.rounds,1);assert.ok(out.render);assert.equal(out.failure,null);
 });
});
