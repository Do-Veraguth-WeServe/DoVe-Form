import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../store.mjs';import {LiveDiagnostics,observationRevisions,boundedObservation} from '../live-diagnostics.mjs';
const observation={runtimeError:false,htmlWarning:true,layout:{nodes:4,width:390,height:120,overflowX:false}};
function fixture(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-live-diag-')),s=new Store(dir);try{const a=s.createUser('alice','password123'),b=s.createUser('bobby','password123'),c=s.createConversation(a.id),c2=s.createConversation(a.id);const render={version:1,html:'<p>secret fixture</p>',css:'',js:'',state:{n:1}},id=s.appendMessage(c.id,'assistant',{render});let now=100;const live=new LiveDiagnostics(s,{now:()=>now}),start=()=>live.start(a.id,'session-a',{conversationId:c.id,messageId:id,...observationRevisions(s.getRender(id))});fn({s,a,b,c,c2,id,render,live,start,tick:n=>now+=n});}finally{s.close();fs.rmSync(dir,{recursive:true,force:true});}}
test('owner/session binding, one-use token and no source leakage',()=>fixture(({a,b,c,c2,id,live,start,render,s})=>{
 const before=s.getRender(id),lease=start();assert.throws(()=>live.record(b.id,'session-a',{token:lease.token,observation}),{status:404});assert.throws(()=>live.record(a.id,'session-b',{token:lease.token,observation}),{status:404});
 live.record(a.id,'session-a',{token:lease.token,observation});assert.throws(()=>live.record(a.id,'session-a',{token:lease.token,observation}),{status:404});
 const value=live.read(a.id,'session-a',c.id,id);assert.equal(value.serverVerified,false);assert.equal(value.visualVerified,false);assert.equal(value.htmlWarning,true);assert.ok(!JSON.stringify(value).includes('secret'));assert.deepEqual(s.getRender(id),before);
 assert.equal(live.read(a.id,'session-b',c.id,id),null);assert.throws(()=>live.read(b.id,'session-a',c.id,id),{status:404});assert.throws(()=>live.read(a.id,'session-a',c2.id,id),{status:404});
 assert.throws(()=>live.start(b.id,'session-b',{conversationId:c.id,messageId:id,...observationRevisions(render)}),{status:404});
}));
test('code AND state changes reject in-flight and stored observations',()=>fixture(({s,a,c,id,render,live,start})=>{
 const lease=start();s.updateMessageRender(a.id,id,{...render,state:{n:2}});assert.throws(()=>live.record(a.id,'session-a',{token:lease.token,observation}),{status:409});
 const current=start();live.record(a.id,'session-a',{token:current.token,observation});assert.ok(live.read(a.id,'session-a',c.id,id));s.updateMessageRender(a.id,id,{...render,html:'<p>new</p>'});assert.equal(live.read(a.id,'session-a',c.id,id),null);
 assert.throws(()=>live.start(a.id,'session-a',{conversationId:c.id,messageId:id,...observationRevisions(render)}),{status:409});
}));
test('TTL and admission limits bound ephemeral retention',()=>fixture(({a,c,id,live,start,tick})=>{
 const l=start();tick(30000);assert.throws(()=>live.record(a.id,'session-a',{token:l.token,observation}),{status:404});
 const next=start();live.record(a.id,'session-a',{token:next.token,observation});tick(120000);assert.equal(live.read(a.id,'session-a',c.id,id),null);
 for(let i=0;i<16;i++)start();assert.throws(start,{status:429});tick(30000);assert.ok(start());
}));
test('strict projection rejects arbitrary strings, fields, fractions and over-budget geometry',()=>{
 assert.deepEqual(boundedObservation(observation),observation);
 for(const bad of [null,{},[],{...observation,error:'secret'},{...observation,runtimeError:'false'},{...observation,layout:{...observation.layout,text:'secret'}},...[-1,601,1.5,NaN,Infinity].map(nodes=>({...observation,layout:{...observation.layout,nodes}}))])assert.throws(()=>boundedObservation(bad),{status:400});
 const result=boundedObservation(observation);result.layout.width=1;assert.equal(observation.layout.width,390);
});
