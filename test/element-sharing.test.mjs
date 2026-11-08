import {ownerCodeText} from '../owner-code.mjs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../store.mjs';
import {ElementDB} from '../db.mjs';
import {ElementSharing,elementCodeRevision,elementStateRevision} from '../element-sharing.mjs';
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-grants-'));
 const s=new Store(dir),db=new ElementDB(path.join(dir,'elements.sqlite'));
 try{
  const a=s.createUser('alice','password123'),b=s.createUser('bobby','password123'),c=s.createUser('carol','password123');
  const conv=s.createConversation(a.id),other=s.createConversation(c.id);
  const render={version:1,name:'Shared counter',html:'<p id="n"></p>',css:'',js:'ui.text("n",state.n)',state:{n:4},actions:[{name:'secret',url:'https://example.com/',method:'GET',args:{}}]};
  const mid=s.appendMessage(conv.id,'assistant',{render}),foreign=s.appendMessage(other.id,'assistant',{render});
  const x=new ElementSharing(s,db),input={messageId:mid,revision:elementCodeRevision(render),recipient:'bobby'};
  for(const [sessionId,elementId,n] of [[conv.id,mid,4],[other.id,foreign,99]]){
   assert.equal(db.op({sessionId,elementId,op:'create',table:'counter'}).status,200);
   assert.equal(db.op({sessionId,elementId,op:'insert',table:'counter',row:{n}}).status,200);
  }
  fn({s,db,a,b,c,conv,other,mid,foreign,render,x,input});
 }finally{db.close();s.close();fs.rmSync(dir,{recursive:true,force:true});}
}
test('opt-in acceptance and uniform foreign denial, no copied chats or capability transfer',()=>fixture(({s,a,b,c,mid,x,input})=>{
 assert.throws(()=>x.offer(c.id,input));assert.throws(()=>x.offer(a.id,{...input,revision:'stale'}));
 const g=x.offer(a.id,input);assert.deepEqual(x.offer(a.id,input),g);
 assert.throws(()=>x.view(b.id,g.id));assert.throws(()=>x.accept(c.id,g.id));assert.throws(()=>x.accept(a.id,g.id));
 assert.deepEqual(x.accept(b.id,g.id),g);assert.deepEqual(x.accept(b.id,g.id),g);
 const view=x.view(b.id,g.id);assert.equal(view.render.state.n,4);assert.equal(view.render.actions,undefined);assert.equal(view.canEdit,false);
 assert.deepEqual(Object.keys(view).sort(),['canEdit','codeRevision','dbRevision','id','render','stateRevision']);
 assert.equal(s.messageOwner(mid).userId,a.id);assert.equal(s.listConversations(b.id).conversations.length,0);
 assert.throws(()=>s.updateMessageRender(b.id,mid,view.render));
 const error=fn=>{try{fn();assert.fail('should deny');}catch(e){return e.message;}};
 assert.equal(error(()=>x.view(c.id,g.id)),error(()=>x.view(c.id,'missing')));
 assert.throws(()=>x.close(c.id,g.id));
}));
test('actual shared rows update one namespace; forged namespace and schema operations cannot escape',()=>fixture(({db,a,b,c,conv,other,mid,foreign,x,input})=>{
 const g=x.offer(a.id,input);x.accept(b.id,g.id);
 const payload={op:'select',table:'counter',sessionId:other.id,elementId:foreign};
 assert.equal(x.data(b.id,g.id,payload).result.rows[0].n,4);
 assert.equal(x.data(b.id,g.id,{...payload,op:'update',id:1,patch:{n:7}}).status,200);
 assert.equal(db.op({sessionId:conv.id,elementId:mid,op:'select',table:'counter'}).result.rows[0].n,7);
 assert.equal(db.op({sessionId:other.id,elementId:foreign,op:'select',table:'counter'}).result.rows[0].n,99);
 assert.equal(x.data(b.id,g.id,{op:'create',table:'counter'}).status,409);
 for(const op of ['drop','replaceRender','unknown'])assert.throws(()=>x.data(b.id,g.id,{op,table:'counter'}));
 assert.throws(()=>x.data(c.id,g.id,payload));
 assert.equal(x.data(b.id,g.id,{op:'insert',table:'counter',row:{n:8}}).status,200);
 assert.equal(x.data(b.id,g.id,{op:'delete',table:'counter',id:2}).status,200);
 assert.equal(x.data(b.id,g.id,{op:'select',table:'counter; DROP TABLE users'}).status,400);
 assert.equal(x.data(a.id,g.id,{op:'select',table:'counter'}).result.rows.length,1);
}));
test('revocation rechecks every read/write; new grant never reactivates old token',()=>fixture(({a,b,x,input})=>{
 const g=x.offer(a.id,input);x.accept(b.id,g.id);const cached=x.view(b.id,g.id);
 x.close(a.id,g.id);x.close(a.id,g.id);
 assert.throws(()=>x.view(b.id,g.id));assert.throws(()=>x.accept(b.id,g.id));
 for(const op of ['select','insert','update','delete'])assert.throws(()=>x.data(b.id,g.id,{op,table:'counter',id:1,row:{n:8},patch:{n:8}}));
 const next=x.offer(a.id,input);assert.notEqual(next.id,g.id);x.accept(b.id,next.id);assert.equal(x.view(b.id,next.id).render.state.n,cached.render.state.n);
 assert.throws(()=>x.view(b.id,g.id));x.close(b.id,next.id);assert.throws(()=>x.view(b.id,next.id));assert.throws(()=>x.accept(b.id,next.id));
}));
test('state updates remain visible, code changes fail closed until fresh acceptance',()=>fixture(({s,a,b,mid,render,x,input})=>{
 const g=x.offer(a.id,input);x.accept(b.id,g.id);
 s.updateMessageRender(a.id,mid,{...render,state:{n:12}});assert.equal(x.view(b.id,g.id).render.state.n,12);
 const changed={...render,html:'<p>New code</p>'};s.updateMessageRender(a.id,mid,changed);
 assert.throws(()=>x.view(b.id,g.id));assert.throws(()=>x.data(b.id,g.id,{op:'select',table:'counter'}));
 assert.throws(()=>x.offer(a.id,input));const next=x.offer(a.id,{...input,revision:elementCodeRevision(changed)});assert.throws(()=>x.view(b.id,next.id));x.accept(b.id,next.id);assert.equal(x.view(b.id,next.id).render.html,changed.html);
}));
test('disabled accounts and deleted source are unavailable; additive table survives reopening',()=>fixture(({s,db,a,b,conv,x,input})=>{
 const g=x.offer(a.id,input);x.accept(b.id,g.id);
 const reopened=new ElementSharing(s,db);assert.equal(reopened.view(b.id,g.id).render.state.n,4);
 for(const user of [a,b]){s.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(user.id);assert.throws(()=>x.view(b.id,g.id));assert.throws(()=>x.data(b.id,g.id,{op:'select',table:'counter'}));s.db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(user.id);}
 s.deleteConversation(a.id,conv.id);assert.throws(()=>x.view(b.id,g.id));assert.equal(s.db.prepare('SELECT count(*) n FROM element_grants WHERE id=?').get(g.id).n,0);
}));
test('pending offers cannot read and quotas do not auto-share other elements',()=>fixture(({s,a,b,render,x})=>{
 const conv=s.createConversation(a.id);let first;
 for(let i=0;i<40;i++){const mid=s.appendMessage(conv.id,'assistant',{render});const g=x.offer(a.id,{messageId:mid,revision:elementCodeRevision(render),recipient:'bobby'});first??=g;assert.throws(()=>x.data(b.id,g.id,{op:'select',table:'counter'}));}
 const mid=s.appendMessage(conv.id,'assistant',{render});const input={messageId:mid,revision:elementCodeRevision(render),recipient:'bobby'};
 assert.throws(()=>x.offer(a.id,input),/Zu viele/);x.close(a.id,first.id);assert.ok(x.offer(a.id,input).id);
}));


