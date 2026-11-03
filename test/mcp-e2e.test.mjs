import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {chromium} from 'playwright-core';
test('Form UI configures MCP, approves tool, receives final answer',{timeout:60000},async()=>{
 let executions=0,modelRounds=0;
 const fixture=http.createServer(async(req,res)=>{
 if(req.method==='GET'){res.writeHead(405);return res.end()}
 let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);
 if(req.url==='/chat/completions'){
 modelRounds++;let choice;
 if(b.messages.at(-1).role==='tool'){assert.equal(executions,1);choice={delta:{content:'Es gibt genau drei Tickets.'},finish_reason:'stop'}}
 else choice={delta:{tool_calls:[{index:0,id:'call-fixture',function:{name:b.tools[0].function.name,arguments:'{}'}}]},finish_reason:'tool_calls'};
 res.writeHead(200,{'Content-Type':'text/event-stream'});return res.end('data: '+JSON.stringify({choices:[choice]})+String.fromCharCode(10,10));
 }
 if(b.id===undefined){res.writeHead(202);return res.end()}
 let result={};if(b.method==='initialize')result={protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
 if(b.method==='tools/list')result={tools:[{name:'tickets',description:'Count tickets',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
 if(b.method==='tools/call'){executions++;result={content:[{type:'text',text:'3'}]}}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:b.id,result}));
 });await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+fixture.address().port,dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-mcp-e2e-'));let app,browser;
 try{
 app=spawn('node',['server.mjs'],{env:{...process.env,PORT:'4604',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_REGISTRATION:'1'},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),10000);app.stdout.on('data',d=>{if(d.toString().includes('ready')){clearTimeout(timer);resolve()}});app.on('exit',()=>reject(Error('server exited')))});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const p=await browser.newPage();await p.goto('http://127.0.0.1:4604');
 await p.locator('#switchreg').click();await p.locator('#regform [name=username]').fill('mcpowner');await p.locator('#regform [name=password]').fill('password123');await p.locator('#regform [name=password2]').fill('password123');await p.locator('#regform button').click();await p.locator('#sessions button').first().waitFor();
 await p.evaluate(async url=>{const b=await(await fetch('/api/bootstrap')).json();const r=await fetch('/api/models',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':b.csrf},body:JSON.stringify({label:'Fixture',baseUrl:url,model:'fixture',apiKey:'test-fixture-key'})});if(!r.ok)throw Error(await r.text())},url);await p.reload();
 await p.locator('#mcpbtn').click();await p.locator('#mcpadd [name=name]').fill('Tickets');await p.locator('#mcpadd [name=url]').fill(url+'/mcp');await p.locator('#mcpadd button').click();await p.locator('#mcplist button').filter({hasText:'Tools laden'}).click();await p.locator('#mcplist input[type=checkbox]').check();await p.locator('#mcplist button').filter({hasText:'Auswahl aktivieren'}).click();await p.locator('#mcpclose').click();
 await p.locator('#prompt').fill('Wie viele Tickets?');await p.locator('#prompt').press('Enter');await p.locator('#toolapprovals button').filter({hasText:'Bestätigen'}).waitFor();assert.equal(executions,0);await p.locator('#toolapprovals button').filter({hasText:'Bestätigen'}).click();await p.locator('.prose').filter({hasText:'genau drei Tickets'}).waitFor({timeout:15000});assert.equal(executions,1);assert.equal(modelRounds,2);
 await p.reload();await p.locator('.prose').filter({hasText:'genau drei Tickets'}).waitFor();assert.equal(executions,1);
 await p.locator('#memorybtn').click();assert.equal(await p.locator('#memoryenabled').isChecked(),false);
 await p.locator('#memoryadd [name=content]').fill('Projektfarbe Blau');await p.locator('#memoryadd [name=project]').fill('Test');await p.locator('#memoryadd button').click();await p.locator('#memorylist textarea').waitFor();assert.equal(await p.locator('#memorylist textarea').inputValue(),'Projektfarbe Blau');
 await p.locator('#memoryenabled').check();await p.locator('#memoryclose').click();await p.reload();await p.locator('#memorybtn').click();assert.equal(await p.locator('#memoryenabled').isChecked(),true);assert.equal(await p.locator('#memorylist textarea').inputValue(),'Projektfarbe Blau');
 await p.locator('#memorylist textarea').fill('Projektfarbe Grün');await p.locator('#memorylist button').filter({hasText:'Speichern'}).click();await p.locator('#memoryclose').click();await p.reload();await p.locator('#memorybtn').click();assert.equal(await p.locator('#memorylist textarea').inputValue(),'Projektfarbe Grün');
 p.once('dialog',d=>d.accept());await p.locator('#memorylist button').filter({hasText:'Löschen'}).click();await p.waitForFunction(()=>!document.querySelector('#memorylist textarea'));

 }finally{await browser?.close();if(app){app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r))}fixture.closeAllConnections();await new Promise(r=>fixture.close(r));fs.rmSync(dir,{recursive:true,force:true})}
});
