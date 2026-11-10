import {ElementDB} from '../db.mjs';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {chromium} from 'playwright-core';import {Store} from '../store.mjs';import {ElementSharing,elementCodeRevision} from '../element-sharing.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-owner-save-')),BASE='http://127.0.0.1:4777';let app,browser,page;const transport=[];
const s=new Store(dir),a=s.createUser('alice','password123'),b=s.createUser('bobby','password123'),conv=s.createConversation(a.id);
const render={version:1,name:'Owner CAS',html:'<p id="n"></p><button id="inc">Increment</button>',css:'',js:'ui.text("n",state.n);ui.on("inc","click",()=>{state.n++;ui.text("n",state.n);ui.persist(state);});',state:{n:0}};
const mid=s.appendMessage(conv.id,'assistant',{render}),g=new ElementSharing(s,null),offer=g.offer(a.id,{messageId:mid,revision:elementCodeRevision(render),recipient:'bobby'});g.accept(b.id,offer.id);
s.db.exec('PRAGMA busy_timeout=3000');
const recipient=s.createSession(b.id);
async function recipientState(n){
 const headers={cookie:'form3sess='+recipient.token,origin:BASE,'X-Form-CSRF':recipient.csrf,'Content-Type':'application/json'};
 const viewResponse=await fetch(BASE+'/api/elements/grants/view?id='+offer.id,{headers});assert.equal(viewResponse.status,200);
 const view=await viewResponse.json();
 const response=await fetch(BASE+'/api/elements/grants/state',{method:'POST',headers,body:JSON.stringify({id:offer.id,state:{n},expectedRevision:view.stateRevision})});
 assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
}
const state=()=>s.getRender(mid).state.n;const edb=new ElementDB(path.join(dir,'elements.sqlite'));
try{
 app=spawn('node',['server.mjs'],{cwd:process.env.FORM_TEST_ROOT||process.cwd(),env:{...process.env,PORT:'4777',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const p=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page=p;p.on('pageerror',e=>errors.push(e.message));p.on('response',async r=>{if(r.url().includes('/api/elements/owner/')||r.url().endsWith('/api/state')){const item={path:new URL(r.url()).pathname,status:r.status()};transport.push(item);if(!r.url().includes('/stream'))try{const data=await r.json();item.n=data.render?.state?.n??data.state?.n;}catch{}}});if(process.env.REPRO_BASELINE==='1')await p.route('**/app.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync('/opt/form/dist/app.js')}));await p.goto(BASE);await p.locator('#loginform [name=username]').fill('alice');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#login[open]').waitFor({state:'detached'});
 const frame=()=>p.frameLocator('#feed iframe').first();
 for(const width of [1280,390]){
 await p.setViewportSize({width,height:844});await p.reload();await frame().locator('#inc').waitFor();
 for(const overlay of [false,true]){
 if(overlay)await p.getByRole('button',{name:'Element öffnen',exact:true}).click();
 const target=()=>p.frameLocator(overlay?'#overlay iframe':'#feed iframe').first();
 await target().locator('#n').waitFor();const before=state();await recipientState(before+10);
 if(process.env.FORM_OWNER_STALE_REPRO==='1'){
 await new Promise(r=>setTimeout(r,2500));assert.equal(state(),before+10);assert.equal(await target().locator('#n').textContent(),String(before),'reproduce stale mounted owner view');console.log('REPRODUCED stale owner '+(overlay?'overlay':'feed')+' width='+width);await p.screenshot({path:'docs/screenshots/owner-stale-'+width+'-'+(overlay?'overlay':'feed')+'.png'});
 }else{await target().locator('#n').filter({hasText:new RegExp('^'+(before+10)+'$')}).waitFor({timeout:6000});const saved=p.waitForResponse(r=>r.url().endsWith('/api/state'));await target().locator('#inc').click();assert.equal((await saved).status(),200);assert.equal(state(),before+11);}
 if(overlay)await p.getByRole('button',{name:'Element schliessen',exact:true}).click();else await p.reload();
 }
 }
 if(process.env.FORM_OWNER_STALE_REPRO!=='1'){
 if(process.env.FORM_OWNER_DB_ONLY!=='1'){
 // Hold an already-committed owner response while a recipient changes state.
 // No remount is allowed before local settlement; afterwards fetch canonical state.
 await frame().locator('#inc').waitFor();
 const originalFrame=await p.locator('#feed iframe').elementHandle();
 let releaseSave,saveSeen;const saveGate=new Promise(resolve=>releaseSave=resolve),saveCommitted=new Promise(resolve=>saveSeen=resolve);
 await p.route('**/api/state',async route=>{const response=await route.fetch();assert.equal(response.status(),200);saveSeen();await saveGate;await route.fulfill({response}).catch(()=>{});});
 let remoteValue;
 try{
 await frame().locator('#inc').click();await saveCommitted;remoteValue=state()+10;await recipientState(remoteValue);
 await new Promise(resolve=>setTimeout(resolve,1200));
 assert.equal(await originalFrame.evaluate(f=>f.isConnected&&!f.dataset.retained),true);
 assert.equal(await p.locator('#feed iframe').count(),1);
 }finally{releaseSave();await p.unrouteAll({behavior:'wait'});}
 await frame().locator('#n').filter({hasText:new RegExp('^'+remoteValue+'$')}).waitFor({timeout:6000});
 const subsequent=p.waitForResponse(r=>r.url().endsWith('/api/state'));await frame().locator('#inc').click();assert.equal((await subsequent).status(),200);assert.equal(state(),remoteValue+1);
 console.log('PASS pending owner acknowledgement defers remote replacement and resumes fresh CAS writes');
 }else console.log('FOCUSED DB RUN: pending-state gate intentionally not run; full failure retained separately');
 // Deterministic handoff: hold app-owned Worker loading, not the guest itself.
 for(const width of [1280,390]){
 await p.setViewportSize({width,height:844});await frame().locator('#inc').waitFor();
 let releaseWorker;const gate=new Promise(resolve=>releaseWorker=resolve);
 await p.route('**/worker.js',async route=>{await gate;await route.continue().catch(()=>{});});
 try{
 const before=state();await recipientState(before+10);
 await p.locator('#feed iframe[data-retained]').waitFor({timeout:6000});
 assert.equal(await p.frameLocator('#feed iframe[data-retained]').locator('#n').textContent(),String(before));
 assert.equal(await p.locator('#feed iframe[data-retained]').evaluate(f=>f.inert&&f.tabIndex===-1),true);
 assert.equal(await p.locator('#feed iframe[data-staging]').evaluate(f=>f.inert&&getComputedStyle(f).opacity==='0'),true);
 await p.locator('#feed').screenshot({path:'docs/screenshots/owner-handoff-'+width+'.png'});
 }finally{releaseWorker();await p.unrouteAll({behavior:'wait'});}
 await p.locator('#feed iframe[data-retained]').waitFor({state:'detached'});
 await frame().locator('#n').filter({hasText:new RegExp('^'+state()+'$')}).waitFor();
 }
 console.log('PASS inert frozen owner handoff during delayed Worker desktop/mobile');
 edb.op({sessionId:conv.id,elementId:mid,op:'create',table:'notes'});
 const dbRender={...render,html:render.html+'<p id="rows"></p><p id="boot"></p><button id="add">Add row</button>',js:render.js+'ui.db.select("notes",{},r=>ui.text("rows",r.rows?.length||0));ui.db.insert("notes",{text:"startup"},r=>ui.text("boot",r.ok?"written":"blocked"));ui.on("add","click",()=>ui.db.insert("notes",{text:"owner click"},r=>ui.text("boot",r.ok?"saved":"error")));'};
 // Remote code refresh, not page reload: must not replay startup writes.
 s.db.exec('PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');try{s.updateMessageRender(a.id,mid,{...dbRender,state:{n:state()}});s.db.exec('COMMIT');}catch(error){s.db.exec('ROLLBACK');throw error;}
 await frame().locator('#boot').filter({hasText:'blocked'}).waitFor({timeout:6000});
 assert.equal(edb.op({sessionId:conv.id,elementId:mid,op:'select',table:'notes'}).result.rows.length,0);
 for(const width of [1280,390]){
 await p.setViewportSize({width,height:844});
 const count=width===1280?1:2;
 edb.op({sessionId:conv.id,elementId:mid,op:'insert',table:'notes',row:{text:'recipient synthetic'}});
 await frame().locator('#rows').filter({hasText:new RegExp('^'+count+'$')}).waitFor({timeout:6000});
 await frame().locator('#boot').filter({hasText:'blocked'}).waitFor();
 await p.screenshot({path:'docs/screenshots/owner-live-db-'+width+'.png'});
 assert.equal(edb.op({sessionId:conv.id,elementId:mid,op:'select',table:'notes'}).result.rows.length,count);
 }
 // Code replacement correctly invalidates the old grant; opt in afresh for
 // this synthetic revision before testing a recipient update. Never bypass ACL.
 g.close(a.id,offer.id);offer.id=g.offer(a.id,{messageId:mid,revision:elementCodeRevision(s.getRender(mid)),recipient:'bobby'}).id;g.accept(b.id,offer.id);
 // A replacement remains frozen until its initial DB reads finish. Offline
 // during that handoff must remove both surfaces and ignore the late callback.
 let releaseDb,seenDb;const dbGate=new Promise(resolve=>releaseDb=resolve),dbSeen=new Promise(resolve=>seenDb=resolve);
 await p.route('**/api/db',async route=>{if(route.request().postDataJSON()?.op==='select'){seenDb();await dbGate;}await route.continue().catch(()=>{});});
 try{
 await recipientState(state()+10);await Promise.race([dbSeen,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('DB handoff not reached')),6000);timer.unref();})]);
 assert.equal(await p.locator('#feed iframe[data-retained]').count(),1);
 assert.equal(await p.locator('#feed iframe[data-staging]').evaluate(f=>f.inert&&getComputedStyle(f).opacity==='0'),true);
 await p.locator('#feed').screenshot({path:'docs/screenshots/owner-handoff-db-mobile.png'});
 await p.evaluate(()=>dispatchEvent(new Event('offline')));
 }finally{releaseDb();await p.unrouteAll({behavior:'wait'});}
 await p.getByText('Offline. Bitte erneut verbinden.',{exact:true}).waitFor();assert.equal(await p.locator('#feed iframe').count(),0);
 await p.getByRole('button',{name:'Erneut verbinden',exact:true}).click();
 await frame().locator('#boot').filter({hasText:'blocked'}).waitFor();
 assert.equal(edb.op({sessionId:conv.id,elementId:mid,op:'select',table:'notes'}).result.rows.length,2);
 console.log('PASS remote code/DB updates desktop/mobile, startup mutation suppression and offline explicit reconnect');
 // Reconnect is one batched operation: every failed mounted view must recover,
 // including unchanged revisions, not just the view whose button was clicked.
 s.appendMessage(conv.id,'assistant',{render:{...render,name:'Second counter',state:{n:7}}});
 await p.reload();await p.waitForFunction(()=>document.querySelectorAll('#feed iframe[data-ready=true]').length===2);
 await p.evaluate(()=>dispatchEvent(new Event('offline')));
 assert.equal(await p.locator('#feed iframe').count(),0);
 assert.equal(await p.getByRole('button',{name:'Erneut verbinden',exact:true}).count(),2);
 await p.getByRole('button',{name:'Erneut verbinden',exact:true}).first().click();
 await p.waitForFunction(()=>document.querySelectorAll('#feed iframe[data-ready=true]').length===2,null,{timeout:6000});
 assert.equal(await p.getByRole('button',{name:'Erneut verbinden',exact:true}).count(),0);
 console.log('PASS one explicit reconnect recovers all mounted owner views');
 // A successful owner's own DB operation must not replace its Worker and lose
 // callback state (or an animation started by that callback) on the SSE echo.
 const ownDbFrame=await p.locator('#feed iframe').first().elementHandle();
 await frame().locator('#add').click();await frame().locator('#boot').filter({hasText:'saved'}).waitFor();
 await new Promise(resolve=>setTimeout(resolve,1600));
 assert.equal(await ownDbFrame.evaluate(f=>f.isConnected&&!f.dataset.retained),true,'own DB acknowledgement must preserve the running owner sandbox');
 assert.equal(await frame().locator('#boot').textContent(),'saved');
 console.log('PASS own DB callback survives owner revision echo');
 const recipientDb=async()=>{
  const response=await fetch(BASE+'/api/elements/grants/db',{method:'POST',headers:{cookie:'form3sess='+recipient.token,origin:BASE,'X-Form-CSRF':recipient.csrf,'Content-Type':'application/json'},body:JSON.stringify({id:offer.id,op:'insert',table:'notes',row:{text:'remote race'}})});
  assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
 };
 // Remote DB writes on either side of a delayed local receipt must not be
 // acknowledged as local. Pending callbacks must retain their current surface.
 for(const phase of ['before','after']){
  const expectedCount=edb.op({sessionId:conv.id,elementId:mid,op:'select',table:'notes'}).result.rows.length+2;
  const mounted=await p.locator('#feed iframe').first().elementHandle();
  let release,seen;const gate=new Promise(r=>release=r),arrived=new Promise(r=>seen=r);
  await p.route('**/api/db',async route=>{
   if(route.request().postDataJSON()?.op!=='insert'){await route.continue();return;}
   if(phase==='before'){seen();await gate;await route.continue().catch(()=>{});}
   else{const response=await route.fetch();seen();await gate;await route.fulfill({response}).catch(()=>{});}
  });
  try{
   await frame().locator('#add').click();await arrived;await recipientDb();
   await new Promise(r=>setTimeout(r,1100));assert.equal(await mounted.evaluate(f=>f.isConnected&&!f.dataset.retained),true);
  }finally{release();await p.unrouteAll({behavior:'wait'});}
  await frame().locator('#rows').filter({hasText:new RegExp('^'+expectedCount+'$')}).waitFor({timeout:6000});
  assert.equal(edb.op({sessionId:conv.id,elementId:mid,op:'select',table:'notes'}).result.rows.length,expectedCount);
  assert.equal(await mounted.evaluate(f=>f.isConnected),false);
 }
 console.log('PASS real recipient DB writes before/after held owner receipt are reconciled, not swallowed');
 // The full-screen owner surface must receive DB changes too.
 await p.getByRole('button',{name:'Element öffnen',exact:true}).first().click();
 const overlayFrame=()=>p.frameLocator('#overlay iframe').first();await p.locator('#overlay iframe[data-ready=true]').waitFor();
 await recipientDb();
 const count=edb.op({sessionId:conv.id,elementId:mid,op:'select',table:'notes'}).result.rows.length;
 await overlayFrame().locator('#rows').filter({hasText:new RegExp('^'+count+'$')}).waitFor({timeout:6000});
 const overlayNode=await p.locator('#overlay iframe').elementHandle();await overlayFrame().locator('#add').click();
 await overlayFrame().locator('#boot').filter({hasText:'saved'}).waitFor();await new Promise(r=>setTimeout(r,1600));
 assert.equal(await overlayNode.evaluate(f=>f.isConnected&&!f.dataset.retained),true);
 await p.getByRole('button',{name:'Element schliessen',exact:true}).click();
 console.log('PASS overlay DB remote refresh and local callback continuity');
 }
 assert.deepEqual(errors,[]);
 console.log(process.env.FORM_OWNER_STALE_REPRO==='1'?'Baseline reproduced only; NOT fixed':'PASS owner state sync and fresh owner write desktop/mobile feed/overlay');
}catch(error){console.error('Owner fixture failure',JSON.stringify({transport,stored:state(),visible:await Promise.all((page?.frames()||[]).slice(1).map(f=>f.locator('#n').textContent({timeout:1000}).catch(()=>null))),body:await page?.locator('body').innerText(),frames:await page?.locator('iframe').evaluateAll(nodes=>nodes.map(n=>({ready:n.dataset.ready,owner:n.parentElement.dataset,staging:n.dataset.staging,retained:n.dataset.retained,style:n.getAttribute('style')})))}));throw error;}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit');}edb.close();s.close();fs.rmSync(dir,{recursive:true,force:true});}
