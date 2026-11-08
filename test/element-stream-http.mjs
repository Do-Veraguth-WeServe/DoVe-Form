import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {Store} from '../store.mjs';import {ElementSharing,elementCodeRevision} from '../element-sharing.mjs';
import {ElementDB} from '../db.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-stream-http-'));
const s=new Store(dir),db=new ElementDB(path.join(dir,'elements.sqlite')),sharing=new ElementSharing(s,db);
const users=['alice','bobby','carol'].map(n=>s.createUser(n,'password123')),sessions=users.map(u=>s.createSession(u.id));
const conv=s.createConversation(users[0].id),render={version:1,name:'Stream fixture',html:'<p>Counter</p>',css:'',js:'',state:{n:1}};
const base='http://127.0.0.1:4775',prefix='/api/elements/grants/stream?id=';let app;const readers=[];
function fixture(){const mid=s.appendMessage(conv.id,'assistant',{render});const {id}=sharing.offer(users[0].id,{messageId:mid,revision:elementCodeRevision(render),recipient:'bobby'});sharing.accept(users[1].id,id);return {mid,id};}
async function connect(who,id,headers={}){
 const r=await fetch(base+prefix+id,{headers:{cookie:'form3sess='+sessions[who]?.token,origin:base,...headers},signal:AbortSignal.timeout(15000)});
 if(r.status!==200)return {status:r.status};
 const reader=r.body.getReader();readers.push(reader);let buf='';
 return {status:r.status,close:()=>reader.cancel(),async next(){
  for(;;){const cut=buf.indexOf('\n\n');if(cut>=0){const line=buf.slice(0,cut);buf=buf.slice(cut+2);if(line.startsWith(':'))continue;const [event,data]=line.split('\n');if(event==='event: heartbeat')continue;return {event:event.slice(7),data:JSON.parse(data.slice(6))};}
   const chunk=await reader.read();if(chunk.done)return null;buf+=new TextDecoder().decode(chunk.value);
  }
 }};
}
try{
 app=spawn('node',['server.mjs'],{env:{...process.env,PORT:'4775',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});app.once('exit',()=>{clearTimeout(t);reject(Error('early exit'));});});
 const f=fixture();
 assert.equal((await connect(9,f.id)).status,401);
 assert.equal((await connect(2,f.id)).status,404);
 assert.equal((await connect(1,f.id,{origin:'https://evil.example'})).status,403);
 const a=await connect(1,f.id),b=await connect(0,f.id);
 const first=await a.next();assert.equal(first.event,'snapshot');assert.equal(first.data.render.state.n,1);
 assert.deepEqual(Object.keys(first.data).sort(),['canEdit','codeRevision','dbRevision','id','render','stateRevision']);
 assert.equal(first.data.render.actions,undefined);assert.equal(first.data.canEdit,false);await b.next();
 sharing.state(users[1].id,f.id,{state:{n:2},expectedRevision:first.data.stateRevision});
 assert.equal((await a.next()).data.render.state.n,2);assert.equal((await b.next()).data.render.state.n,2);
 await a.close();await b.close();
 // A stale Last-Event-ID is ignored: reconnect gets current data, never replay.
 const reconnect=await connect(1,f.id,{'Last-Event-ID':'stale'});assert.equal((await reconnect.next()).data.render.state.n,2);
 sharing.close(users[0].id,f.id);assert.deepEqual(await reconnect.next(),{event:'invalidated',data:{id:f.id}});assert.equal(await reconnect.next(),null);
 assert.equal((await connect(1,f.id)).status,404);
 for(const cause of ['logout','recipient-disable','owner-disable','code','delete']){
  const g=fixture(),stream=await connect(1,g.id);assert.equal((await stream.next()).event,'snapshot');
  if(cause==='logout')s.deleteSession(sessions[1].token);
  if(cause==='recipient-disable')s.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(users[1].id);
  if(cause==='owner-disable')s.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(users[0].id);
  if(cause==='code')s.updateMessageRender(users[0].id,g.mid,{...render,html:'<p>New code</p>'});
  if(cause==='delete')s.db.prepare('DELETE FROM messages WHERE id=?').run(g.mid);
  assert.deepEqual(await stream.next(),{event:'invalidated',data:{id:g.id}},cause);assert.equal(await stream.next(),null);
  s.db.prepare('UPDATE users SET disabled=0 WHERE id IN (?,?)').run(users[0].id,users[1].id);
  if(cause==='logout')sessions[1]=s.createSession(users[1].id);
 }
 const limit=fixture(),opened=[];
 for(let i=0;i<4;i++){const r=await connect(1,limit.id);assert.equal(r.status,200);await r.next();opened.push(r);}
 assert.equal((await connect(1,limit.id)).status,429);
 for(const r of opened)await r.close();
 await new Promise(r=>setTimeout(r,100));
 const recovered=await connect(1,limit.id);assert.equal(recovered.status,200);await recovered.next();await recovered.close();
 console.log('PASS shared-state SSE: three accounts, owner/recipient updates, reconnect, revocation, logout, disable, code/source invalidation, Origin, cap and cleanup');
}finally{
 for(const r of readers)try{await r.cancel();}catch{}
 if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit');}
 db.close();s.close();fs.rmSync(dir,{recursive:true,force:true});
}