test('grant listing is paginated and account scoped without pending source data',()=>fixture(({s,a,b,c,mid,render,x,input})=>{
 const first=x.offer(a.id,input);const conv=s.createConversation(a.id);
 for(let i=0;i<4;i++)x.offer(a.id,{...input,messageId:s.appendMessage(conv.id,'assistant',{render})});
 assert.deepEqual(x.list(c.id),{grants:[],next:null});
 const seen=[];let after='';
 do{const page=x.list(b.id,{after,limit:2});assert.ok(page.grants.length<=2);for(const g of page.grants){assert.deepEqual(Object.keys(g).sort(),['direction','id','name','peer','status']);assert.equal(g.peer,'alice');assert.equal(g.direction,'incoming');assert.equal(g.status,'pending');seen.push(g.id);}after=page.next;}while(after);
 assert.equal(seen.length,5);assert.equal(new Set(seen).size,5);
 assert.equal(x.list(a.id).grants[0].direction,'outgoing');
 for(const limit of [0,41,1.5,'2'])assert.throws(()=>x.list(b.id,{limit}));
 assert.throws(()=>x.list(b.id,{after:'x'.repeat(37)}));
 x.close(a.id,first.id);assert.deepEqual(x.list(b.id).grants.find(g=>g.id===first.id),{id:first.id,direction:'incoming',status:'revoked'});
 const next=x.offer(a.id,input);s.updateMessageRender(a.id,mid,{...render,js:'ui.text("n",99)'});
 assert.deepEqual(x.list(b.id).grants.find(g=>g.id===next.id),{id:next.id,direction:'incoming',status:'unavailable'});
 s.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(b.id);assert.throws(()=>x.list(b.id));
}));
test('state compare-and-set detects stale snapshots without editing code',()=>fixture(({s,a,b,c,mid,foreign,render,x,input})=>{
 const g=x.offer(a.id,input);x.accept(b.id,g.id);
 const snapshot=x.view(b.id,g.id),stateRevision=snapshot.stateRevision;
 const changed=x.state(b.id,g.id,{state:{n:5},expectedRevision:stateRevision,render:{html:'forged'},messageId:foreign});
 assert.equal(changed.status,200);assert.equal(s.getRender(mid).state.n,5);assert.equal(s.getRender(mid).html,render.html);assert.deepEqual(s.getRender(mid).actions,render.actions);assert.equal(s.getRender(foreign).state.n,4);
 const stale=x.state(a.id,g.id,{state:{n:6},expectedRevision:stateRevision});
 assert.equal(stale.status,409);assert.deepEqual(stale.result.state,{n:5});assert.equal(s.getRender(mid).state.n,5);
 const ownerWrite=x.state(a.id,g.id,{state:{n:7},expectedRevision:changed.result.stateRevision});assert.equal(ownerWrite.status,200);
 s.updateMessageRender(a.id,mid,{...render,state:{n:8}});
 assert.equal(x.state(b.id,g.id,{state:{n:9},expectedRevision:ownerWrite.result.stateRevision}).status,409);
 assert.throws(()=>x.state(c.id,g.id,{state:{n:99},expectedRevision:ownerWrite.result.stateRevision}));
 x.close(a.id,g.id);assert.throws(()=>x.state(b.id,g.id,{state:{n:99},expectedRevision:ownerWrite.result.stateRevision}));
 assert.equal(s.getRender(mid).state.n,8);
}));
test('state errors roll back and unavailable grants cannot disclose conflict state',()=>fixture(({s,a,b,mid,render,x,input})=>{
 const g=x.offer(a.id,input);
 assert.throws(()=>x.state(b.id,g.id,{state:{n:1}}));x.accept(b.id,g.id);
 const snap=x.view(b.id,g.id);
 for(const state of [null,[],false,{x:'ö'.repeat(2200)}])assert.throws(()=>x.state(b.id,g.id,{state,expectedRevision:snap.stateRevision}));
 assert.equal(x.state(b.id,g.id,{state:{n:1}}).status,409);
 assert.equal(x.state(b.id,g.id,{state:{n:1},expectedRevision:snap.stateRevision}).status,200);
 s.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(a.id);assert.throws(()=>x.state(b.id,g.id,{state:{n:2}}));s.db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(a.id);
 s.updateMessageRender(a.id,mid,{...render,html:'<p>changed</p>'});assert.throws(()=>x.state(b.id,g.id,{state:{n:2}}));
}));
test('recipient create compatibility never changes schema and matches owner response',()=>fixture(({db,a,b,conv,mid,x,input})=>{
 const g=x.offer(a.id,input);x.accept(b.id,g.id);
 const schema=()=>db.db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all();const before=schema();
 for(const columns of [undefined,['n'],['unrelated'],{bad:true}]){
  const request={op:'create',table:'counter',columns};
  assert.deepEqual(x.data(b.id,g.id,request),x.data(a.id,g.id,request));
 }
 for(const table of ['missing','COUNTER','counter;DROP TABLE users'])assert.throws(()=>x.data(b.id,g.id,{op:'create',table}));
 assert.throws(()=>x.data(b.id,g.id,{op:'drop',table:'counter'}));assert.deepEqual(schema(),before);
 assert.equal(db.op({sessionId:conv.id,elementId:mid,op:'select',table:'counter'}).result.rows[0].n,4);
 x.close(a.id,g.id);assert.throws(()=>x.data(b.id,g.id,{op:'create',table:'counter'}));
}));

