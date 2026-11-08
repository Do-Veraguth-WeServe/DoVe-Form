// Legacy9 collection/surface and legacy13 mobile acceptance; synthetic data only.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {pathToFileURL} from 'node:url';import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-collection-')),base='http://127.0.0.1:4834';
const store=new Store(dir),user=store.createUser('collectionowner','password123');
const fixtures=['Alpha','Beta'].map((name,i)=>{const conv=store.createConversation(user.id,name+' chat');const render={version:1,name:name+' element',html:'<p id="value"></p><button id="increment">Increment</button>',css:'',js:'ui.text("value",String(state.n));ui.on("increment","click",()=>{state.n++;ui.text("value",String(state.n));ui.persist()});',state:{n:i*10}};const mid=store.appendMessage(conv.id,'assistant',{render});store.setPinned(user.id,mid,true);return{conv,mid,render}});
let app,browser;
try{
 app=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4834',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});app.once('exit',c=>{clearTimeout(t);reject(Error('early exit '+c))})});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]){
  const ctx=await browser.newContext({viewport:{width,height:844},hasTouch:width===390,reducedMotion:'reduce'}),p=await ctx.newPage(),errors=[],external=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith(base+'/'))external.push(r.url())});
  await p.goto(base);await p.locator('#loginform [name=username]').fill('collectionowner');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#login[open]').waitFor({state:'detached'});
  const sidebar=async()=>{if(width===390&&!await p.locator('#sidebar').evaluate(e=>e.classList.contains('open')))await p.locator('#mobile').tap()};
  const close=async()=>{await p.getByRole('button',{name:'Element schliessen',exact:true}).click();await p.locator('#overlay[open]').waitFor({state:'detached'});assert.equal(await p.locator('#overlay iframe').count(),0)};
  for(const target of fixtures){
   const other=fixtures.find(f=>f!==target);
   await sidebar();await p.locator('#chats-tab').click();await p.locator('#sessions .session-open').getByText(other.conv.title,{exact:true}).click();
   await p.waitForFunction(id=>JSON.parse(localStorage.getItem('form.v3')).current===id,other.conv.id);
   await sidebar();await p.locator('#elements-tab').click();assert.equal(await p.locator('#sessions').isVisible(),false);
   assert.deepEqual((await p.locator('#elements-list button').allTextContents()).sort(),fixtures.map(f=>f.render.name).sort());
   const entry=p.locator('#elements-list button[data-mid="'+target.mid+'"]');assert.equal(await entry.getAttribute('title'),target.conv.title);await entry.click();
   await p.locator('#overlay[open]').waitFor();assert.equal(await p.locator('#overlay .ovhead strong').innerText(),target.render.name);
   await p.waitForFunction(id=>JSON.parse(localStorage.getItem('form.v3')).current===id,target.conv.id);
   const f=p.frameLocator('#overlay iframe.render');const before=store.getRender(target.mid).state.n,otherBefore=store.getRender(other.mid);
   await f.locator('#value').filter({hasText:String(before)}).waitFor();
   const saved=p.waitForResponse(r=>r.url().endsWith('/api/state')&&r.request().method()==='POST');await f.locator('#increment').click();const response=await saved;assert.equal(response.status(),200);
   const body=response.request().postDataJSON();assert.equal(body.messageId,target.mid);assert.equal(store.db.prepare('SELECT conversation_id FROM messages WHERE id=?').get(body.messageId).conversation_id,target.conv.id);
   assert.equal(store.getRender(target.mid).state.n,before+1);assert.deepEqual(store.getRender(other.mid),otherBefore,'other conversation unchanged');
   const surface=await p.evaluate(()=>({overlay:getComputedStyle(document.querySelector('#overlay')).backgroundColor,chat:getComputedStyle(document.body).backgroundColor,border:getComputedStyle(document.querySelector('#overlay')).borderTopWidth}));assert.equal(surface.overlay,surface.chat);assert.equal(surface.border,'0px');
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await p.locator('#overlay').screenshot({path:'docs/screenshots/collection-'+width+'.png'});
   await close();await p.reload();await p.frameLocator('#feed iframe.render').locator('#value').filter({hasText:String(before+1)}).waitFor();
   assert.equal(await p.locator('#feed .elname').innerText(),target.render.name);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   console.log('PASS '+width+' cross-conversation '+target.render.name+': exact owner context/state request, other data unchanged, reload, surface and overflow');
  }
  if(width===390){const menu=await p.locator('#mobile').boundingBox(),status=await p.locator('#statuslabel').boundingBox();assert.equal(await p.locator('#settingsbtn').count(),0,'obsolete header settings removed by unified settings');assert.ok(menu&&status&&menu.x>=status.x+status.width&&menu.x+menu.width<=390);await sidebar();assert.ok(await p.locator('#sidebar').evaluate(e=>e.classList.contains('open')));await p.locator('#mobile').tap();assert.equal(await p.locator('#sidebar').evaluate(e=>e.classList.contains('open')),false);console.log('PASS mobile menu right, touch open/close');}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await ctx.close();
 }
 console.log('PASS collection acceptance: '+root);
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit')}store.close();fs.rmSync(dir,{recursive:true,force:true});}
