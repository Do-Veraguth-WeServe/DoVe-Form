import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {JobRunner,executeTurn}=await import(pathToFileURL(path.join(root,'jobs.mjs')));
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
async function fixture(fn){
 const requests=[];
 const upstream=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;requests.push(JSON.parse(raw));res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'Only a description.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-required-')),s=new Store(dir);
 try{await fn(s,{baseUrl:'http://127.0.0.1:'+upstream.address().port,model:'fixture',apiKey:'***'},requests);}finally{s.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true});}
}
for(const kind of ['create','refine'])test(kind+' without an artifact fails after exactly one correction',()=>fixture(async(s,model,requests)=>{
 const u=s.createUser('fixture','password123'),c=s.createConversation(u.id);
 const original={version:1,html:'<p>Original</p>',css:'',js:'',state:{n:7}};
 const target=s.appendMessage(c.id,'assistant',{render:original}),mid=s.appendMessage(c.id,'assistant',{});
 const job=s.createJob({userId:u.id,conversationId:c.id,messageId:mid,targetMessageId:kind==='refine'?target:null,kind,modelId:'fixture',request:{messages:[{role:'user',content:'Approved build'}]}});
 const runner=new JobRunner(s,{getModel:()=>model});await runner.run(job.id);
 assert.equal(requests.length,2);assert.match(requests[1].messages.at(-1).content,/NO JSON artifact/);
 assert.equal(s.getJob(job.id).state,'failed');assert.equal(s.getRender(mid),null);assert.deepEqual(s.getRender(target),original);
}));
test('legacy prose-only executeTurn caller remains one round',()=>fixture(async(s,model,requests)=>{const r=await executeTurn(model,[],{},()=>{});assert.equal(r.failure,null);assert.equal(requests.length,1);}));
for(const type of ['valid','missing','no-render','foreign-user','foreign-conversation'])test('blueprint target validation: '+type,()=>fixture(async s=>{
 const u=s.createUser('fixture','password123'),foreign=s.createUser('foreign','password123'),c=s.createConversation(u.id);
 const tc=type==='foreign-user'?s.createConversation(foreign.id):type==='foreign-conversation'?s.createConversation(u.id):c;
 const render={version:1,html:'<p>Original</p>',css:'',js:'',state:{}};
 const target=type==='missing'?'00000000-0000-4000-8000-000000000000':s.appendMessage(tc.id,'assistant',type==='no-render'?{}:{render});
 const mid=s.appendMessage(c.id,'assistant',{}),job={userId:u.id,conversationId:c.id,messageId:mid,targetMessageId:target,kind:'plan',modelId:'fixture',request:{baseRevision:0}}; // exercise save boundary directly; createJob already rejects foreign targets
 const plan=s.saveBlueprint(job,{title:'Plan',summary:'Synthetic plan',ready:true,questions:[]});
 assert.equal(plan.targetMessageId,type==='valid'?target:null);
}));
