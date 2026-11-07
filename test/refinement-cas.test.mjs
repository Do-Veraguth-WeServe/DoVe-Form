import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Store} from '../store.mjs';
import {JobRunner} from '../jobs.mjs';
import http from 'node:http';
const hash=r=>crypto.createHash('sha256').update(JSON.stringify(r)).digest('hex');
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-refine-cas-')),s=new Store(dir);
 try{
  const u=s.createUser('fixture','password123'),c=s.createConversation(u.id);
  const original={version:1,html:'<p>Original</p>',css:'',js:'',state:{n:1}};
  const mid=s.appendMessage(c.id,'assistant',{render:original}),messageId=s.appendMessage(c.id,'assistant',{});
  const j=s.createJob({userId:u.id,conversationId:c.id,messageId,targetMessageId:mid,kind:'refine',modelId:'fixture',request:{messages:[{role:'user',content:'Approved fixture'}],targetHash:hash(original)}});
  s.transitionJob(j.id,['queued'],'building');
  const replacement={...original,html:'<p>Replacement</p>'};
  const apply=j=>s.replaceRender(j.conversationId,j.targetMessageId,replacement);
  const versions=()=>s.db.prepare('SELECT count(*) n FROM versions WHERE message_id=?').get(mid).n;
  const competing=render=>{
   const child=spawnSync(process.execPath,['--input-type=module','-e',
    "import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA busy_timeout=0');try{d.prepare('UPDATE messages SET render=? WHERE id=?').run(process.argv[2],process.argv[3]);console.log('written')}catch(e){if(e.errcode!==5)throw e;console.log('locked')}finally{d.close()}",path.join(dir,'form.db'),JSON.stringify(render),mid],{encoding:'utf8'});
   assert.equal(child.status,0,child.stderr);return child.stdout.trim();
  };
  fn({s,j,mid,original,replacement,apply,versions,competing});
 }finally{s.close();fs.rmSync(dir,{recursive:true,force:true});}
}
for(const change of ['state','code','actions'])test('completion rejects '+change+' changed after early hash check',()=>fixture(({s,j,mid,original,apply,versions,competing})=>{
 assert.equal(hash(s.getRender(mid)),j.request.targetHash); // runner early check succeeded
 const changed=change==='state'?{...original,state:{n:2}}:change==='code'?{...original,html:'<p>New code, same state</p>'}:{...original,actions:[{name:'read',url:'https://example.com/',method:'GET',args:{}}]};
 assert.equal(competing(changed),'written');const before=versions();
 assert.throws(()=>s.completeJob(j.id,apply),/während der Aktualisierung geändert/);
 assert.deepEqual(s.getRender(mid),changed);assert.equal(versions(),before);assert.equal(s.getJob(j.id).state,'building');
}));
test('completion holds writer lock across hash read and replacement',()=>fixture(({s,j,mid,original,replacement,apply,versions,competing})=>{
 const get=s.getRender;let observed,reads=0;
 s.getRender=function(id){const r=get.call(this,id);if(id===mid){reads++;observed=competing({...original,state:{n:9}});}return r;};
 let done;try{done=s.completeJob(j.id,apply);}finally{s.getRender=get;}
 assert.ok(reads>0,'completion must re-read target inside transaction');assert.equal(observed,'locked');assert.equal(done.state,'ready');assert.deepEqual(s.getRender(mid),replacement);assert.equal(versions(),1);
 assert.equal(competing({...replacement,state:{n:10}}),'written','lock released after completion');
}));
test('cancelled completion never invokes apply',()=>fixture(({s,j,apply})=>{
 s.transitionJob(j.id,['building'],'cancelled');let invoked=false;
 assert.equal(s.completeJob(j.id,x=>{invoked=true;apply(x)}),null);assert.equal(invoked,false);assert.equal(s.getJob(j.id).state,'cancelled');
}));

test('runner turns the late transactional conflict into failed, never ready',async()=>{
 for(const race of [false,true]){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-refine-runner-')),s=new Store(dir);
  const original={version:1,html:'<p>Original</p>',css:'',js:'',state:{n:1}},replacement={...original,html:'<p>Approved replacement</p>'};
  const upstream=http.createServer((req,res)=>{req.resume();req.on('end',()=>{const content='Fixture. '+String.fromCharCode(96).repeat(3)+'json\n'+JSON.stringify(replacement)+'\n'+String.fromCharCode(96).repeat(3);res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');});});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  try{
   const u=s.createUser('fixture','password123'),c=s.createConversation(u.id),mid=s.appendMessage(c.id,'assistant',{render:original}),messageId=s.appendMessage(c.id,'assistant',{});
   const j=s.createJob({userId:u.id,conversationId:c.id,messageId,targetMessageId:mid,kind:'refine',modelId:'fixture',request:{messages:[{role:'user',content:'Approved fixture'}],targetHash:hash(original)}});
   const complete=s.completeJob;let reached=false;
   s.completeJob=function(id,apply){reached=true;if(race)s.updateMessageRender(u.id,mid,{...original,state:{n:9}});return complete.call(this,id,apply);};
   const runner=new JobRunner(s,{getModel:()=>({baseUrl:'http://127.0.0.1:'+upstream.address().port,model:'fixture',apiKey:'***'})});
   const events=[];const emit=runner.emitJob;runner.emitJob=function(job,...args){events.push(job.state);return emit.call(this,job,...args);};
   await runner.run(j.id);assert.equal(reached,true);assert.equal(s.getJob(j.id).state,race?'failed':'ready');
   if(race){assert.deepEqual(s.getRender(mid),{...original,state:{n:9}});assert.match(s.getJob(j.id).error,/während der Aktualisierung geändert/);assert.ok(!events.includes('ready'));assert.equal(s.db.prepare('SELECT count(*) n FROM versions WHERE message_id=?').get(mid).n,0);}
   else assert.deepEqual(s.getRender(mid),replacement);
  }finally{await new Promise(r=>upstream.close(r));s.close();fs.rmSync(dir,{recursive:true,force:true});}
 }
});
