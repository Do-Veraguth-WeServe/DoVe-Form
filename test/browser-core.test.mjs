// Current-contract migration of legacy browser acceptance sections 0–4.
// Independent fixture; never accesses production accounts, models or data.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-browser-core-'));
const base='http://127.0.0.1:4825',key='fixture-only-key-1234567890';
let app,browser,builds=0,plans=0,chats=0,releaseFirst,releaseArtifact,releaseBuild;
let correctionMode=null,correctionAttempts=0,releaseCorrection,proseOnly=false,releaseProse;
let holdChat=false,heldChats=0,closedChats=0,signalHeld,signalClosed;
let cancelBuild=false,partialBuilds=0,closedBuilds=0,signalBuildClosed;
let reverseMode=false;const reverseBuilds=[];
let signalBuild;const buildStarted=new Promise(resolve=>{signalBuild=resolve});
const artifact={version:1,name:'Core-Regler',html:'<label for="amt">Wert</label><input id="amt" type="number"><p id="out"></p>',css:'p{color:#d4ef8b}',js:'ui.value("amt",String(state.value));function draw(){ui.text("out","Wert: "+state.value)}ui.on("amt","input",e=>{state.value=Number(e.value);draw();ui.persist()});draw();',state:{value:3}};
const mock=http.createServer(async(req,res)=>{
 try{let raw='';for await(const c of req)raw+=c;const d=JSON.parse(raw);assert.equal(req.headers.authorization,'Bearer '+key);
 res.writeHead(200,{'Content-Type':'text/event-stream'});
 const put=t=>res.write('data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n');
 const system=d.messages[0].content;
 if(system.includes('fast conversational planner')){plans++;put('<reply>Wir planen den Regler.</reply><title>Regler</title><summary>Ein Regler mit gespeichertem Zahlenwert.</summary><questions></questions><ready>true</ready>');}
 else if(system.includes('warm, concise conversational')&&holdChat){chats++;heldChats++;signalHeld?.();await new Promise(r=>res.once('close',()=>{heldChats--;closedChats++;signalClosed?.();r()}));return;}
 else if(system.includes('warm, concise conversational')&&proseOnly){chats++;put('Ein VPN ist ein Virtual Private Network. ');await new Promise(r=>{releaseProse=r;res.once('close',r)});if(res.destroyed)return;put('Es verschlüsselt die Verbindung zum VPN-Anbieter.');}
 else if(system.includes('warm, concise conversational')&&correctionMode){chats++;put('Wir besprechen den nächsten Regler. '+JSON.stringify({forms:[],planningOffer:{title:'Regler'}}));}
 else if(system.includes('warm, concise conversational')){chats++;put('Erster sichtbarer Abschnitt. ');await new Promise(r=>{releaseFirst=r;res.once('close',r)});if(res.destroyed)return;put('Zweiter sichtbarer Abschnitt. ');await new Promise(r=>{releaseArtifact=r;res.once('close',r)});if(res.destroyed)return;put(JSON.stringify({forms:[],planningOffer:{title:'Regler'}}));}
 else if(reverseMode){builds++;const entry={name:"Reverse-"+reverseBuilds.length,active:true};reverseBuilds.push(entry);await new Promise(r=>{entry.release=r;res.once("close",r)});entry.active=false;if(res.destroyed)return;put("```json\n"+JSON.stringify({...artifact,name:entry.name})+"\n```");}
 else if(cancelBuild){builds++;partialBuilds++;put('```json\n'+JSON.stringify(artifact).slice(0,120));await new Promise(r=>res.once('close',()=>{closedBuilds++;signalBuildClosed?.();r()}));return;}
 else if(correctionMode){builds++;correctionAttempts++;assert.ok(correctionAttempts<=2,'no unbounded correction');if(correctionAttempts===2){assert.match(d.messages.at(-1).content,/CSS capability preflight/);await new Promise(r=>{releaseCorrection=r;res.once('close',r)});if(res.destroyed)return;}const value=correctionAttempts===1||correctionMode==='fail'?{...artifact,css:'p::before{content:"unsupported";position:absolute}'}:artifact;put('```json\n'+JSON.stringify(value)+'\n```');}
 else{builds++;signalBuild();await new Promise(r=>{releaseBuild=r;res.once('close',r)});if(res.destroyed)return;put('```json\n'+JSON.stringify(artifact)+'\n```');}
 res.end('data: [DONE]\n\n');
 }catch(e){res.destroy(e);}
});
// Local transparent proxy can close existing SSE sockets; Chromium's offline flag
// alone does not reliably terminate already-open HTTP streams.
const streamSockets=new Set();let severedStreams=0;
const proxy=http.createServer((req,res)=>{
 const isStream=req.url==='/api/jobs/stream';
 if(isStream)streamSockets.add(res);
 const upstream=http.request({hostname:'127.0.0.1',port:4826,path:req.url,method:req.method,headers:req.headers},incoming=>{
  res.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(res);
 });
 upstream.on('error',()=>res.destroy());
 res.on('close',()=>{streamSockets.delete(res);upstream.destroy()});
 req.on('error',()=>upstream.destroy());req.pipe(upstream);
});
const api=async p=>(await browser.contexts()[0].request.get(base+p)).json();
const check=(label)=>console.log('PASS '+label);
try{
 await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(4825,'127.0.0.1',resolve)});
 await new Promise((resolve,reject)=>{mock.once('error',reject);mock.listen(4827,'127.0.0.1',resolve)});
 app=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4826',FORM3_ORIGIN:base,FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json'),FORM3_REGISTRATION:'1'},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('server startup timeout')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});app.once('exit',c=>{clearTimeout(t);reject(Error('early server exit '+c))})});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'}),errors=[];let p=await context.newPage();
 if(process.env.FORM_CORE_TRACE==='1'){
  p.on('console',m=>{if(m.text().startsWith('CORETRACE'))console.log(m.text());});
  let bundle=fs.readFileSync(path.join(root,'dist/app.js'),'utf8');
  for(const [before,after] of [
   ['function renderPreservingScroll() {','function renderPreservingScroll() {console.debug("CORETRACE render",new Error().stack);'],
   ['const previous = jobs.get(j2.id);','const previous = jobs.get(j2.id);console.debug("CORETRACE snapshot",JSON.stringify({previous,next:j2}));']
  ]){assert.ok(bundle.includes(before),before);bundle=bundle.replace(before,after);}
  await p.route('**/app.js',r=>r.fulfill({contentType:'text/javascript',body:bundle}));
 }
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
 await p.locator('.site[data-jobid]').waitFor();await p.waitForFunction(async()=>{const d=await(await fetch('/api/jobs')).json();return d.jobs.some(j=>j.state==='building')});await Promise.race([buildStarted,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('provider not reached')),10000);t.unref()})]);assert.equal(builds,1);assert.equal(await p.locator('iframe.render').count(),0);assert.equal((await api('/api/jobs')).jobs.filter(j=>j.state==='building').length,1);
 // Legacy7c: chat must finish while the approved build's upstream remains held.
 const heldJob=(await api('/api/jobs')).jobs.find(j=>j.state==='building');
 const heldSelector='.site[data-jobid="'+heldJob.id+'"]';
 proseOnly=true;const chatsBeforeBuild=chats;
 await p.locator('#prompt').fill('Erkläre ein VPN während der Regler gebaut wird');await p.locator('#prompt').press('Enter');
 await p.locator('.live .prose').filter({hasText:'Virtual Private Network'}).waitFor();releaseProse();
 await p.waitForFunction(()=>!document.querySelector('.live'));
 await p.locator('.message.assistant .prose').filter({hasText:'Es verschlüsselt die Verbindung'}).waitFor();
 assert.equal(chats,chatsBeforeBuild+1);assert.equal(builds,1);
 assert.equal((await api('/api/jobs')).jobs.find(j=>j.id===heldJob.id).state,'building');
 assert.equal(await p.locator(heldSelector).count(),1);assert.equal(await p.locator('iframe.render').count(),0);proseOnly=false;
 for(const width of [1280,390]){
  await p.setViewportSize({width,height:844});await p.reload();await p.locator(heldSelector).waitFor();
  assert.equal(await p.locator(heldSelector).count(),1);assert.equal(builds,1);
  assert.equal((await api('/api/jobs')).jobs.find(j=>j.id===heldJob.id).state,'building');
  assert.equal(await p.locator(heldSelector+' svg.crane').count(),1);
 }
 check('concurrent chat completes before held build; desktop/mobile reload retain one identical job');
 // Legacy7b: close the only tab before releasing any artifact bytes.
 await p.close();assert.equal(context.pages().length,0);
 assert.equal((await api('/api/jobs')).jobs.find(j=>j.id===heldJob.id).state,'building');
 assert.equal(builds,1);releaseBuild();
 // Ready jobs leave the public active snapshot: inspect only our isolated fixture DB.
 const fixtureDB=new DatabaseSync(path.join(dir,'form.db'),{readOnly:true});
 const jobState=()=>fixtureDB.prepare('SELECT state FROM jobs WHERE id=?').get(heldJob.id);
 try{
 const deadline=Date.now()+20000;let completed;
 do{completed=jobState();if(completed?.state==='ready'||completed?.state==='failed')break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
 assert.equal(completed?.state,'ready','build completes with no browser tab');
 assert.equal(context.pages().length,0);assert.equal(builds,1);
 const saved=(await api('/api/conversations')).conversations.find(c=>c.id===heldJob.conversationId);
 assert.equal(saved.messages.filter(m=>m.render?.name==='Core-Regler').length,1,'one publication while detached');
 for(const width of [1280,390]){
  p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewportSize({width,height:844});await p.goto(base);
  await p.frameLocator('iframe.render[data-ready=true]').locator('#out').filter({hasText:'Wert: 3'}).waitFor();
  assert.equal(await p.locator('iframe.render').count(),1);assert.equal(builds,1);
  assert.equal(jobState().state,'ready');
  assert.equal((await api('/api/jobs')).jobs.some(j=>j.id===heldJob.id),false,'ready job leaves active snapshot');
  assert.deepEqual((await api('/api/conversations')).conversations.find(c=>c.id===saved.id).messages,saved.messages);
  if(width===1280)await p.close();
 }
 }finally{fixtureDB.close()}
 check('tab-close build completion without viewer; desktop/mobile reopen one persisted Element, no regeneration');
 check('explicit approval and real held build before artifact');
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
 // Legacy section 7: explicit Stop aborts a genuinely open provider connection.
 // No sleeps or mock release can masquerade as server cancellation.
 for(const width of [1280,390]){
  await p.setViewportSize({width,height:844});holdChat=true;
  const before=await api('/api/conversations'),beforeJobs=await api('/api/jobs');
  const owner=before.conversations.find(c=>c.messages.some(m=>m.render?.name==='Core-Regler'));
  const element=owner.messages.find(m=>m.render?.name==='Core-Regler');
  const frame=await p.locator('iframe.render').elementHandle();
  const oldIds=beforeJobs.jobs.map(j=>j.id),closedBefore=closedChats,chatBefore=chats;
  const held=new Promise(r=>{signalHeld=r});
  await p.locator('#prompt').fill('Bitte warte auf meine nächste Nachricht');await p.locator('#prompt').press('Enter');
  await Promise.race([held,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('held chat upstream not reached')),10000);t.unref()})]);
  await p.locator('#stop').waitFor({state:'visible'});
  assert.equal(heldChats,1);assert.equal(closedChats,closedBefore);
  assert.equal(await frame.evaluate(el=>el.isConnected),true,'held chat retains the original Element');
  const pending=(await api('/api/jobs')).jobs.filter(j=>!oldIds.includes(j.id));assert.equal(pending.length,1);const jobId=pending[0].id;
  assert.equal(pending[0].kind,'chat');assert.equal(pending[0].state,'building');
  // Reduced-motion activity must not move, while retaining an honest live status.
  await p.locator('.activity[data-phase=thinking]').waitFor();
  assert.equal(await p.locator('.activity').count(),1);assert.equal(await p.locator('.site').count(),0);
  assert.equal(await p.locator('.activity').evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0);
  const closed=new Promise(r=>{signalClosed=r});
  await p.locator('#stop').click();await p.locator('#stop').waitFor({state:'hidden'});
  await Promise.race([closed,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Stop did not abort upstream')),5000);t.unref()})]);
  await p.waitForFunction(async id=>{const d=await(await fetch('/api/jobs')).json();return d.jobs.some(j=>j.id===id&&j.state==='cancelled')},jobId);
  // A fulfilled browser wait does not prove provider abort; observe the server-side socket too.
  assert.equal(heldChats,0);assert.equal(closedChats,closedBefore+1);assert.equal(chats,chatBefore+1);
  assert.equal(await p.locator('#send').isVisible(),true);assert.equal(await p.locator('#send').isDisabled(),false);
  // Stop performs canonical server recovery: old callbacks must not retain stale message objects.
  await p.waitForFunction(()=>!document.querySelector('.live'));
  assert.equal(await frame.evaluate(el=>el.isConnected),false,'canonical recovery deliberately replaces old snapshot');
  assert.equal(await p.locator('iframe.render').count(),1);
  await p.frameLocator('iframe.render').locator('#out').filter({hasText:'Wert: 9'}).waitFor();
  assert.equal(builds,1);assert.equal(plans,1);
  const after=(await api('/api/conversations')).conversations.find(c=>c.id===owner.id);
  assert.deepEqual(after.messages.find(m=>m.id===element.id),element);
  await p.reload();await p.frameLocator('iframe.render').locator('#out').filter({hasText:'Wert: 9'}).waitFor();
  assert.equal((await api('/api/jobs')).jobs.find(j=>j.id===jobId).state,'cancelled');
  assert.equal(heldChats,0);assert.equal(chats,chatBefore+1);assert.equal(await p.locator('#stop').isVisible(),false);
  check('explicit Stop '+width+': upstream aborted, durable cancellation, static reduced motion, Element preserved');
 }
 holdChat=false;
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
 // Legacy sections 10/12: fresh device and logout use current settings navigation.
 const canonical=await api('/api/conversations');
 const original=canonical.conversations.find(c=>c.messages.some(m=>m.render?.state?.value===9));
 assert.ok(original);assert.ok(canonical.conversations.length>=3);
 const expectedIds=canonical.conversations.map(c=>c.id).sort();
 const counts={builds,plans,chats};
 for(const width of [1280,390]){
  const fresh=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});
  try{
   assert.deepEqual(await fresh.cookies(),[]);
   const page=await fresh.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base);await page.locator('#login[open]').waitFor();
   assert.equal(await page.evaluate(()=>localStorage.length),0,'fresh device has no cached account data');
   assert.equal((await fresh.request.get(base+'/api/conversations')).status(),401);
   const login=async()=>{
    await page.locator('#loginform [name=username]').fill('coreowner');
    await page.locator('#loginform [name=password]').fill('password123');
    await page.locator('#loginform button').last().click();
    await page.locator('#login[open]').waitFor({state:'detached'});
    await page.locator('#sessions .session-open').first().waitFor({state:'attached'});
   };
   const verify=async()=>{
    const restored=await (await fresh.request.get(base+'/api/conversations')).json();
    assert.deepEqual(restored.conversations.map(c=>c.id).sort(),expectedIds);
    assert.deepEqual(restored.conversations.find(c=>c.id===original.id).messages,original.messages);
    assert.deepEqual((await page.locator('.session-row').evaluateAll(rows=>rows.map(r=>r.dataset.sid))).sort(),expectedIds);
    if(width===390)await page.locator('#mobile').click();
    await page.locator('.session-row[data-sid="'+original.id+'"] .session-open').click();
    await page.frameLocator('iframe.render').locator('#out').filter({hasText:'Wert: 9'}).waitFor();
    assert.equal(await page.frameLocator('iframe.render').locator('#amt').inputValue(),'9');
    assert.equal(await page.locator('iframe.render').count(),1);
    assert.deepEqual({builds,plans,chats},counts,'login does not generate or rebuild');
   };
   await login();await verify();check('fresh device '+width+': all conversations, exact saved messages and functioning Element');
   const oldCookies=await fresh.cookies(base);
   assert.ok(oldCookies.length>0);
   if(width===390)await page.locator('#mobile').click();
   await page.locator('#preferencesbtn').click();await page.locator('#logout').click();
   await page.locator('#login[open]').waitFor();
   assert.equal((await fresh.request.get(base+'/api/conversations')).status(),401);
   const replay=await fetch(base+'/api/conversations',{headers:{Cookie:oldCookies.map(c=>c.name+'='+c.value).join('; ')}});
   assert.equal(replay.status,401,'logged-out session cookie is revoked server-side');
   assert.equal((await context.request.get(base+'/api/conversations')).status(),200,'other device remains authenticated');
   await login();await verify();
   check('logout/relogin '+width+': revoked cookie, independent session retained, data restored without generation');
  }finally{await fresh.close()}
 }
 // Legacy7: cancel after actual artifact bytes, not just before upstream output.
 cancelBuild=true;
 for(const width of [1280,390]){
  await p.setViewportSize({width,height:844});
  if(width===390)await p.locator('#mobile').click();
  await p.locator('#new').click();
  await p.locator('#prompt').fill('Besprechen wir einen abbrechbaren Regler');await p.locator('#prompt').press('Enter');
  await p.locator('.planning-offer-start').waitFor();await p.waitForFunction(()=>!document.querySelector('.live'));
  const beforeBuilds=builds,beforePartial=partialBuilds,beforeClosed=closedBuilds;
  await p.locator('.planning-offer-start').click();await p.locator('.blueprint-execute:not([disabled])').waitFor({state:'attached'});
  if(await p.locator('.blueprint-toggle').getAttribute('aria-expanded')==='false')await p.locator('.blueprint-toggle').click();
  await p.locator('.blueprint-execute').click();
  await p.waitForFunction(async()=>{const d=await(await fetch('/api/jobs')).json();return d.jobs.some(j=>j.state==='building'&&j.kind==='create'&&j.phase==='artifact')});
  const job=(await api('/api/jobs')).jobs.find(j=>j.state==='building'&&j.kind==='create'&&j.phase==='artifact');
  assert.ok(job,JSON.stringify({jobs:await api('/api/jobs'),partialBuilds,closedBuilds,builds}));const site=p.locator('.site[data-jobid="'+job.id+'"]');
  await site.waitFor();
  // The mock writes a fenced JSON prefix before waiting; no complete artifact can publish.
  assert.equal(partialBuilds,beforePartial+1);assert.equal(closedBuilds,beforeClosed);assert.equal(builds,beforeBuilds+1);
  assert.equal(await p.locator('iframe.render').count(),0);assert.equal(await site.locator('svg.crane').count(),1);
  await p.reload();await site.waitFor();
  assert.equal((await api('/api/jobs')).jobs.find(j=>j.id===job.id).state,'building');
  assert.equal(builds,beforeBuilds+1);assert.equal(closedBuilds,beforeClosed);
  // Preserve legacy7b's motion/phase/overflow assertions under explicit approval.
  await p.emulateMedia({reducedMotion:'no-preference'});
  const moving=await site.locator('.load').evaluate(async el=>{
   const before=getComputedStyle(el).transform;
   await new Promise(r=>setTimeout(r,160));
   const cs=getComputedStyle(el);
   return {before,after:cs.transform,name:cs.animationName,duration:cs.animationDuration};
  });
  assert.equal(moving.name,'lower');assert.ok(parseFloat(moving.duration)>0);
  assert.notEqual(moving.before,moving.after,'crane load actually moves over time');
  const phase=await site.locator('.sitephase').innerText();
  assert.match(phase,/baut|Warteschlange|prüft/);assert.doesNotMatch(phase,/%/);
  assert.equal(await site.getByRole('button',{name:'Elementbau abbrechen'}).count(),1);
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await site.screenshot({path:'docs/screenshots/core-construction-'+width+'.png'});
  await p.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await site.evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0);
  assert.equal(partialBuilds,beforePartial+1);assert.equal(closedBuilds,beforeClosed);
  const closed=new Promise(r=>{signalBuildClosed=r});
  await site.getByRole('button',{name:'Elementbau abbrechen'}).click();
  await Promise.race([closed,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('build cancel did not abort artifact stream')),5000);t.unref()})]);
  await p.waitForFunction(async id=>{const d=await(await fetch('/api/jobs')).json();return d.jobs.some(j=>j.id===id&&j.state==='cancelled')},job.id);
  assert.equal(closedBuilds,beforeClosed+1);assert.equal(builds,beforeBuilds+1);
  assert.equal(await p.locator('iframe.render').count(),0);
  const saved=(await api('/api/conversations')).conversations.find(c=>c.id===job.conversationId);
  assert.equal(saved.messages.filter(m=>m.render).length,0,'partial artifact never persisted');
  await p.reload();await p.locator('.message[data-mid="'+job.messageId+'"] .notice').filter({hasText:'Abgebrochen.'}).waitFor();
  assert.equal(await p.locator('.site[data-jobid="'+job.id+'"]').count(),0,'cancelled build becomes an honest terminal notice');
  assert.equal((await api('/api/jobs')).jobs.find(j=>j.id===job.id).state,'cancelled');
  assert.equal(await p.locator('iframe.render').count(),0);assert.equal(builds,beforeBuilds+1);
  assert.deepEqual((await api('/api/conversations')).conversations.find(c=>c.id===job.conversationId).messages,saved.messages);
  check('artifact-phase cancel '+width+': real upstream abort, no partial publication, durable reload, no retry');
 }
 // Legacy7d: two independently approved builds complete in reverse order.
 cancelBuild=false;reverseMode=true;
 for(const width of [1280,390]){
  await p.setViewportSize({width,height:844});
  if(width===390&&!await p.locator('#new').isVisible())await p.locator('#mobile').click();
  await p.locator('#new').click();
  const start=reverseBuilds.length,before=builds,jobs=[];
  for(const label of ['first','second']){
   await p.locator('#prompt').fill('Neuer unabhängiger Regler '+label);await p.locator('#prompt').press('Enter');
   await p.waitForFunction(()=>!document.querySelector('.live'));
   await p.locator('.planning-offer-start').last().click();
   const execute=p.locator('.blueprint-execute:not([disabled])').last();await execute.waitFor({state:'attached'});
   // Use the current plan's own toggle, never approve a previous plan twice.
   const toggle=p.locator('.blueprint-toggle').last();
   if(await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
   await execute.click();
   await p.waitForFunction(async count=>{const d=await(await fetch('/api/jobs')).json();return d.jobs.filter(j=>j.kind==='create'&&j.state==='building').length===count},jobs.length+1);
   const active=(await api('/api/jobs')).jobs.filter(j=>j.kind==='create'&&j.state==='building');
   const job=active.find(j=>!jobs.some(old=>old.id===j.id));assert.ok(job);jobs.push(job);
   await p.locator('.site[data-jobid="'+job.id+'"]').waitFor();
  }
  const deadline=Date.now()+10000;while(reverseBuilds.length<start+2&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  const [a,b]=reverseBuilds.slice(start);assert.ok(a?.active&&b?.active,'both real upstreams held concurrently');
  assert.equal(builds,before+2);assert.notEqual(jobs[0].id,jobs[1].id);assert.notEqual(jobs[0].messageId,jobs[1].messageId);
  assert.equal(jobs[0].conversationId,jobs[1].conversationId);
  const siteA=p.locator('.site[data-jobid="'+jobs[0].id+'"]');
  const boxA=p.locator('.message[data-mid="'+jobs[0].messageId+'"]');
  const boxB=p.locator('.message[data-mid="'+jobs[1].messageId+'"]');
  // Lose the ready event while genuinely offline, then recover without navigation/reload.
  const documentToken=await p.evaluate(()=>window.acceptanceDocumentToken=crypto.randomUUID());
  const disconnected=p.waitForEvent('requestfailed',{predicate:r=>r.url().endsWith('/api/jobs/stream'),timeout:10000});
  await context.setOffline(true);
  assert.ok(streamSockets.size>0,'real SSE transport is connected before network cut');
  for(const response of [...streamSockets]){severedStreams++;response.destroy()}
  await disconnected;
  assert.equal(await p.evaluate(()=>navigator.onLine),false);
  b.release();
  const readJob=()=>{const db=new DatabaseSync(path.join(dir,'form.db'),{readOnly:true});try{return db.prepare('SELECT state FROM jobs WHERE id=?').get(jobs[1].id)?.state}finally{db.close()}};
  const readyDeadline=Date.now()+15000;
  while(readJob()!=='ready'&&Date.now()<readyDeadline)await new Promise(r=>setTimeout(r,50));
  assert.equal(readJob(),'ready','second build persists while its browser is offline');
  assert.equal(await boxB.locator('iframe.render').count(),0,'offline browser missed publication');
  assert.equal(a.active,true);assert.equal(builds,before+2);
  await context.setOffline(false);
  await boxB.frameLocator('iframe.render[data-ready=true]').locator('#out').filter({hasText:'Wert: 3'}).waitFor({timeout:20000});
  assert.equal(await p.evaluate(()=>window.acceptanceDocumentToken),documentToken,'no reload or navigation used to recover');
  assert.equal(await p.locator('.session-open[aria-current=true]').locator('..').getAttribute('data-sid'),jobs[0].conversationId);
  assert.equal(builds,before+2,'reconnect does not regenerate');
  assert.equal(a.active,true,'first upstream remains open after second publication');await siteA.waitFor();
  assert.equal(await boxA.locator('iframe.render').count(),0);assert.equal(await boxB.locator('.elname').innerText(),b.name);
  assert.equal((await api('/api/jobs')).jobs.find(j=>j.id===jobs[0].id).state,'building');
  a.release();await boxA.frameLocator('iframe.render[data-ready=true]').locator('#out').filter({hasText:'Wert: 3'}).waitFor();
  assert.equal(await boxA.locator('.elname').innerText(),a.name);assert.equal(await boxB.locator('.elname').innerText(),b.name);
  const saved=(await api('/api/conversations')).conversations.find(c=>c.id===jobs[0].conversationId);
  for(const [i,entry] of [a,b].entries())assert.equal(saved.messages.find(m=>m.id===jobs[i].messageId).render.name,entry.name);
  assert.equal(saved.messages.filter(m=>m.render).length,2);assert.equal(builds,before+2);
  await p.reload();
  for(const job of jobs)await p.locator('.message[data-mid="'+job.messageId+'"]').frameLocator('iframe.render[data-ready=true]').locator('#out').filter({hasText:'Wert: 3'}).waitFor();
  assert.equal(await p.locator('iframe.render').count(),2);assert.equal(builds,before+2);
  assert.deepEqual((await api('/api/conversations')).conversations.find(c=>c.id===saved.id).messages,saved.messages);
  check('reverse concurrent builds '+width+': second publishes first, exact message placement, persisted reload, no regeneration');
 }
 assert.deepEqual(errors,[]);console.log('PASS browser-core: 24 checks; source='+root);
}finally{for(const entry of reverseBuilds)entry.release?.();releaseProse?.();releaseCorrection?.();releaseFirst?.();releaseArtifact?.();releaseBuild?.();await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit')}mock.closeAllConnections();await new Promise(r=>mock.close(r));proxy.closeAllConnections();await new Promise(r=>proxy.close(r));fs.rmSync(dir,{recursive:true,force:true});}
