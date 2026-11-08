// Installed private service only; synthetic artifacts, no production user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {requestAnimationVerification as verify} from '../animation-verifier-client.mjs';
const fixture={version:1,html:'<div id="a">Synthetic</div>',css:'',js:'',state:{},animations:{version:1,clips:{fade:{type:'tween',target:'a',duration:200,easing:'linear',frames:[{opacity:1},{opacity:0}]}}}};
test('sandboxed service returns safe specific rejection categories',async()=>{
 for(const [artifact,code] of [
  [{...fixture,html:fixture.html+'<div id="title">PRIVATE_SENTINEL</div>'},'HTML'],
  [{...fixture,html:'<div>absent</div>'},'TARGET'],
  [{...fixture,html:fixture.html+fixture.html},'TARGET'],
  [{...fixture,js:'throw Error("PRIVATE_SENTINEL");'},'STARTUP'],
  [{...fixture,animations:{version:1,clips:Object.fromEntries(Array.from({length:9},(_,i)=>['clip'+i,{...fixture.animations.clips.fade,duration:2000}]))}},'BUDGET']
 ]) await assert.rejects(verify(artifact),error=>{assert.ok(error.message.includes('['+code+']'),error.message);assert.ok(!error.message.includes('PRIVATE_SENTINEL'));return true;});
 assert.equal((await verify(fixture)).status,'passed');
});
