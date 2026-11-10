import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {chromium} from 'playwright-core';import {Store} from '../store.mjs';import {ElementSharing,elementCodeRevision} from '../element-sharing.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-owner-save-')),BASE='http://127.0.0.1:4775';let app,browser;
const s=new Store(dir),a=s.createUser('alice','password123'),b=s.createUser('bobby','password123'),conv=s.createConversation(a.id);
const render={version:1,name:'Owner CAS',html:'<p id="n"></p><button id="inc">Increment</button>',css:'',js:'ui.text("n",state.n);ui.on("inc","click",()=>{state.n++;ui.text("n",state.n);ui.persist(state);});',state:{n:0}};
const mid=s.appendMessage(conv.id,'assistant',{render}),g=new ElementSharing(s,null),offer=g.offer(a.id,{messageId:mid,revision:elementCodeRevision(render),recipient:'bobby'});g.accept(b.id,offer.id);
const state=()=>s.getRender(mid).state.n;
// Keep remote snapshot delivery pending: exercise the real CAS race even when
// background synchronization would normally win. No production gate is removed.
let releaseSnapshots;const snapshotGate=new Promise(resolve=>releaseSnapshots=resolve);
try{
 app=spawn('node',['server.mjs'],{env:{...process.env,PORT:'4775',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const p=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));if(process.env.REPRO_BASELINE==='1')await p.route('**/app.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync('/opt/form/dist/app.js')}));await p.goto(BASE);await p.locator('#loginform [name=username]').fill('alice');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#login[open]').waitFor({state:'detached'});
 await p.route('**/api/elements/owner/view?*',async route=>{
  // Initial mounts now require a canonical baseline. Hold only background
  // refreshes of an already mounted surface; keep the real CAS conflict.
  if(!await p.locator('#feed iframe').count()){await route.continue();return;}
  await snapshotGate;await route.abort().catch(()=>{});
 });
 const frame=()=>p.frameLocator('#feed iframe').first();
 for(const width of [1280,390]){
 await p.setViewportSize({width,height:844});await frame().locator('#inc').waitFor();const before=state();
 const saved=p.waitForResponse(r=>r.url().endsWith('/api/state'));await frame().locator('#inc').click();assert.equal((await saved).status(),200,'owner shared writes need a valid token');assert.equal(state(),before+1);
 await p.reload();await frame().locator('#n').waitFor();assert.equal(await frame().locator('#n').textContent(),String(before+1));
 const view=g.view(b.id,offer.id);g.state(b.id,offer.id,{state:{n:before+10},expectedRevision:view.stateRevision});
 const conflict=p.waitForResponse(r=>r.url().endsWith('/api/state')&&r.status()===409);await frame().locator('#inc').click();await conflict;
 await p.getByText('Das Element wurde inzwischen geändert. Neu geladen; deine Änderung wurde nicht übernommen.',{exact:true}).first().waitFor();
 await p.waitForFunction(n=>JSON.parse(localStorage.getItem('form.v3')).sessions[0].messages[0].render.state.n===n,before+10);
 await frame().locator('#n').waitFor();assert.equal(await frame().locator('#n').textContent(),String(before+10));assert.equal(state(),before+10);
 await p.screenshot({path:'docs/screenshots/owner-cas-'+width+'.png'});
 }
 // Same-state remote code and actions changes must invalidate the mounted snapshot.
 for(const change of ['html','actions']){
   await p.reload();await frame().locator('#inc').waitFor();
   const previous=s.getRender(mid),newer=change==='html'?{...previous,html:previous.html+'<p>Remote revision</p>'}:{...previous,actions:[]};
   s.updateMessageRender(a.id,mid,newer);
   const conflict=p.waitForResponse(r=>r.url().endsWith('/api/state')&&r.status()===409);
   await frame().locator('#inc').click();await conflict;
   await p.waitForFunction(expected=>JSON.stringify(JSON.parse(localStorage.getItem('form.v3')).sessions[0].messages[0].render).includes(expected),change==='html'?'Remote revision':'"actions":[]');
   assert.deepEqual(s.getRender(mid),newer);
 }
 // Restore fixture code, then open its fresh snapshot. This is disposable test data only.
 s.updateMessageRender(a.id,mid,{...render,state:{n:state()}});await p.reload();await frame().locator('#inc').waitFor();
 // A stale editor must not claim success or replace either code or shared state.
 await p.getByRole('button',{name:'Element öffnen',exact:true}).click();await p.getByRole('button',{name:'Code bearbeiten',exact:true}).click();await p.getByLabel('HTML',{exact:true}).fill('<p>Rejected edit</p>');
 let view=g.view(b.id,offer.id);g.state(b.id,offer.id,{state:{n:90},expectedRevision:view.stateRevision});const rejected=p.waitForResponse(r=>r.url().endsWith('/api/state')&&r.status()===409);await p.getByRole('button',{name:'Anwenden',exact:true}).click();await rejected;await p.locator('#overlay').waitFor({state:'hidden'});assert.equal(s.getRender(mid).html,render.html);assert.equal(state(),90);
 await p.waitForFunction(()=>JSON.parse(localStorage.getItem('form.v3')).sessions[0].messages[0].render.state.n===90);
 // Fresh full replacement is confirmed before success UI.
 await p.getByRole('button',{name:'Element öffnen',exact:true}).click();await p.getByRole('button',{name:'Code bearbeiten',exact:true}).click();await p.getByLabel('HTML',{exact:true}).fill(render.html+'<p>Confirmed edit</p>');const applied=p.waitForResponse(r=>r.url().endsWith('/api/state')&&r.status()===200);await p.getByRole('button',{name:'Anwenden',exact:true}).click();await applied;assert.ok(s.getRender(mid).html.includes('Confirmed edit'));assert.equal(state(),90);assert.deepEqual(errors,[]);
 await p.getByRole('button',{name:'Element schliessen',exact:true}).click();await frame().locator('#inc').waitFor();
 await p.route('**/api/state',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));await p.route('**/api/conversations',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));
 await frame().locator('#inc').click();await p.locator('#feed').getByText('Speichern nicht bestätigt. Bitte die Seite neu laden.',{exact:true}).waitFor();assert.equal(await p.locator('#feed iframe').count(),0);assert.equal(state(),90);
 console.log('PASS offline reconciliation freezes sandbox; desktop/mobile owner CAS, real recipient conflict, persisted reload, stale editor rejection, confirmed full replacement. No production data.');
}finally{releaseSnapshots();await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit');}s.close();fs.rmSync(dir,{recursive:true,force:true});}
