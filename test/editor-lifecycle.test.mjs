// Current-contract acceptance for legacy browser sections 6b/6d/6e.
// Synthetic account only; no providers or production data.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {pathToFileURL} from 'node:url';import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-editor-life-')),base='http://127.0.0.1:4828';
const store=new Store(dir),user=store.createUser('editorowner','password123');
const initial={version:1,name:'Editor fixture',html:'<h2 id="fixture-heading">Original</h2><p id="value"></p>',css:'h2{color:#d4ef8b}',js:'ui.text("value",String(state.n));',state:{n:7}};
let app,browser;
try{
 app=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4828',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});app.once('exit',c=>{clearTimeout(t);reject(Error('early exit '+c))})});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]){
  const conv=store.createConversation(user.id),mid=store.appendMessage(conv.id,'assistant',{render:initial});
  const ctx=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}),p=await ctx.newPage(),errors=[],external=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith(base+'/'))external.push(r.url())});
  await p.goto(base);await p.locator('#loginform [name=username]').fill('editorowner');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').last().click();await p.locator('#login[open]').waitFor({state:'detached'});
  const frame=()=>p.frameLocator('#overlay iframe.render');
  const save=()=>p.waitForResponse(r=>r.url().endsWith('/api/state')&&r.request().method()==='POST');
  const close=async()=>{await p.getByRole('button',{name:'Element schliessen',exact:true}).click();await p.locator('#overlay[open]').waitFor({state:'detached'});assert.equal(await p.locator('#overlay iframe').count(),0);};
  await p.frameLocator('#feed iframe.render').locator('#value').filter({hasText:'7'}).waitFor();
  assert.equal(await p.locator('.elname').textContent(),initial.name);
  const pinResponse=p.waitForResponse(r=>r.url().endsWith('/api/pin'));await p.getByRole('button',{name:'Element anpinnen',exact:true}).click();assert.equal((await pinResponse).status(),200);
  await p.locator('#quickbar .qchip').filter({hasText:initial.name}).click();await frame().locator('#fixture-heading').filter({hasText:'Original'}).waitFor();
  await frame().locator('#value').filter({hasText:'7'}).waitFor();
  // destroy() intentionally retains inert DOM but terminates its interpreter.
  assert.equal(p.workers().length,1,'only overlay interpreter remains alive');
  await close();await p.frameLocator('#feed iframe.render').locator('#value').filter({hasText:'7'}).waitFor();
  await p.reload();await p.locator('#quickbar .qchip').filter({hasText:initial.name}).click();await frame().locator('#fixture-heading').waitFor();
  console.log('PASS '+width+' named pin persisted, overlay teardown and feed restoration');
  await p.getByRole('button',{name:'Code bearbeiten',exact:true}).click();
  await p.getByLabel('State (JSON)',{exact:true}).fill('{invalid');await p.getByRole('button',{name:'Anwenden',exact:true}).click();await p.getByText('State ist kein gültiges JSON.',{exact:true}).waitFor();assert.deepEqual(store.getRender(mid),initial);
  await p.getByLabel('State (JSON)',{exact:true}).fill(JSON.stringify({n:11}));await p.getByLabel('HTML',{exact:true}).fill('<h2 id="fixture-heading">Edited</h2><p id="value"></p>');
  let saved=save();await p.getByRole('button',{name:'Anwenden',exact:true}).click();assert.equal((await saved).status(),200);await frame().locator('#fixture-heading').filter({hasText:'Edited'}).waitFor();await frame().locator('#value').filter({hasText:'11'}).waitFor();assert.equal(store.getRender(mid).state.n,11);
  await close();await p.reload();await p.getByRole('button',{name:'Element öffnen',exact:true}).click();await frame().locator('#fixture-heading').filter({hasText:'Edited'}).waitFor();
  await p.getByRole('button',{name:'Versionen',exact:true}).click();assert.equal(await p.locator('.verow').count(),1);saved=save();await p.getByRole('button',{name:'Wiederherstellen',exact:true}).click();assert.equal((await saved).status(),200);await frame().locator('#fixture-heading').filter({hasText:'Original'}).waitFor();await frame().locator('#value').filter({hasText:'7'}).waitFor();assert.deepEqual(store.getRender(mid),initial);
  console.log('PASS '+width+' invalid JSON rejected, confirmed edit/reload and server version restore');
  await p.getByRole('button',{name:'Code bearbeiten',exact:true}).click();
  await p.getByLabel('HTML',{exact:true}).fill('<script>fetch("https://example.com/leak")</script><img src="https://example.com/pixel"><p id="safe">Safe remainder</p><input id="field" onclick="fetch(1)">');await p.getByLabel('JS',{exact:true}).fill('');saved=save();await p.getByRole('button',{name:'Anwenden',exact:true}).click();assert.equal((await saved).status(),200);
  await frame().locator('#safe').waitFor();assert.equal(await frame().locator('img,script:not([nonce])').count(),0);assert.equal(await frame().locator('#field').getAttribute('onclick'),null);
  await p.locator('#overlay').screenshot({path:'docs/screenshots/editor-lifecycle-'+width+'.png'});
  await close();await p.reload();await p.frameLocator('#feed iframe.render').locator('#safe').waitFor();assert.equal(await p.frameLocator('#feed iframe.render').locator('img,script:not([nonce])').count(),0);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  console.log('PASS '+width+' editor injection sanitized on apply/reload, zero external requests or page errors');
  await ctx.close();
  // Prevent the next viewport from seeing a second pin; isolated fixture cleanup only.
  store.db.prepare('UPDATE messages SET pinned=0 WHERE id=?').run(mid);
 }
 console.log('PASS editor lifecycle: source='+root);
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit')}store.close();fs.rmSync(dir,{recursive:true,force:true});}
