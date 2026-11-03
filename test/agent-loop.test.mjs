import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {runToolLoop} from '../agent-loop.mjs';
async function fixture(fn,run){const s=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const d=fn(JSON.parse(body));res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[d]})+String.fromCharCode(10,10)+'data: [DONE]'+String.fromCharCode(10,10));});await new Promise(r=>s.listen(0,'127.0.0.1',r));try{await run({baseUrl:'http://127.0.0.1:'+s.address().port,model:'fixture',apiKey:'fixture'})}finally{s.closeAllConnections();await new Promise(r=>s.close(r))}}
const catalog=[{name:'read_items',description:'Read items',parameters:{type:'object'}}];
test('standalone loop supplies tools, executes once and returns tool result to model',async()=>{
 let rounds=0,calls=0;
 await fixture(body=>{rounds++;assert.equal(body.tools[0].function.name,'read_items');if(rounds===1)return {delta:{tool_calls:[{index:0,id:'call-1',function:{name:'read_items',arguments:'{}'}}]},finish_reason:'tool_calls'};assert.equal(body.messages.at(-1).role,'tool');assert.equal(body.messages.at(-1).content,'{"count":3}');return {delta:{content:'Three items.'},finish_reason:'stop'}},async model=>{
 const texts=[];const out=await runToolLoop(model,[{role:'user',content:'List items'}],{catalog,execute:async()=>{calls++;return {count:3}},deadlineMs:Date.now()+5000},e=>texts.push(e));assert.equal(out.calls,1);assert.equal(calls,1);assert.equal(rounds,2);assert.ok(texts.some(e=>e.text==='Three items.'));
 });
});
test('unknown tool is rejected without executing',async()=>{
 await fixture(()=>({delta:{tool_calls:[{index:0,id:'x',function:{name:'evil',arguments:'{}'}}]},finish_reason:'tool_calls'}),async model=>{await assert.rejects(runToolLoop(model,[],{catalog,execute:()=>{throw Error('SHOULD NOT RUN')},deadlineMs:Date.now()+5000}),/Ungültiger Tool-Aufruf/)});
});
test('ambiguous external failure is not retried',async()=>{
 let calls=0;
 await fixture(()=>({delta:{tool_calls:[{index:0,id:'x',function:{name:'read_items',arguments:'{}'}}]},finish_reason:'tool_calls'}),async model=>{await assert.rejects(runToolLoop(model,[],{catalog,execute:()=>{calls++;throw Error('unknown outcome')},deadlineMs:Date.now()+5000}),/unknown outcome/);assert.equal(calls,1)});
});