test('separate recipients share conflict token and failed persistence is atomic',()=>fixture(({s,a,b,c,mid,x,input})=>{
 const gb=x.offer(a.id,input),gc=x.offer(a.id,{...input,recipient:'carol'});x.accept(b.id,gb.id);x.accept(c.id,gc.id);
 const bToken=x.view(b.id,gb.id).stateRevision,cToken=x.view(c.id,gc.id).stateRevision;assert.equal(bToken,cToken);
 assert.equal(x.state(b.id,gb.id,{state:{n:10},expectedRevision:bToken}).status,200);
 assert.equal(x.state(c.id,gc.id,{state:{n:11},expectedRevision:cToken}).status,409);
 const original=s.updateMessageRender;const latest=x.view(c.id,gc.id).stateRevision;
 try{s.updateMessageRender=function(...args){original.apply(this,args);throw Error('fixture disk failure');};assert.throws(()=>x.state(c.id,gc.id,{state:{n:12},expectedRevision:latest}),/fixture disk failure/);}finally{s.updateMessageRender=original;}
 assert.equal(s.getRender(mid).state.n,10);assert.equal(x.view(b.id,gb.id).stateRevision,latest);
 assert.equal(x.state(c.id,gc.id,{state:{n:13},expectedRevision:latest}).status,200);
 x.close(a.id,gb.id);assert.throws(()=>x.view(b.id,gb.id));assert.equal(x.view(c.id,gc.id).render.state.n,13);
}));

