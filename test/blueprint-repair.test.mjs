import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-plan-repair-')),BASE='http://127.0.0.1:4871',PASS='password123';
const validPlan='<reply>Deine Anmeldung ist geklärt.</reply><title>Zähler</title><summary>Alles geklärt.</summary><questions></questions><ready>true</ready>';
let plans=0,repairPromptChecked=false;
const mock=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const d=JSON.parse(raw),sys=d.messages[0].content;
 if(!sys.includes('fast conversational planner')){res.writeHead(500);res.end('unexpected caller');return;}
 plans++;res.writeHead(200,{'Content-Type':'text/event-stream'});const put=t=>res.write('data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n');
 if(plans===1){put('Hier ist meine Planidee, aber ohne die geforderten Abschnitte.');res.end('data: [DONE]\n\n');return;}
 const last=String(d.messages.at(-1).content);
 assert.match(last,/failed validation: .*Format ungültig/,'repair prompt must carry the specific validation reason');
 assert.ok(last.includes('Follow this contract'),'repair prompt must restate the planning contract');
 repairPromptChecked=true;
 put(validPlan);res.end('data: [DONE]\n\n');});
await new Promise(r=>mock.listen(4872,'127.0.0.1',r));
fs.writeFileSync(path.join(dir,'models.json'),JSON.stringify({models:[{id:'mock-plan',label:'Testmodell',model:'mock',baseUrl:'http://127.0.0.1:4872/v1',apiKey:'test-key-0000'}]}),{mode:0o600});
const api=async(a,p,b)=>fetch(BASE+p,{method:b===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:BASE,Cookie:a?.cookie||'','X-Form-CSRF':a?.csrf||''},body:b===undefined?undefined:JSON.stringify(b)});
let server;try{
 server=spawn('node',['server.mjs'],{cwd:process.env.FORM_TEST_ROOT||process.cwd(),env:{...process.env,PORT:'4871',FORM3_ORIGIN:BASE,FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),15000);server.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});server.on('exit',reject)});
 const reg=await api(null,'/api/auth/register',{username:'repair',password:PASS});assert.equal(reg.status,200);
 const login=await api(null,'/api/auth/login',{username:'repair',password:PASS});assert.equal(login.status,200);
 const a={cookie:login.headers.get('set-cookie').split(';')[0],csrf:(await login.json()).csrf};
 const conv=await(await api(a,'/api/conversations',{})).json();assert.ok(conv.conversation.id);
 const sid=conv.conversation.id;
 const sse=await(await api(a,'/api/chat',{version:1,sessionId:sid,requestId:crypto.randomUUID(),text:'Plane einen kleinen Zähler',mode:'plan'})).text();
 assert.equal(plans,2,'exactly one validation repair round');
 assert.ok(repairPromptChecked,'repair prompt contract was verified');
 assert.equal((sse.match(/event: retry/g)||[]).length,1);
 assert.match(sse,/"code":"invalid-blueprint"/);
 assert.match(sse,/Blueprint wird geprüft und einmal korrigiert/);
 assert.match(sse,/event: done/);
 assert.ok(!sse.includes('event: error'),'plan must succeed after informed repair: '+sse.slice(-400));
 const list=await(await api(a,'/api/conversations')).json();
 const saved=list.conversations.find(c=>c.id===sid);
 assert.equal(saved.blueprint.revision,1);
 assert.equal(saved.blueprint.ready,true);
 assert.equal(saved.blueprint.summary,'Alles geklärt.');
 console.log('PASS plan repair carries the specific validation reason into the corrective call and completes');
}finally{mock.closeAllConnections();await new Promise(r=>mock.close(r));server?.kill();if(server)await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
