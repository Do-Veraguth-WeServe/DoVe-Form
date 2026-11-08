// Legacy browser section 6f, without obsolete implicit chat builds.
// HTTP responses are mocked: proves bridge/error delivery, NOT real ICMP policy.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {pathToFileURL} from 'node:url';import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-ping-browser-')),base='http://127.0.0.1:4829';
const store=new Store(dir),user=store.createUser('pingowner','password123');
const render={version:1,name:'Synthetic ping',html:'<input id="phost"><button id="go">Ping</button><p id="pout"></p>',css:'',state:{host:'example.com'},js:'ui.value("phost",state.host);ui.on("phost","input",e=>{state.host=e.value});ui.on("go","click",()=>{ui.text("pout","pending");ui.ping(state.host,r=>ui.text("pout",r.ok?("online · "+r.ms+" ms · "+r.ip):("offline · "+r.error)))})'};
let app,browser;
try{
 const conv=store.createConversation(user.id),mid=store.appendMessage(conv.id,'assistant',{render});
 app=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4829',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});app.once('exit',c=>{clearTimeout(t);reject(Error('early exit '+c))})});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]){
  const ctx=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}),p=await ctx.newPage(),errors=[],external=[],calls=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',route=>{const url=route.request().url();if(url.startsWith('http')&&!url.startsWith(base+'/')){external.push(url);return route.abort()}return route.continue()});
  await p.route('**/api/ping',route=>{
   const body=route.request().postDataJSON();calls.push(body);
   const status=calls.length>10?429:body.host==='private.example'?403:200;
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{ok:true,ip:'93.184.216.34',ms:23}:{ok:false,error:status===403?'Private oder reservierte Adresse blockiert.':'Ping-Limit erreicht (10/Minute).'})});
  });
  await p.goto(base);await p.locator('#loginform [name=username]').fill('pingowner');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#login[open]').waitFor({state:'detached'});
  const f=p.frameLocator('#feed iframe.render');await f.locator('#go').waitFor();
  await f.locator('#go').click();await f.locator('#pout').filter({hasText:'online · 23 ms · 93.184.216.34'}).waitFor();assert.equal(calls.length,1);
  await f.locator('#phost').fill('private.example');await f.locator('#go').click();await f.locator('#pout').filter({hasText:'offline · Private oder reservierte Adresse blockiert.'}).waitFor();assert.equal(calls.length,2);
  await f.locator('#phost').fill('example.com');
  for(let n=3;n<=11;n++){
   await f.locator('#go').click();await f.locator('#pout').filter({hasText:n>10?'offline · Ping-Limit erreicht':'online · 23 ms · 93.184.216.34'}).waitFor();assert.equal(calls.length,n,'one request/callback per completed interaction');
  }
  assert.ok(calls.every(c=>c.sessionId===conv.id),'trusted bridge uses owning conversation');
  await f.locator('#phost').fill('https://example.com');await f.locator('#go').click();await f.locator('#pout').filter({hasText:'Ungültiger Host.'}).waitFor();assert.equal(calls.length,11,'invalid host rejected before HTTP');
  assert.deepEqual(store.getRender(mid),render,'no user artifact or persisted state mutation');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  await p.reload();await p.locator('#feed iframe.render[data-ready=true]').waitFor();const restored=await (await p.locator('#feed iframe.render').elementHandle()).contentFrame();await restored.waitForFunction(()=>document.getElementById('phost')?.value==='example.com');assert.equal(await p.frameLocator('#feed iframe.render').locator('#phost').inputValue(),'example.com');assert.equal(calls.length,11,'reload never auto-pings');
  console.log('PASS '+width+': real QuickJS bridge; mocked success/403/429; host validation; conversation scope; unchanged artifact; reload; zero egress/errors');await ctx.close();
 }
 console.log('PASS ping browser source='+root);
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit')}store.close();fs.rmSync(dir,{recursive:true,force:true});}