// Real second process at check/use boundary; no timing sleeps.
function competingWrite(s, sql, params) {
 const file=s.db.prepare('PRAGMA database_list').all().find(d=>d.name==='main').file;
 const script="import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA busy_timeout=0');try{d.prepare(process.argv[2]).run(...JSON.parse(process.argv[3]));console.log('written');}catch(e){if(/locked|busy/i.test(e.message))console.log('locked');else throw e;}finally{d.close();}";
 const child=spawnSync(process.execPath,['--input-type=module','-e',script,file,sql,JSON.stringify(params)],{encoding:'utf8',timeout:5000});
 assert.equal(child.status,0,child.stderr);return child.stdout.trim();
}
test('cross-process revocation cannot interleave shared row authorization and use',()=>fixture(({s,db,a,b,x,input})=>{
 const g=x.offer(a.id,input);x.accept(b.id,g.id);
 const original=db.op;let observed;
 try{
  db.op=function(...args){observed=competingWrite(s,"UPDATE element_grants SET status='revoked' WHERE id=?",[g.id]);return original.apply(this,args);};
  assert.equal(x.data(b.id,g.id,{op:'update',table:'counter',id:1,patch:{n:20}}).status,200);
 }finally{db.op=original;}
 assert.equal(observed,'locked','ACL lock must span the separate element database operation');
 assert.equal(competingWrite(s,"UPDATE element_grants SET status='revoked' WHERE id=?",[g.id]),'written');
 for(const op of ['select','update','create'])assert.throws(()=>x.data(b.id,g.id,{op,table:'counter',id:1,patch:{n:30}}));
 assert.equal(competingWrite(s,"UPDATE element_grants SET status='revoked' WHERE id=?",[g.id]),'written');
}));
test('cross-process disable cannot interleave offer or acceptance checks',()=>fixture(({s,a,b,x,input})=>{
 const getRender=s.getRender;let offerRace;
 try{s.getRender=function(...args){const value=getRender.apply(this,args);offerRace=competingWrite(s,'UPDATE users SET disabled=1 WHERE id=?',[b.id]);return value;};
  x.offer(a.id,input);
 }finally{s.getRender=getRender;}
 assert.equal(offerRace,'locked');
 const g=x.offer(a.id,input);const source=x.source;let acceptRace;
 try{x.source=function(...args){const value=source.apply(this,args);acceptRace=competingWrite(s,'UPDATE users SET disabled=1 WHERE id=?',[b.id]);return value;};
  x.accept(b.id,g.id);
 }finally{x.source=source;}
 assert.equal(acceptRace,'locked');
 assert.equal(competingWrite(s,'UPDATE users SET disabled=1 WHERE id=?',[b.id]),'written');
 assert.throws(()=>x.view(b.id,g.id));assert.throws(()=>x.accept(b.id,g.id));
 assert.equal(competingWrite(s,'UPDATE users SET disabled=0 WHERE id=?',[b.id]),'written');
}));

