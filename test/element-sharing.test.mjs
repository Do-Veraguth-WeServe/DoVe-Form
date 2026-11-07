import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../store.mjs';
import {ElementDB} from '../db.mjs';
import {ElementSharing,elementCodeRevision} from '../element-sharing.mjs';
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
 assert.deepEqual(Object.keys(view).sort(),['canEdit','codeRevision','id','render']);
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
 for(const op of ['create','drop','replaceRender','unknown'])assert.throws(()=>x.data(b.id,g.id,{op,table:'counter'}));
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
