import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {ElementStreams} from '../element-stream.mjs';
const render={version:1,name:'Fixture',html:'<p>ok</p>',css:'',js:'',state:{n:1}};
class Response extends EventEmitter {
 constructor({backpressure=false}={}){super();this.frames=[];this.backpressure=backpressure;this.ended=false;}
 writeHead(status,headers){this.status=status;this.headers=headers;}
 write(s){this.frames.push(s);return !this.backpressure;}
 end(){this.ended=true;this.emit('close');}
}
function fixture(){let locked=false;return {locked(fn){assert.equal(locked,false);locked=true;try{return fn();}finally{locked=false;}},authorize(){assert.equal(locked,true);return {render};},isLocked:()=>locked};}
test('session, ACL and snapshot write share the transaction; closure releases slots',()=>{
 const sharing=fixture(),streams=new ElementStreams(sharing),res=new Response();
 const write=res.write.bind(res);res.write=s=>{assert.equal(sharing.isLocked(),true);return write(s);};
 assert.equal(streams.open({uid:'a',id:'g',res,sessionValid:()=>{assert.equal(sharing.isLocked(),true);return true;}}),true);
 assert.equal(res.frames.length,1);assert.match(res.frames[0],/event: snapshot/);assert.equal(streams.counts.get('a'),1);
 res.emit('close');assert.equal(streams.counts.size,0);assert.equal(res.ended,true);
});
test('backpressure closes rather than queueing more private snapshots',()=>{
 const streams=new ElementStreams(fixture()),res=new Response({backpressure:true});
 streams.open({uid:'a',id:'g',res,sessionValid:()=>true});assert.equal(res.frames.length,1);assert.equal(res.ended,true);assert.equal(streams.counts.size,0);
});
test('expired session and database contention fail closed with generic invalidation',()=>{
 for(const failure of ['session','lock','acl']){
  const sharing=fixture();if(failure==='lock')sharing.locked=()=>{throw Error('private SQL details');};
  if(failure==='acl')sharing.authorize=()=>{throw Error('private source details');};
  const streams=new ElementStreams(sharing),res=new Response();streams.open({uid:'a',id:'g',res,sessionValid:()=>failure!=='session'});
  assert.equal(res.frames.length,1);assert.match(res.frames[0],/event: invalidated/);assert.doesNotMatch(res.frames[0],/private|render|state/);assert.equal(res.ended,true);assert.equal(streams.counts.size,0);
 }
});
test('per-account stream cap does not consume a slot for rejected clients',()=>{
 const streams=new ElementStreams(fixture(),{maxPerUser:1}),first=new Response(),denied=new Response(),other=new Response();
 assert.equal(streams.open({uid:'a',id:'g',res:first,sessionValid:()=>true}),true);
 assert.equal(streams.open({uid:'a',id:'g',res:denied,sessionValid:()=>true}),false);assert.equal(denied.status,undefined);
 assert.equal(streams.open({uid:'b',id:'h',res:other,sessionValid:()=>true}),true);first.end();other.end();assert.equal(streams.counts.size,0);
});
