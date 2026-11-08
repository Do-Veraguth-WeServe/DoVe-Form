import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {requestAnimationVerification as verify} from '../animation-verifier-client.mjs';
async function fixture(reply,fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'form-verifier-test-'));const socketPath=path.join(dir,'s');const sockets=new Set();const server=net.createServer(s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});s.once('data',()=>reply(s));});await new Promise(r=>server.listen(socketPath,r));try{await fn(socketPath);}finally{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}}
test('bounded private verifier protocol',async()=>{
 await fixture(s=>s.end(JSON.stringify({ok:true,evidence:{status:'passed'}})+'\n'),async socketPath=>assert.equal((await verify({}, {socketPath})).status,'passed'));
 for(const reply of ['bad\n','{}\n',JSON.stringify({ok:false})+'\n','x'.repeat(64001)])await fixture(s=>s.end(reply),async socketPath=>assert.rejects(verify({},{socketPath}),/rejected|large/));
 await fixture(s=>s.end(),async socketPath=>assert.rejects(verify({},{socketPath}),/incomplete/));
 await fixture(()=>{},async socketPath=>assert.rejects(verify({},{socketPath,timeoutMs:20}),/deadline/));
 await fixture(()=>{},async socketPath=>{const c=new AbortController();const p=verify({},{socketPath,signal:c.signal});c.abort();await assert.rejects(p,/cancelled/);});
 await assert.rejects(verify({},{socketPath:'/nonexistent/form-verifier.sock'}),/unavailable/);
 await assert.rejects(verify({html:'x'.repeat(220001)}),/too large/);
});

test('only trusted correction hints cross the verifier boundary',async()=>{
 for(const [code,expected] of [['HTML',/supported HTML/],['TARGET',/exists exactly once/],['STARTUP',/supported ui APIs/],['BUDGET',/16-second/],['EXECUTION',/clip execution/],['DEADLINE',/deadline/],['CANCELLED',/cancelled/],['INTERNAL',/unavailable/],['__proto__',/INTERNAL/],['guest-secret',/INTERNAL/]]) {
  await fixture(s=>s.end(JSON.stringify({ok:false,code,error:'private guest exception',stage:'private html'})+'\n'),async socketPath=>{
   await assert.rejects(verify({},{socketPath}),error=>{assert.match(error.message,expected);assert.doesNotMatch(error.message,/private|guest-secret|__proto__/);return true;});
  });
 }
});

test('admission retries bounded; target rejection never retried',async()=>{let count=0;await fixture(s=>{count++;if(count===1)s.end();else s.end(JSON.stringify({ok:true,evidence:{status:'passed'}})+String.fromCharCode(10));},async socketPath=>assert.equal((await verify({},{socketPath})).status,'passed'));assert.equal(count,2);count=0;await fixture(s=>{count++;s.end(JSON.stringify({ok:false,code:'TARGET'})+String.fromCharCode(10));},async socketPath=>assert.rejects(verify({},{socketPath}),/TARGET/));assert.equal(count,1);});
