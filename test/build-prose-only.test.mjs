// Regression: Ein Bau-Turn mit NUR Prosa (kein Artefakt) darf nie still als
// "ready" ohne Element enden — die Korrekturrunde muss das Artefakt erzwingen
// oder der Job ehrlich fehlschlagen. (User-"test"-Vorfall 2026-11-10 23:20.)
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import crypto from 'node:crypto';
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-proseonly-')),BASE='http://127.0.0.1:4766';
let buildCalls=0,planCalls=0;
const artifact={version:1,name:'Wochenplan',html:'<p id="out">ok</p>',css:'',js:'',state:{}};
const mock=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;
 const planning=raw.includes('fast conversational planner');
 res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();
 const put=t=>res.write('data: '+JSON.stringify({choices:[{delta:{content:t},finish_reason:'stop'}]})+'\n\n');
 if(planning){planCalls++;put('<reply>Plan.</reply><title>Wochenplan</title><summary>Ein Plan.</summary><ready>true</ready>');}
 else{
   buildCalls++;
   if(buildCalls===1)put('Version 1 ist als Zielbild erfasst — ich erkläre den Aufbau gern.'); // Prosa ohne Artefakt
   else put('Kurz und guetig. ```json\n'+JSON.stringify(artifact)+'\n```');
 }
 res.end('data: [DONE]\n\n');});
await new Promise(r=>mock.listen(4767,'127.0.0.1',r));
let app;
const j=async (r,route,opt={})=>{const t=await r.json().catch(()=>({}));if(!r.ok)throw Error(route+': '+(t.error||r.status));return t;};
try{
 app=spawn('node',['server.mjs'],{cwd:process.env.FORM_TEST_ROOT||process.cwd(),env:{...process.env,PORT:'4766',FORM3_DATA:dir,FORM3_CONFIG:path.join(dir,'config.json'),FORM3_REGISTRATION:'1',FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});});
 const reg=await fetch(BASE+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:BASE},body:JSON.stringify({username:'prose',password:'password123'})});
 const {csrf,user}=await j(reg,'register');const cookie=reg.headers.get('set-cookie').split(';')[0];
 const H={'Content-Type':'application/json',Cookie:cookie,'X-Form-CSRF':csrf,Origin:BASE};
 const add=await fetch(BASE+'/api/models',{method:'POST',headers:H,body:JSON.stringify({label:'F',baseUrl:'http://127.0.0.1:4767/v1',model:'mock',apiKey:'fixture'})});
 await j(add,'models');
 // Plan über den echten Chat-Endpoint anstossen (mock liefert gueltigen Blueprint)
 const created=await j(await fetch(BASE+'/api/conversations',{method:'POST',headers:H,body:JSON.stringify({title:'Test'})}),'create conv');
 const sessionId=created.conversation.id;
 const chat=await fetch(BASE+'/api/chat',{method:'POST',headers:H,body:JSON.stringify({version:1,sessionId,requestId:crypto.randomUUID(),text:'Plane einen Wochenplan',mode:'plan'})});
 const chatBody=await chat.text();
 console.log('chat:',chat.status,[...chatBody.matchAll(/event: (\w+)/g)].map(m=>m[1]).join(','));
 await new Promise(r=>setTimeout(r,1500));
 const jobsProbe=await j(await fetch(BASE+'/api/jobs',{headers:H}),'jobs');
 console.log('jobs:',JSON.stringify(jobsProbe.jobs.map(x=>[x.kind,x.state,String(x.error||'').slice(0,60)])));
 const convs=await j(await fetch(BASE+'/api/conversations',{headers:H}),'convs');
 const conv=convs.conversations.find(c=>c.blueprint);
 assert.ok(conv,'Blueprint vorhanden');
 // Plan starten: erster Bau-Antworten nur Prose → Korrektur muss Artefakt liefern
 const start=await fetch(BASE+'/api/blueprints/execute',{method:'POST',headers:H,body:JSON.stringify({sessionId:conv.id,blueprintId:conv.blueprint.id,revision:conv.blueprint.revision})});
 const started=await j(start,'execute');assert.ok(started.job,'Job gestartet');
 const deadline=Date.now()+60000;
 let jobs;
 do{
   await new Promise(r=>setTimeout(r,400));
   jobs=await j(await fetch(BASE+'/api/jobs',{headers:H}),'jobs');
   const active=jobs.jobs.find(x=>x.id===started.job.id);
   if(!active||['ready','failed'].includes(active.state)){if(active?.state==='failed')throw Error('Job fehlschlagen: '+active.error);break;}
 }while(Date.now()<deadline);
 const after=await j(await fetch(BASE+'/api/conversations',{headers:H}),'after');
 const c=after.conversations.find(x=>x.id===conv.id);
 assert.equal(buildCalls,2,'erster Bau prosa-only, Korrekturrunde mit Artefakt ('+buildCalls+' Aufrufe)');
 assert.ok(c.messages.some(m=>m.render),'Element wurde nach der Korrekturrunde angehaengt');
 console.log('PASS build: prose-only answer triggers correction and still publishes the element');
}finally{
 if(app){app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r));}
 mock.closeAllConnections();await new Promise(r=>mock.close(r));fs.rmSync(dir,{recursive:true,force:true});
}
