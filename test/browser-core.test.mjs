// Current-contract migration of legacy browser acceptance sections 0–4.
// Independent fixture; never accesses production accounts, models or data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-browser-core-'));
const base='http://127.0.0.1:4826',key='fixture-only-key-1234567890';
let app,browser,builds=0,plans=0,chats=0,releaseFirst,releaseArtifact,releaseBuild;
let correctionMode=null,correctionAttempts=0,releaseCorrection,proseOnly=false,releaseProse;
let signalBuild;const buildStarted=new Promise(resolve=>{signalBuild=resolve});
const artifact={version:1,name:'Core-Regler',html:'<label for="amt">Wert</label><input id="amt" type="number"><p id="out"></p>',css:'p{color:#d4ef8b}',js:'ui.value("amt",String(state.value));function draw(){ui.text("out","Wert: "+state.value)}ui.on("amt","input",e=>{state.value=Number(e.value);draw();ui.persist()});draw();',state:{value:3}};
const mock=http.createServer(async(req,res)=>{
 try{let raw='';for await(const c of req)raw+=c;const d=JSON.parse(raw);assert.equal(req.headers.authorization,'Bearer '+key);
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const put=t=>res.write('data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n');
 const system=d.messages[0].content;
 if(system.includes('fast conversational planner')){plans++;put('<reply>Wir planen den Regler.</reply><title>Regler</title><summary>Ein Regler mit gespeichertem Zahlenwert.</summary><questions></questions><ready>true</ready>');}
 else if(system.includes('warm, concise conversational')&&proseOnly){chats++;put('Ein VPN ist ein Virtual Private Network. ');await new Promise(r=>{releaseProse=r;res.once('close',r)});if(res.destroyed)return;put('Es verschlüsselt die Verbindung zum VPN-Anbieter.');}
 else if(system.includes('warm, concise conversational')&&correctionMode){chats++;put('Wir besprechen den nächsten Regler. '+JSON.stringify({forms:[],planningOffer:{title:'Regler'}}));}
 else if(system.includes('warm, concise conversational')){chats++;put('Erster sichtbarer Abschnitt. ');await new Promise(r=>{releaseFirst=r;res.once('close',r)});if(res.destroyed)return;put('Zweiter sichtbarer Abschnitt. ');await new Promise(r=>{releaseArtifact=r;res.once('close',r)});if(res.destroyed)return;put(JSON.stringify({forms:[],planningOffer:{title:'Regler'}}));}
 else if(correctionMode){builds++;correctionAttempts++;assert.ok(correctionAttempts<=2,'no unbounded correction');if(correctionAttempts===2){assert.match(d.messages.at(-1).content,/CSS capability preflight/);await new Promise(r=>{releaseCorrection=r;res.once('close',r)});if(res.destroyed)return;}const value=correctionAttempts===1||correctionMode==='fail'?{...artifact,css:'p::before{content:"unsupported";position:absolute}'}:artifact;put('```json\n'+JSON.stringify(value)+'\n```');}
 else{builds++;signalBuild();await new Promise(r=>{releaseBuild=r;res.once('close',r)});if(res.destroyed)return;put('```json\n'+JSON.stringify(artifact)+'\n```');}
 res.end('data: [DONE]\n\n');
 }catch(e){res.destroy(e);}
});
const api=async p=>(await browser.contexts()[0].request.get(base+p)).json();
const check=(label)=>console.log('PASS '+label);
try{
 await new Promise((resolve,reject)=>{mock.once('error',reject);mock.listen(4827,'127.0.0.1',resolve)});
 app=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4826',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json'),FORM3_REGISTRATION:'1'},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('server startup timeout')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});app.once('exit',c=>{clearTimeout(t);reject(Error('early server exit '+c))})});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),p=await context.newPage(),errors=[];
 p.on('pageerror',e=>errors.push(e.message));await p.goto(base);
 await p.locator('#loginform [name=username]').fill('coreowner');await p.locator('#loginform [name=password]').fill('wrong-password');await p.locator('#loginform button').last().click();
 await p.locator('#loginerr').filter({hasText:'Ungültiger Benutzername oder Passwort'}).waitFor();check('wrong password rejected');
 await p.locator('#switchreg').click();await p.locator('#regform [name=username]').fill('coreowner');await p.locator('#regform [name=password]').fill('password123');await p.locator('#regform [name=password2]').fill('password123');await p.locator('#regform button').last().click();await p.locator('#login[open]').waitFor({state:'detached'});
 await p.locator('#emptystate').waitFor();assert.equal(await p.locator('#send').isDisabled(),true);check('registration and model-free composer gate');
 await p.locator('#preferencesbtn').click();await p.locator('#settingsbtn2').click();
 await p.locator('#addmodel [name=label]').fill('Core Mock');await p.locator('#addmodel [name=baseUrl]').fill('http://127.0.0.1:4827/v1');await p.locator('#addmodel [name=model]').fill('core-mock');await p.locator('#addmodel [name=apiKey]').fill(key);await p.locator('#addmodel button').last().click();
 await p.locator('#emptystate').waitFor({state:'detached'});assert.equal(await p.locator('#send').isDisabled(),false);
 const modelText=await p.locator('#modellist').innerText();assert.match(modelText,/…7890/);assert.ok(!modelText.includes(key));await p.keyboard.press('Escape');await p.locator('#preferences[open]').waitFor({state:'detached'});assert.equal(await p.locator('#settings').isVisible(),false);check('current settings navigation, model add, masked key and Escape');
 await p.locator('#prompt').fill('Baue sofort einen Regler');await p.locator('#prompt').press('Enter');await p.locator('.live .prose').filter({hasText:'Erster sichtbarer Abschnitt.'}).waitFor();assert.equal(await p.locator('.planning-offer-start').count(),0);releaseFirst();await p.locator('.live .prose').filter({hasText:'Zweiter sichtbarer Abschnitt.'}).waitFor();assert.equal(builds,0);releaseArtifact();check('two visible prose stages before structured chat offer');await p.locator('.planning-offer-start').waitFor();await p.waitForFunction(()=>!document.querySelector('.live'));
 assert.equal(chats,1);assert.equal(plans,0);assert.equal(builds,0);assert.equal(await p.locator('iframe.render').count(),0);check('ordinary imperative chat cannot build');
 await p.locator('.planning-offer-start').dblclick();await p.locator('.blueprint-execute:not([disabled])').waitFor({state:'attached'});assert.equal(plans,1);assert.equal(builds,0);
 if(await p.locator('.blueprint-toggle').getAttribute('aria-expanded')==='false')await p.locator('.blueprint-toggle').click();await p.locator('.blueprint-execute').click();
 await p.locator('.site[data-jobid]').waitFor();await p.waitForFunction(async()=>{const d=await(await fetch('/api/jobs')).json();return d.jobs.some(j=>j.state==='building')});await Promise.race([buildStarted,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('provider not reached')),10000);t.unref()})]);assert.equal(builds,1);assert.equal(await p.locator('iframe.render').count(),0);assert.equal((await api('/api/jobs')).jobs.filter(j=>j.state==='building').length,1);releaseBuild();await p.locator('iframe.render[data-ready=true]').waitFor();check('explicit approval and real held build before artifact');
 let f=p.frameLocator('iframe.render');await f.locator('#out').filter({hasText:'Wert: 3'}).waitFor();await f.locator('#amt').fill('7');await f.locator('#out').filter({hasText:'Wert: 7'}).waitFor();
 await p.waitForFunction(async()=>{const d=await(await fetch('/api/conversations')).json();return d.conversations.some(c=>c.messages.some(m=>m.render?.state?.value===7))});
 await p.reload();f=p.frameLocator('iframe.render');await f.locator('#out').filter({hasText:'Wert: 7'}).waitFor();assert.equal(await f.locator('#amt').inputValue(),'7');assert.equal(builds,1);assert.equal(await p.locator('iframe.render').count(),1);check('real server persistence and reload without duplicate build');
 await p.setViewportSize({width:390,height:844});await f.locator('#amt').fill('9');await f.locator('#out').filter({hasText:'Wert: 9'}).waitFor();
 await p.waitForFunction(async()=>{const d=await(await fetch('/api/conversations')).json();return d.conversations.some(c=>c.messages.some(m=>m.render?.state?.value===9))});await p.reload();await p.frameLocator('iframe.render').locator('#out').filter({hasText:'Wert: 9'}).waitFor();check('390px interaction and persisted reload');
 assert.equal(builds,1);assert.equal(plans,1);
 // Legacy section 6: prose-only follow-ups must not rebuild a live Element.
 proseOnly=true;
 for(const width of [1280,390]){
  await p.setViewportSize({width,height:900});
  const before=await api('/api/conversations');
  const owner=before.conversations.find(c=>c.messages.some(m=>m.render?.name==='Core-Regler'));
  const element=owner.messages.find(m=>m.render?.name==='Core-Regler');
  const frame=await p.locator('iframe.render').elementHandle();
  await frame.evaluate(el=>{el.dataset.acceptanceSentinel='same-frame'});
  const framesBefore=p.frames().length,chatBefore=chats;
  await p.locator('#prompt').fill('Erkläre mir kurz, was ein VPN macht — nur Text');await p.locator('#prompt').press('Enter');
  await p.locator('.live .prose').filter({hasText:'Virtual Private Network'}).waitFor();
  assert.equal(await frame.evaluate(el=>el.isConnected),true,'streaming retains original iframe');
  await p.frameLocator('iframe.render').locator('#out').filter({hasText:'Wert: 9'}).waitFor();
  assert.equal(builds,1);assert.equal(plans,1);releaseProse();
  await p.waitForFunction(()=>!document.querySelector('.live'));
  await p.locator('.message.assistant .prose').filter({hasText:'Es verschlüsselt die Verbindung'}).last().waitFor();
  assert.equal(chats,chatBefore+1);assert.equal(builds,1);assert.equal(plans,1);
  assert.equal(await frame.evaluate(el=>el.isConnected&&el.dataset.acceptanceSentinel==='same-frame'),true,'completed prose retains original iframe');
  assert.equal(p.frames().length,framesBefore);assert.equal(await p.locator('iframe.render').count(),1);
  const after=(await api('/api/conversations')).conversations.find(c=>c.id===owner.id);
  assert.deepEqual(after.messages.find(m=>m.id===element.id),element,'follow-up does not modify Element message/state');
  assert.equal(after.messages.length,owner.messages.length+2,'exactly one user/reply pair');
  assert.equal(after.messages.filter(m=>m.blueprint).length,owner.messages.filter(m=>m.blueprint).length);
  await p.reload();await p.frameLocator('iframe.render').locator('#out').filter({hasText:'Wert: 9'}).waitFor();
  await p.locator('.message.assistant .prose').filter({hasText:'Es verschlüsselt die Verbindung'}).last().waitFor();
  assert.equal(chats,chatBefore+1);assert.equal(builds,1);assert.equal(plans,1);
  check('prose-only '+width+': no build, no live iframe remount, unchanged persisted Element and reload');
 }
 proseOnly=false;
 // Migrated legacy section 5: correction belongs to an explicitly approved durable build,
 // never to ordinary chat. Hold round two so UI/reload assertions are deterministic.
 for(const outcome of ['correct','fail']){
  correctionMode=outcome;correctionAttempts=0;releaseCorrection=null;
  await p.setViewportSize({width:1280,height:900});await p.locator('#new').click();
  await p.locator('#prompt').fill('Besprechen wir einen weiteren Regler.');await p.locator('#prompt').press('Enter');
  await p.locator('.planning-offer-start').waitFor();await p.waitForFunction(()=>!document.querySelector('.live'));
  assert.equal(correctionAttempts,0);await p.locator('.planning-offer-start').click();
  await p.locator('.blueprint-execute:not([disabled])').waitFor({state:'attached'});
  if(await p.locator('.blueprint-toggle').getAttribute('aria-expanded')==='false')await p.locator('.blueprint-toggle').click();
  await p.locator('.blueprint-execute').click();await p.locator('.site').filter({hasText:'Automatische Korrektur · Versuch 2 von 2'}).waitFor();
  assert.equal(correctionAttempts,2);assert.equal(await p.locator('iframe.render').count(),0);
  const correcting=(await api('/api/jobs')).jobs.filter(j=>j.state==='building'&&j.phase==='correcting');assert.equal(correcting.length,1);const jobId=correcting[0].id;
  await p.setViewportSize({width:390,height:844});await p.reload();await p.locator('.site').filter({hasText:'Automatische Korrektur · Versuch 2 von 2'}).waitFor();assert.equal(correctionAttempts,2);
  await p.locator('.site').screenshot({path:'docs/screenshots/core-correction-'+outcome+'-390.png'});
  releaseCorrection();await p.waitForFunction(async({jobId,outcome})=>{const d=await(await fetch('/api/jobs')).json();return d.jobs.some(j=>j.id===jobId&&j.state===(outcome==='correct'?'ready':'failed'))},{jobId,outcome});
  assert.equal(correctionAttempts,2);
  if(outcome==='correct'){await p.frameLocator('iframe.render[data-ready=true]').locator('#out').filter({hasText:'Wert: 3'}).waitFor();assert.equal(await p.locator('iframe.render').count(),1);}
  else{await p.locator('.site').filter({hasText:'Bau fehlgeschlagen'}).waitFor();assert.equal(await p.locator('iframe.render').count(),0);await p.reload();await p.locator('.site').filter({hasText:'Bau fehlgeschlagen'}).waitFor();assert.equal(correctionAttempts,2);assert.equal(await p.locator('iframe.render').count(),0);}
  check('approved correction '+outcome+': exactly two rounds, durable mobile reload, honest terminal state');
 }
 assert.deepEqual(errors,[]);console.log('PASS browser-core: 12 checks; source='+root);
}finally{releaseProse?.();releaseCorrection?.();releaseFirst?.();releaseArtifact?.();releaseBuild?.();await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit')}mock.closeAllConnections();await new Promise(r=>mock.close(r));fs.rmSync(dir,{recursive:true,force:true});}