test('shared snapshots are coherent against cross-process revocation',()=>fixture(({s,a,b,x,input})=>{
 const g=x.offer(a.id,input);x.accept(b.id,g.id);
 const original=s.getRender;
 for(const read of [()=>x.view(b.id,g.id),()=>x.list(b.id)]){
  let observed;
  try{s.getRender=function(...args){const value=original.apply(this,args);observed=competingWrite(s,"UPDATE element_grants SET status='revoked' WHERE id=?",[g.id]);return value;};read();}
  finally{s.getRender=original;}
  assert.equal(observed,'locked');
 }
 // A database-operation throw must not retain the ACL lock.
 const dbOp=x.elementDB.op;
 try{x.elementDB.op=()=>{throw Error('fixture failure');};assert.throws(()=>x.data(b.id,g.id,{op:'select',table:'counter'}),/fixture failure/);}
 finally{x.elementDB.op=dbOp;}
 assert.equal(competingWrite(s,"UPDATE element_grants SET status='revoked' WHERE id=?",[g.id]),'written');
 assert.throws(()=>x.view(b.id,g.id));
 assert.deepEqual(x.list(b.id).grants,[{id:g.id,direction:'incoming',status:'revoked'}]);
}));


test('owner persistence preserves legacy saves but requires CAS for active shared code',()=>fixture(({s,a,b,c,mid,render,x,input})=>{
 const expectedCodeRevision=createHash('sha256').update(ownerCodeText(render)).digest('hex');
 const first=x.ownerSave(a.id,mid,{state:{n:5}});assert.equal(first.status,200);
 const g=x.offer(a.id,input);assert.equal(x.ownerSave(a.id,mid,{state:{n:6}}).status,409); // pending offers require snapshots
 x.accept(b.id,g.id);const token=x.view(b.id,g.id).stateRevision;
 assert.equal(x.ownerSave(a.id,mid,{state:{n:7}}).status,409);
 assert.throws(()=>x.ownerSave(b.id,mid,{state:{n:7}}));assert.throws(()=>x.ownerSave(c.id,mid,{state:{n:7}}));
 assert.equal(x.state(b.id,g.id,{state:{n:8},expectedRevision:token,expectedCodeRevision}).status,200);
 assert.equal(x.ownerSave(a.id,mid,{state:{n:9},expectedRevision:token,expectedCodeRevision}).status,409);
 const latest=x.view(b.id,g.id).stateRevision;
 for(const state of [null,[],false,{x:'ö'.repeat(2200)}])assert.throws(()=>x.ownerSave(a.id,mid,{state,expectedRevision:latest,expectedCodeRevision}));
 assert.equal(s.getRender(mid).state.n,8);assert.deepEqual(s.getRender(mid).actions,render.actions);
 assert.equal(x.ownerSave(a.id,mid,{state:{n:10},expectedRevision:latest,expectedCodeRevision}).status,200);
 assert.equal(x.state(b.id,g.id,{state:{n:11},expectedRevision:latest,expectedCodeRevision}).status,409);
 x.close(a.id,g.id);assert.equal(x.ownerSave(a.id,mid,{state:{n:12}}).status,409);
 // Even unshared clients opting into CAS must not overwrite stale snapshots.
 assert.equal(x.ownerSave(a.id,mid,{state:{n:13},expectedRevision:latest,expectedCodeRevision}).status,409);
}));
test('owner code replacement is atomic, versioned and invalidates accepted code',()=>fixture(({s,a,b,mid,render,x,input})=>{
 const expectedCodeRevision=createHash('sha256').update(ownerCodeText(render)).digest('hex');
 const g=x.offer(a.id,input);x.accept(b.id,g.id);const token=x.view(b.id,g.id).stateRevision;
 const versionCount=()=>s.db.prepare('SELECT count(*) n FROM versions WHERE message_id=?').get(mid).n;
 const before=versionCount(),original=s.replaceRender;
 try{s.replaceRender=function(...args){original.apply(this,args);throw Error('fixture write failure');};
 assert.throws(()=>x.ownerSave(a.id,mid,{render:{...render,html:'new'},expectedRevision:token,expectedCodeRevision}),/fixture write failure/);
 }finally{s.replaceRender=original;}
 assert.equal(versionCount(),before);assert.equal(s.getRender(mid).html,render.html);
 assert.equal(x.ownerSave(a.id,mid,{render:{...render,html:'new'},expectedRevision:token,expectedCodeRevision}).status,200);
 assert.equal(versionCount(),before+1);assert.throws(()=>x.view(b.id,g.id));
 assert.equal(x.ownerSave(a.id,mid,{state:{n:14}}).status,409,'old code grants still require current snapshot tokens');
 s.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(a.id);assert.throws(()=>x.ownerSave(a.id,mid,{state:{n:15}}));
}));
test('owner CAS holds writer lock through snapshot and persistence',()=>fixture(({s,a,b,mid,render,x,input})=>{
 const expectedCodeRevision=createHash('sha256').update(ownerCodeText(render)).digest('hex');
 const g=x.offer(a.id,input);x.accept(b.id,g.id);const token=x.view(b.id,g.id).stateRevision;
 const original=s.updateMessageRender;let observed;
 try{s.updateMessageRender=function(...args){observed=competingWrite(s,'UPDATE messages SET render=? WHERE id=?',[JSON.stringify({...render,state:{n:99}}),mid]);return original.apply(this,args);};
 assert.equal(x.ownerSave(a.id,mid,{state:{n:20},expectedRevision:token,expectedCodeRevision}).status,200);
 }finally{s.updateMessageRender=original;}
 assert.equal(observed,'locked');assert.equal(s.getRender(mid).state.n,20);
 assert.equal(competingWrite(s,'UPDATE messages SET render=? WHERE id=?',[JSON.stringify({...render,state:{n:21}}),mid]),'written');
 assert.equal(x.ownerSave(a.id,mid,{state:{n:22},expectedRevision:token,expectedCodeRevision}).status,409);assert.equal(s.getRender(mid).state.n,21);
}));

