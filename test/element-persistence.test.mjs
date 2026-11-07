import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {elementPersistence} from '../src/element-persistence.js';
const hash=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
const ok=state=>({ok:true,json:async()=>({ok:true,state})});
test('serializes writes using acknowledged state, snapshots queued input',async()=>{
 let release,entered;const start=new Promise(r=>entered=r),hold=new Promise(r=>release=r),calls=[];
 const w=elementPersistence({messageId:'m',state:{n:0},onFailure:e=>{throw e},request:async p=>{calls.push(p);if(calls.length===1){entered();await hold;}return ok(p.state||p.render.state);}});
 const first=w.save({state:{n:1}}),state={n:2},second=w.save({state});state.n=99;await start;assert.equal(calls.length,1);release();assert.equal(await first,true);assert.equal(await second,true);assert.equal(calls[0].expectedRevision,hash({n:0}));assert.equal(calls[1].expectedRevision,hash({n:1}));assert.deepEqual(calls[1].state,{n:2});
 assert.equal(await w.save({render:{state:{n:3}}}),true);assert.equal(calls[2].expectedRevision,hash({n:2}));
});
for(const status of [409,401,403,503,'network','malformed'])test('blocks queued writes without replay after '+status,async()=>{
 let calls=0,failures=0;const w=elementPersistence({messageId:'m',state:{n:0},onFailure:()=>{failures++},request:async()=>{calls++;if(status==='network')throw Error('offline');if(status==='malformed')return {ok:true,json:async()=>({})};return {ok:false,status};}});
 assert.deepEqual(await Promise.all([w.save({state:{n:1}}),w.save({state:{n:2}})]),[false,false]);assert.equal(await w.save({state:{n:3}}),false);assert.equal(calls,1);assert.equal(failures,1);
});
test('bounded queue fails closed without a request flood',async()=>{let calls=0,failures=0;const w=elementPersistence({messageId:'m',state:{},request:async()=>{calls++;return ok({})},onFailure:()=>{failures++;}});const results=await Promise.all(Array.from({length:100},()=>w.save({state:{}})));assert.ok(results.every(x=>x===false));assert.equal(calls,0);assert.equal(failures,1);});
test('stopped snapshot cannot dispatch queued work',async()=>{let calls=0;const w=elementPersistence({messageId:'m',state:{},request:async()=>{calls++;return ok({})},onFailure:()=>{}});const result=w.save({state:{}});w.stop();assert.equal(await result,false);assert.equal(calls,0);});
