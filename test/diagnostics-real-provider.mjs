// Opt-in synthetic acceptance; no production conversations or artifacts are loaded.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {pathToFileURL} from 'node:url';
if(!process.env.FORM_DIAGNOSTIC_MODEL)throw Error('Explicit FORM_DIAGNOSTIC_MODEL required (two real provider calls).');
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const model=JSON.parse(fs.readFileSync(process.env.FORM_DIAGNOSTIC_MODELS||'/opt/form/form.models.json','utf8')).models.find(m=>m.id===process.env.FORM_DIAGNOSTIC_MODEL);
assert.ok(model,'Explicit configured model must exist');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-real-diagnostics-'));const port=process.env.FORM_DIAGNOSTIC_PORT||'4786',base='http://127.0.0.1:'+port;
let app,store;const results=[];
try{
 store=new Store(dir);const password=crypto.randomBytes(24).toString('hex'),user=store.createUser('diagnostic',password),other=store.createUser('foreign',password);
 const foreign=store.createConversation(other.id);store.appendMessage(foreign.id,'assistant',{render:{version:1,name:'foreign-private-sentinel',html:'<p>foreign-private-sentinel</p>',css:'',js:'',state:{}}});
 const fixtures=[0,3].map(count=>{const c=store.createConversation(user.id);const render={version:1,name:'Synthetic flame',html:'<span class="flame"></span>',css:'.flame::before{content:"🔥";position:absolute;background:linear-gradient(red,orange)}',js:'',state:{count}};const id=store.appendMessage(c.id,'assistant',{render});return {count,c,id,render};});
 const models=path.join(dir,'models.json');fs.writeFileSync(models,JSON.stringify({models:[{...model,ownerId:user.id,shared:false}]}),{mode:0o600});
 app=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:port,FORM3_DATA:dir,FORM3_MODELS:models,FORM3_CONFIG:path.join(dir,'config.json'),FORM3_ORIGIN:base,FORM3_PROXY_HOST:'',FORM3_PROXY_PORT:''},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Fixture startup timeout')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});app.once('exit',c=>{clearTimeout(t);reject(Error('Fixture early exit '+c));});});
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username:'diagnostic',password})});assert.equal(login.status,200);const auth=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
 for(const f of fixtures){
  const started=Date.now(),response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie,'X-Form-CSRF':auth.csrf},body:JSON.stringify({version:1,sessionId:f.c.id,requestId:crypto.randomUUID(),mode:'chat',model:model.id,text:'Warum fehlt die Flamme? Bitte nur untersuchen, nichts planen oder bauen. Was ist belegt, was ist noch ungeprüft?'}),signal:AbortSignal.timeout(80000)});assert.equal(response.status,200);
  const stream=await response.text(),events={};for(const m of stream.matchAll(/^event: (.+)$/gm))events[m[1]]=(events[m[1]]||0)+1;
  const job=store.db.prepare('SELECT state,request,message_id FROM jobs WHERE conversation_id=?').get(f.c.id);assert.equal(job.state,'ready');
  const row=store.db.prepare('SELECT prose,forms FROM messages WHERE id=?').get(job.message_id),request=JSON.parse(job.request),meta=JSON.parse(row.forms).replyEvidence;
  const raw=request.messages.find(m=>m.content.startsWith('[element-evidence] ')).content;const evidence=JSON.parse(raw.slice('[element-evidence] '.length,-' [/element-evidence]'.length));
  assert.equal(evidence.elements.length,1);assert.equal(evidence.elements[0].state.count,f.count);assert.equal(evidence.elements[0].diagnostics.assessment,'inspected-removals');assert.ok(!JSON.stringify(request).includes('foreign-private-sentinel'));assert.ok(!row.prose.includes('foreign-private-sentinel'));
  assert.deepEqual(store.getRender(f.id),f.render);assert.equal(store.latestBlueprint(f.c.id),null);assert.equal(store.db.prepare("SELECT count(*) n FROM jobs WHERE kind!='chat'").get().n,0);
  assert.equal(meta.visualVerified,false);assert.equal(meta.runtimeObserved,false);assert.equal(meta.repairVerified,false);assert.equal(meta.elements[0].codeRevision,evidence.elements[0].diagnostics.codeRevision);
  assert.equal(events.error||0,0);assert.equal(events.render||0,0);assert.equal(events.done,1);
  // Lexical checks are only triage; retained synthetic answers require human review.
  const checks={mentionsContent:/content/i.test(row.prose),mentionsRemoval:/entfern|gestrich|blockier|filter|verworfen|nicht erlaubt/i.test(row.prose),disclosesLimits:/ungeprüft|nicht geprüft|nicht verifiziert|keine.*(Browser|visuell)|nicht.*(gesehen|getestet|beobacht)|nur.*statisch|statisch/i.test(row.prose)};
  results.push({count:f.count,elapsedMs:Date.now()-started,events,checks,answer:row.prose,codeRevision:meta.elements[0].codeRevision,visualVerified:false,artifactUnchanged:true,noBuild:true});
 }
 const report={testOnly:true,model:model.model,scope:'authenticated synthetic chat, static CSS causal evidence; NOT browser/layout/repair certification',results};
 if(process.env.FORM_DIAGNOSTIC_RESULT)fs.writeFileSync(process.env.FORM_DIAGNOSTIC_RESULT,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));assert.ok(results.every(r=>Object.values(r.checks).every(Boolean)),'Causal-answer lexical triage failed; review retained synthetic response');
}finally{if(app&&app.exitCode===null){app.kill();await new Promise(r=>app.once('exit',r));}store?.close();fs.rmSync(dir,{recursive:true,force:true});}
