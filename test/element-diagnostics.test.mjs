import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const {ElementDB}=await import(pathToFileURL(path.join(root,'db.mjs')));
const {elementEvidence}=await import(pathToFileURL(path.join(root,'element-context.mjs')));
test('static CSS evidence is scoped, revision-bound, read-only and independent of stored counts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-diagnostic-')),s=new Store(dir),db=new ElementDB(path.join(dir,'elements.sqlite'));
 try{
 const a=s.createUser('owner','password123'),b=s.createUser('other','password123'),c=s.createConversation(a.id),foreign=s.createConversation(b.id);
 const render={version:1,name:'Synthetic icon',html:'<span class="icon"></span>',css:'.icon::before{content:"private-marker";position:absolute;background:linear-gradient(red,orange)}',js:'',state:{count:0}};
 const id=s.appendMessage(c.id,'assistant',{render}),fid=s.appendMessage(foreign.id,'assistant',{render:{...render,css:'.foreign{content:"foreign-secret"}'}});
 const before=s.getRender(id);let first;
 for(const count of [0,3]){
 s.updateMessageRender(a.id,id,{...render,state:{count}});
 const e=elementEvidence(s,db,a.id,c.id,id).elements[0],d=e.diagnostics;
 assert.equal(d.kind,'static-css-policy');assert.equal(d.assessment,'inspected-removals');assert.equal(d.visualVerified,false);assert.equal(d.runtimeObserved,false);
 assert.equal(d.css.removedCount,3);assert.ok(d.css.removals.some(r=>r.property==='content'));assert.match(d.codeRevision,/^[a-f0-9]{64}$/);assert.notEqual(d.css.sourceHash,d.css.effectiveHash);
 assert.equal(e.state.count,count);assert.ok(!JSON.stringify(d).includes('private-marker'));assert.ok(!JSON.stringify(d).includes('foreign-secret'));
 if(first)assert.equal(d.codeRevision,first.codeRevision);else first=d;
 }
 const replacement={...before,css:'.icon{color:orange}'};s.updateMessageRender(a.id,id,replacement);
 const current=elementEvidence(s,db,a.id,c.id,id).elements[0].diagnostics;
 assert.notEqual(current.codeRevision,first.codeRevision);assert.equal(current.assessment,'no-css-removals');assert.equal(current.visualVerified,false);
 assert.deepEqual(s.getRender(id),replacement);assert.throws(()=>elementEvidence(s,db,b.id,c.id));assert.throws(()=>elementEvidence(s,db,a.id,c.id,fid));
 s.updateMessageRender(a.id,id,{...render,css:Array.from({length:100},(_,i)=>'.a'+i+'{position:absolute}').join('')});
 const capped=elementEvidence(s,db,a.id,c.id,id).elements[0].diagnostics;assert.equal(capped.css.removals.length,16);assert.equal(capped.css.removedCount,100);assert.equal(capped.css.truncated,true);assert.ok(JSON.stringify(capped).length<4000);
 db.close();const unavailable=elementEvidence(s,db,a.id,c.id,id).elements[0];assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.diagnostics.assessment,'inspected-removals','CSS evidence remains distinct from unavailable records');
 }finally{db.close();s.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('oversized CSS is explicitly unavailable; unchanged source hashes are deterministic',async()=>{
 const {staticElementDiagnostics}=await import(pathToFileURL(path.join(root,'element-diagnostics.mjs')));
 const render={version:1,html:'<p>Fixture</p>',css:'p{color:red}',js:'',state:{}};
 const a=staticElementDiagnostics(render),b=staticElementDiagnostics({...render,state:{count:4}});
 assert.deepEqual(a,b);assert.equal(a.css.removedCount,0);assert.equal(a.assessment,'no-css-removals');
 const large=staticElementDiagnostics({...render,css:' '.repeat(100001)});assert.equal(large.assessment,'unavailable');assert.equal(large.reason,'css-size-limit');assert.equal(large.visualVerified,false);assert.equal(large.css,undefined);
});
