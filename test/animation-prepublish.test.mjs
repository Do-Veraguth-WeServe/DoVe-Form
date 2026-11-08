// Requires deployed, sandboxed local verifier socket; no real provider or production data.
import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {executeTurn,JobRunner}=await import(pathToFileURL(path.join(root,'jobs.mjs')));
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const {readAnimationEvidence}=await import(pathToFileURL(path.join(root,'animation-evidence.mjs')));
const artifact={version:1,html:'<div id="a">Synthetic</div>',css:'',js:'',state:{},animations:{version:1,clips:{fade:{type:'tween',target:'a',duration:200,easing:'linear',frames:[{opacity:1},{opacity:0}]}}}};
async function fixture(replies,fn){let count=0;const server=http.createServer(async(req,res)=>{for await(const c of req){}const r=replies[Math.min(count++,replies.length-1)];res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'Fixture. '+String.fromCharCode(96).repeat(3)+'json\n'+JSON.stringify(r)+'\n'+String.fromCharCode(96).repeat(3)},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await fn({baseUrl:'http://127.0.0.1:'+server.address().port,model:'fixture',apiKey:'test'},()=>count);}finally{await new Promise(r=>server.close(r));}}
test('real isolated Chromium rejects missing target and corrects once, with scoped durable evidence',async()=>{
 for(const correct of [false,true])await fixture([{...artifact,html:'<div>missing</div>'},correct?artifact:{...artifact,js:'while(true){}'}],async(model,count)=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-animation-job-'));const store=new Store(dir);
 try{const u=store.createUser('fixture','password123');const conv=store.createConversation(u.id);const original={version:1,html:'<div>Original</div>',css:'',js:'',state:{n:9}};const target=store.appendMessage(conv.id,'assistant',{render:original});const msg=store.appendMessage(conv.id,'assistant',{});const job=store.createJob({userId:u.id,conversationId:conv.id,messageId:msg,targetMessageId:target,kind:'refine',modelId:'fixture',request:{messages:[{role:'user',content:'Synthetic approved build'}]}});const runner=new JobRunner(store,{getModel:()=>model});await runner.run(job.id);assert.equal(count(),2);assert.equal(store.getJob(job.id).state,correct?'ready':'failed');
 if(correct){assert.deepEqual(store.getRender(target),artifact);assert.ok(readAnimationEvidence(store.db,u.id,conv.id,target,artifact));assert.equal(readAnimationEvidence(store.db,'other',conv.id,target,artifact),null);assert.equal(readAnimationEvidence(store.db,u.id,conv.id,target,{...artifact,js:'state.changed=true;'}),null);}else{assert.deepEqual(store.getRender(target),original);assert.equal(store.db.prepare('SELECT count(*) n FROM animation_evidence').get().n,0);}
 }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
 });
});
test('valid animated output passes one real browser round',async()=>{await fixture([artifact],async(model,count)=>{const result=await executeTurn(model,[],{},()=>{});assert.equal(count(),1);assert.equal(result.failure,null);assert.equal(result.animationEvidence?.status,'passed');});});
