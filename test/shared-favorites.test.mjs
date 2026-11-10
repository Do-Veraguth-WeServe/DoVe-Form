import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../store.mjs';import {ElementDB} from '../db.mjs';
const {ElementSharing,elementCodeRevision}=await import(path.join(process.env.FORM_TEST_ROOT||process.cwd(),'element-sharing.mjs'));
test('shared favorites are persistent personal metadata, never grants or copies',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-favorites-')),s=new Store(dir),db=new ElementDB(path.join(dir,'elements.sqlite'));
 try{const [a,b,c]=['alice','bobby','carol'].map(n=>s.createUser(n,'password123'));const conv=s.createConversation(a.id),render={version:1,name:'Favorite',html:'<p>Shared</p>',css:'',js:'',state:{n:1}},mid=s.appendMessage(conv.id,'assistant',{render});const x=new ElementSharing(s,db),input={messageId:mid,revision:elementCodeRevision(render),recipient:'bobby'},g=x.offer(a.id,input);
 assert.throws(()=>x.favorite(b.id,g.id,true));x.accept(b.id,g.id);assert.throws(()=>x.favorite(c.id,g.id,true));assert.throws(()=>x.favorite(b.id,g.id,'true'));
 x.favorite(b.id,g.id,true);x.favorite(b.id,g.id,true);assert.equal(x.list(b.id).grants[0].favorite,true);assert.equal(x.list(a.id).grants[0].favorite,false);assert.deepEqual(x.list(c.id).grants,[]);
 const reopened=new ElementSharing(s,db);assert.equal(reopened.list(b.id).grants[0].favorite,true);assert.deepEqual(s.getRender(mid),render);assert.equal(s.listConversations(b.id).conversations.length,0);
 x.favorite(a.id,g.id,true);x.favorite(b.id,g.id,false);assert.equal(x.list(a.id).grants[0].favorite,true);assert.equal(x.list(b.id).grants[0].favorite,false);x.favorite(b.id,g.id,true);
 x.close(a.id,g.id);assert.equal(x.list(b.id).grants[0].favorite,undefined);assert.throws(()=>x.favorite(b.id,g.id,true));assert.throws(()=>x.view(b.id,g.id));const next=x.offer(a.id,input);x.accept(b.id,next.id);assert.equal(x.list(b.id).grants.find(v=>v.id===next.id).favorite,false);
 s.updateMessageRender(a.id,mid,{...render,html:'<p>Changed code</p>'});assert.equal(x.list(b.id).grants.find(v=>v.id===next.id).status,'unavailable');assert.throws(()=>x.favorite(b.id,next.id,true));
 s.db.prepare('DELETE FROM users WHERE id=?').run(b.id);assert.equal(s.db.prepare('SELECT count(*) n FROM element_grant_favorites WHERE user_id=?').get(b.id).n,0);
 }finally{db.close();s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
