import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MCPConnections,validateEndpoint} from '../mcp.mjs';
test('MCP endpoint rejects insecure remote URLs and embedded credentials',()=>{
 for(const u of ['http://remote.example/mcp','https://user:password@example.com/mcp','file:///tmp/test','https://example.com/mcp?token=secret'])assert.throws(()=>validateEndpoint(u));
 assert.equal(validateEndpoint('http://127.0.0.1:9999/mcp'),'http://127.0.0.1:9999/mcp');
});
test('connections are disabled by default, tokens stay private, permissions persist',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-mcp-test-'));
 try{
 const file=path.join(dir,'mcp.json'),m=new MCPConnections(file);
 const id=m.add({name:'Fixture',url:'https://example.com/mcp',token:'private-token'});
 assert.equal(m.publicList()[0].hasToken,true);assert.equal(JSON.stringify(m.publicList()).includes('private-token'),false);
 assert.equal(fs.statSync(file).mode&0o777,0o600);assert.deepEqual(m.catalog(),[]);
 m.get(id).tools=[{name:'read',description:'Read',inputSchema:{type:'object',properties:{id:{type:'number'}},required:['id'],additionalProperties:false},allowed:false}];
 m.configure(id,{enabled:true,allowedTools:['read']});assert.equal(m.catalog().length,1);
 assert.equal(new MCPConnections(file).catalog().length,1);
 await assert.rejects(m.call(m.catalog()[0].name,{id:'bad'}),/Schema/);
 await assert.rejects(m.call('unknown',{}),/freigegeben/);
 m.configure(id,{enabled:false,allowedTools:[]});assert.deepEqual(m.catalog(),[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('HTTP MCP initialize, discover and call use official client',async()=>{
 const http=await import('node:http');let executed=0;
 const server=http.createServer(async(req,res)=>{
 if(req.method==='GET'){res.writeHead(405);return res.end()}
 let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);
 if(body.id===undefined){res.writeHead(202);return res.end()}
 let result;
 if(body.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
 else if(body.method==='tools/list')result={tools:[{name:'count',description:'Count',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
 else if(body.method==='tools/call'){executed++;result={content:[{type:'text',text:'3'}]};}
 else result={};
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-mcp-http-'));
 try{const m=new MCPConnections(path.join(dir,'mcp.json'));const id=m.add({name:'Fixture',url:'http://127.0.0.1:'+server.address().port+'/mcp'});await m.discover(id);assert.equal(executed,0);assert.equal(m.catalog().length,0);m.configure(id,{enabled:true,allowedTools:['count']});const r=await m.call(m.catalog()[0].name,{});assert.equal(r.content[0].text,'3');assert.equal(executed,1);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