for(const change of ['html','actions'])test('owner snapshot rejects same-state '+change+' replacement and state write',()=>fixture(({s,a,mid,render,x})=>{
 const code=r=>createHash('sha256').update(ownerCodeText(r)).digest('hex');
 const old=s.getRender(mid),expectedCodeRevision=code(old),expectedRevision=elementStateRevision(old.state);
 const newer=change==='html'?{...old,html:'<p>New code</p>'}:{...old,actions:[]};
 s.updateMessageRender(a.id,mid,newer);
 for(const payload of [{state:{n:55}},{render:old}])assert.equal(x.ownerSave(a.id,mid,{...payload,expectedRevision,expectedCodeRevision}).status,409);
 assert.deepEqual(s.getRender(mid),newer);
 assert.equal(x.ownerSave(a.id,mid,{state:{n:6},expectedRevision,expectedCodeRevision:code(newer)}).status,200);
}));

for(const phase of ['pending','active','revoked','declined','invalidated'])test('grant-era owner saves fail closed for legacy clients: '+phase,()=>fixture(({s,a,b,mid,x,input})=>{
 const g=x.offer(a.id,input);
 if(phase!=='pending')x.accept(b.id,g.id);
 if(phase==='revoked')x.close(a.id,g.id);
 if(phase==='declined')x.close(b.id,g.id);
 if(phase==='invalidated')s.updateMessageRender(a.id,mid,{...s.getRender(mid),html:'<p>Changed</p>'});
 const current=s.getRender(mid),expectedRevision=elementStateRevision(current.state);
 const expectedCodeRevision=createHash('sha256').update(ownerCodeText(current)).digest('hex');
 for(const payload of [{state:{n:77}},{render:{...current,html:'legacy'}}]){
  for(const tokens of [{},{expectedRevision},{expectedCodeRevision},{expectedRevision,expectedCodeRevision:null}]){
   assert.equal(x.ownerSave(a.id,mid,{...payload,...tokens}).status,409);
   assert.deepEqual(s.getRender(mid),current);
  }
 }
 assert.equal(x.ownerSave(a.id,mid,{state:{n:78},expectedRevision,expectedCodeRevision}).status,200);
}));

