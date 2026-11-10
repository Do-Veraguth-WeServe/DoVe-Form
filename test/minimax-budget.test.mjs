import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
const {runRound}=await import(pathToFileURL((process.env.FORM_TEST_ROOT||process.cwd())+'/provider.mjs'));

test('MiniMax Flash default preserves output budget without disabling required thinking',async()=>{
 const requests=[];
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const request=JSON.parse(body);requests.push(request);
  const low=request.reasoning_effort==='low';
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.end('data: '+JSON.stringify({choices:[{delta:low?{content:'Complete answer'}:{reasoning_content:'r'.repeat(67000)},finish_reason:low?'stop':'length'}]})+String.fromCharCode(10,10));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {
  const config={baseUrl:'http://127.0.0.1:'+server.address().port,model:'minimax-m3.1-flash',apiKey:'fixture'};
  for(const model of ['minimax-m3.1-flash','MiniMax-M3.1-Flash']){
   let prose='';const result=await runRound({...config,model},[],{textOnly:true,maxTokens:2600},t=>prose+=t);
   assert.equal(result.truncated,false,'omitted effort must not exhaust budget in hidden reasoning');
   assert.equal(prose,'Complete answer');assert.equal(result.reasoningChars,0);
  }
  await runRound(config,[],{textOnly:true,reasoningEffort:'high'},()=>{});
  for(const model of ['MiniMax-M3','unrelated','not-minimax-m3.1-flash'])await runRound({...config,model},[],{textOnly:true},()=>{});
  assert.deepEqual(requests.map(r=>r.reasoning_effort),['low','low','high',undefined,undefined,undefined]);
  assert.deepEqual(requests.map(r=>r.max_tokens),[2600,2600,16384,16384,16384,16384]);
  assert.ok(requests.every(r=>r.thinking===undefined));
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
