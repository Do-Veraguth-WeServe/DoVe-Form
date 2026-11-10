import {test} from 'node:test';import assert from 'node:assert/strict';
import {createEngineSpare} from '../src/engine-spare.js';
function fixture(){
 const workers=[],events={},timers=new Map();let visible=true,n=0,fail=false;
 const pool=createEngineSpare({create(){if(fail)throw Error('limit');const w={terminated:0,terminate(){this.terminated++}};workers.push(w);return w;},visible:()=>visible,listen:(k,f)=>events[k]=f,setTimer:(fn,ms)=>{assert.equal(ms,15000);timers.set(++n,fn);return n},clearTimer:id=>timers.delete(id)});
 return {pool,workers,events,timers,hide(){visible=false;events.visibilitychange()},show(){visible=true},fail(){fail=true}};
}
test('one idle fresh engine, acquired runtime never returned or reused',()=>{const f=fixture();const first=f.pool.take();f.pool.warm();f.pool.warm();assert.equal(f.workers.length,2);const second=f.pool.take();assert.notEqual(first,second);assert.equal(second.onerror,null);assert.equal(f.timers.size,0);assert.notEqual(f.pool.take(),second);assert.equal(first.terminated,0);});
test('expiry terminates only idle engine',()=>{const f=fixture();const active=f.pool.take();f.pool.warm();[...f.timers.values()][0]();assert.equal(f.workers[1].terminated,1);assert.equal(active.terminated,0);assert.notEqual(f.pool.take(),f.workers[1]);});
test('hidden/pagehide clear spare and hidden warm is disabled',()=>{const f=fixture();f.pool.warm();f.hide();assert.equal(f.workers[0].terminated,1);f.pool.warm();assert.equal(f.workers.length,1);f.show();f.pool.warm();f.events.pagehide();assert.equal(f.workers[1].terminated,1);assert.equal(f.timers.size,0);});
test('failed spare is discarded and construction errors do not break ready view',()=>{const f=fixture();f.pool.warm();const w=f.workers[0];w.onerror();assert.equal(w.terminated,1);f.fail();assert.doesNotThrow(()=>f.pool.warm());assert.throws(()=>f.pool.take(),/limit/);});
test('stale spare error cannot terminate its successor',()=>{const f=fixture();f.pool.warm();const oldError=f.workers[0].onerror;f.pool.take();f.pool.warm();oldError();assert.equal(f.workers[1].terminated,0);});