for(const phase of ['pending','active','revoked','declined','invalidated'])test('recipient deletion preserves grant-era owner protection: '+phase,()=>fixture(({s,db,a,b,mid,x,input})=>{
 const g=x.offer(a.id,input);
 if(phase!=='pending')x.accept(b.id,g.id);
 if(phase==='revoked')x.close(a.id,g.id);
 if(phase==='declined')x.close(b.id,g.id);
 if(phase==='invalidated')s.updateMessageRender(a.id,mid,{...s.getRender(mid),html:'<p>Changed</p>'});
 s.db.prepare('DELETE FROM users WHERE id=?').run(b.id);
 assert.equal(s.db.prepare('SELECT count(*) n FROM element_grants WHERE message_id=?').get(mid).n,0);
 const reopened=new ElementSharing(s,db),current=s.getRender(mid);
 assert.throws(()=>reopened.view(b.id,g.id));
 for(const payload of [{state:{n:88}},{render:{...current,html:'legacy'}}]){
  assert.equal(reopened.ownerSave(a.id,mid,payload).status,409);
  assert.deepEqual(s.getRender(mid),current);
 }
 const expectedRevision=elementStateRevision(current.state),expectedCodeRevision=createHash('sha256').update(ownerCodeText(current)).digest('hex');
 assert.equal(reopened.ownerSave(a.id,mid,{state:{n:89},expectedRevision,expectedCodeRevision}).status,200);
}));

test('grant marker backfills existing grants without changing source, survives reopen and cascades with source',()=>fixture(({s,db,a,b,conv,mid,x,input})=>{
 x.offer(a.id,input);const before=s.getRender(mid);
 s.db.exec('DROP TABLE element_grant_history'); // synthetic pre-marker installation
 const reopened=new ElementSharing(s,db);
 assert.deepEqual(s.getRender(mid),before);
 assert.equal(s.db.prepare('SELECT count(*) n FROM element_grant_history WHERE message_id=?').get(mid).n,1);
 s.db.prepare('DELETE FROM users WHERE id=?').run(b.id);
 new ElementSharing(s,db);
 assert.equal(reopened.ownerSave(a.id,mid,{state:{n:80}}).status,409);
 assert.deepEqual(s.db.prepare('PRAGMA table_info(element_grant_history)').all().map(c=>c.name),['message_id']);
 assert.equal(s.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 s.deleteConversation(a.id,conv.id);
 assert.equal(s.db.prepare('SELECT count(*) n FROM element_grant_history').get().n,0);
}));
test('failed offer rolls back marker and grant together; never-offered elements stay private-compatible',()=>fixture(({s,a,mid,x,input})=>{
 s.db.exec("CREATE TRIGGER fixture_fail_marker BEFORE INSERT ON element_grant_history BEGIN SELECT RAISE(ABORT,'fixture marker failure'); END");
 assert.throws(()=>x.offer(a.id,input),/fixture marker failure/);
 assert.equal(s.db.prepare('SELECT count(*) n FROM element_grants').get().n,0);
 assert.equal(s.db.prepare('SELECT count(*) n FROM element_grant_history').get().n,0);
 assert.equal(x.ownerSave(a.id,mid,{state:{n:9}}).status,200);
 s.db.exec('DROP TRIGGER fixture_fail_marker');
 assert.ok(x.offer(a.id,input).id);
 assert.equal(x.ownerSave(a.id,mid,{state:{n:10}}).status,409);
}));
