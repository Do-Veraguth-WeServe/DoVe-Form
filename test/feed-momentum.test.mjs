import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(process.env.MOMENTUM_SOURCE||new URL('../src/feed-momentum.js',import.meta.url),'utf8').replaceAll('export function','function');
function fixture(){
 let now=0,next=0;const queue=new Map(),events={},feed={scrollTop:1000},owner={isConnected:true,closest:()=>feed};
 const context=vm.createContext({Math,Number,performance:{now:()=>now},document:{hidden:false},requestAnimationFrame:f=>{queue.set(++next,f);return next},cancelAnimationFrame:id=>queue.delete(id),addEventListener:(type,fn)=>events[type]=fn});vm.runInContext(source,context);
 return {context,events,feed,owner,queue,start:v=>context.startFeedMomentum(owner,v),step:ms=>{now+=ms;const callbacks=[...queue.values()];queue.clear();callbacks.forEach(f=>f(now));}};
}
test('velocity is bounded, decays, and expires within 1200ms',()=>{const f=fixture();f.start(1000);f.step(16);assert.equal(f.feed.scrollTop,1040);for(let i=0;i<100;i++)f.step(16);assert.equal(f.queue.size,0);assert.ok(f.feed.scrollTop<1700);});
test('negative direction, boundary and invalid velocity',()=>{const f=fixture();f.start(NaN);assert.equal(f.queue.size,0);f.start(-1);f.step(16);assert.equal(f.feed.scrollTop,984);Object.defineProperty(f.feed,'scrollTop',{get:()=>0,set:()=>{}});f.step(16);assert.equal(f.queue.size,0);});
test('new trusted input, hidden document and detached owner stop continuation',()=>{for(const type of ['pointerdown','touchstart','wheel','keydown']){const f=fixture();f.start(1);f.events[type]({isTrusted:false});assert.equal(f.queue.size,1);f.events[type]({isTrusted:true});assert.equal(f.queue.size,0);}const f=fixture();f.start(1);f.owner.isConnected=false;f.step(16);assert.equal(f.queue.size,0);f.owner.isConnected=true;f.start(1);f.context.document.hidden=true;f.events.visibilitychange();assert.equal(f.queue.size,0);});
test('one owner at a time, teardown cannot stop another owner',()=>{const f=fixture();f.start(1);f.context.cancelFeedMomentum({});assert.equal(f.queue.size,1);f.context.cancelFeedMomentum(f.owner);assert.equal(f.queue.size,0);});

test('current-frame callbacks must never reverse or cancel a new fling',()=>{for(const first of [0,-4]){const f=fixture();f.start(1);f.step(first);assert.equal(f.feed.scrollTop,1000);assert.equal(f.queue.size,1);f.step(20);assert.ok(f.feed.scrollTop>1000);assert.equal(f.queue.size,1);}});
test('a rounded subpixel first tick retains momentum and fractional displacement',()=>{const f=fixture();let value=1000;Object.defineProperty(f.feed,'scrollTop',{get:()=>value,set:n=>value=Math.round(n)});f.start(0.1);f.step(1);assert.equal(value,1000);assert.equal(f.queue.size,1);f.step(16);assert.ok(value>1000);assert.equal(f.queue.size,1);});
