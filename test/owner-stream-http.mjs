import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {Store} from '../store.mjs';import {ElementDB} from '../db.mjs';
import {ElementSharing,elementCodeRevision,elementStateRevision} from '../element-sharing.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-owner-stream-')),base='http://127.0.0.1:4776';
const s=new Store(dir),db=new ElementDB(path.join(dir,'elements.sqlite')),sharing=new ElementSharing(s,db);
const users=['alice','bobby','carol'].map(n=>s.createUser(n,'password123')),sessions=users.map(u=>s.createSession(u.id));
const conv=s.createConversation(users[0].id),render={version:1,name:'Owner stream fixture',html:'<p>synthetic</p>',css:'',js:'',state:{n:1}};
const mid=s.appendMessage(conv.id,'assistant',{render}),second=s.appendMessage(conv.id,'assistant',{render});
const grant=sharing.offer(users[0].id,{messageId:mid,revision:elementCodeRevision(render),recipient:'bobby'});sharing.accept(users[1].id,grant.id);
let app;const readers=[];
const headers=who=>({cookie:'form3sess='+sessions[who]?.token,origin:base});
const query=ids=>ids.map(id=>'id='+encodeURIComponent(id)).join('&');
const get=(who,route,ids,extra={})=>fetch(base+'/api/elements/owner/'+route+'?'+query(ids),{headers:{...headers(who),...extra},signal:AbortSignal.timeout(15000)});
async function connect(who,ids){const r=await get(who,'stream',ids);if(r.status!==200)return {status:r.status};const reader=r.body.getReader();readers.push(reader);let buf='';return {status:200,close:()=>reader.cancel(),async next(){for(;;){const cut=buf.indexOf('\n\n');if(cut>=0){const frame=buf.slice(0,cut);buf=buf.slice(cut+2);const [event,data]=frame.split('\n');if(event==='event: heartbeat')continue;return {event:event.slice(7),data:JSON.parse(data.slice(6))};}const c=await reader.read();if(c.done)return null;buf+=new TextDecoder().decode(c.value);}}};}
try{
 app=spawn('node',['server.mjs'],{cwd:process.env.FORM_TEST_ROOT||process.cwd(),env:{...process.env,PORT:'4776',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});app.once('exit',()=>{clearTimeout(t);reject(Error('early exit'));});});
 const initial=await get(0,'view',[mid]);assert.equal(initial.status,200,'owner snapshot endpoint');const snapshot=await initial.json();assert.deepEqual(snapshot.render,render);assert.equal(initial.headers.get('cache-control'),'no-store');
 for(const route of ['view','stream']){assert.equal((await get(9,route,[mid])).status,401);for(const who of [1,2])assert.equal((await get(who,route,[mid])).status,404,'recipients are not owners');assert.equal((await get(0,route,[mid],{origin:'https://evil.example'})).status,403);}
 for(const ids of [[],[mid,mid],Array.from({length:13},(_,i)=>'id'+i),[mid,'missing']])assert.equal((await get(0,'stream',ids)).status,404);
 const stream=await connect(0,[mid,second]);assert.equal(stream.status,200);const first=await stream.next();assert.equal(first.event,'revisions');assert.equal(first.data.elements.length,2);for(const r of first.data.elements)assert.deepEqual(Object.keys(r).sort(),['dbRevision','id','ownerCodeRevision','stateRevision']);
 sharing.state(users[1].id,grant.id,{state:{n:2},expectedRevision:elementStateRevision(render.state)});const next=await stream.next();assert.notEqual(next.data.elements[0].stateRevision,first.data.elements[0].stateRevision);assert.deepEqual(next.data.elements[1],first.data.elements[1]);assert.equal((await (await get(0,'view',[mid])).json()).render.state.n,2);
 db.op({sessionId:conv.id,elementId:mid,op:'create',table:'notes'});const table=await stream.next();assert.ok(table.data.elements[0].dbRevision>next.data.elements[0].dbRevision);
 db.op({sessionId:conv.id,elementId:mid,op:'insert',table:'notes',row:{text:'synthetic'}});const row=await stream.next();assert.ok(row.data.elements[0].dbRevision>table.data.elements[0].dbRevision);
 s.updateMessageRender(users[0].id,mid,{...render,state:{n:2},html:'<p>changed</p>'});const code=await stream.next();assert.notEqual(code.data.elements[0].ownerCodeRevision,row.data.elements[0].ownerCodeRevision);
 sharing.close(users[0].id,grant.id);assert.equal((await get(0,'view',[mid])).status,200);
 const another=await connect(0,[mid]);await another.next();assert.equal((await connect(0,[mid])).status,429);await another.close();await stream.close();await new Promise(r=>setTimeout(r,100));
 for(const cause of ['logout','disable','delete']){const target=s.appendMessage(conv.id,'assistant',{render});const live=await connect(0,[target]);assert.equal(live.status,200);await live.next();if(cause==='logout')s.deleteSession(sessions[0].token);if(cause==='disable')s.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(users[0].id);if(cause==='delete')s.db.prepare('DELETE FROM messages WHERE id=?').run(target);assert.deepEqual(await live.next(),{event:'invalidated',data:{}});assert.equal(await live.next(),null);s.db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(users[0].id);if(cause==='logout')sessions[0]=s.createSession(users[0].id);}
 console.log('PASS owner batch transport: recipient->owner state, DB/code revisions, no payload leakage, three-account denial, Origin/auth, bounds, caps, logout/disable/delete, cleanup; no frontend sync claim');
}finally{for(const r of readers)try{await r.cancel();}catch{}if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit');}db.close();s.close();fs.rmSync(dir,{recursive:true,force:true});}
