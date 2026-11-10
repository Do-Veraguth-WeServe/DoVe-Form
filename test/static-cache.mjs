import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {Store} from '../store.mjs';
const root=process.env.FORM_TEST_ROOT||process.cwd(), dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-cache-'));
const s=new Store(dir),u=s.createUser('cachefixture','password123'),c=s.createConversation(u.id);
s.appendMessage(c.id,'assistant',{render:{version:1,name:'Cache fixture',html:'<button id="tap">Ready</button>',css:'',js:'ui.on("tap","click",function(){ui.text("tap","Clicked");});',state:{}}});s.close();
let app,browser;
try {
 app=spawn('node',['server.mjs'],{cwd:root,env:{...process.env,PORT:'4786',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}})});
 const base='http://127.0.0.1:4786';
 for(const name of ['/','/app.js','/worker.js','/quickjs.wasm']) {
  const r=await fetch(base+name),body=await r.arrayBuffer(),tag=r.headers.get('etag');
  assert.ok(tag,'content validator required for '+name);assert.match(r.headers.get('cache-control'),/no-cache/);
  const cached=await fetch(base+name,{headers:{'If-None-Match':tag}});assert.equal(cached.status,304);assert.equal((await cached.arrayBuffer()).byteLength,0);
  const stale=await fetch(base+name,{headers:{'If-None-Match':'"old-version"'}});assert.equal(stale.status,200);assert.equal((await stale.arrayBuffer()).byteLength,body.byteLength);
 }
 for(const name of ['/api/auth/status','/api/health','/api/conversations','/unknown']){const r=await fetch(base+name,{headers:{'If-None-Match':'*'}});assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('etag'),null);assert.notEqual(r.status,304)}
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]) {
  const p=await browser.newPage({viewport:{width,height:844}}),session=await p.context().newCDPSession(p);await session.send('Network.enable');const assets=[],revalidated=[],requests=new Map();session.on('Network.requestWillBeSent',e=>requests.set(e.requestId,e.request.url));session.on('Network.responseReceivedExtraInfo',e=>{if(e.statusCode===304)revalidated.push(requests.get(e.requestId))});
  session.on('Network.responseReceived',e=>{if(/\/(app.js|worker.js|quickjs.wasm)$/.test(e.response.url))assets.push({url:e.response.url,cache:e.response.fromDiskCache||false})});
  await p.goto(base);await p.locator('#loginform [name=username]').fill('cachefixture');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#feed iframe[data-ready=true]').waitFor();
  await p.frameLocator('#feed iframe').locator('#tap').click();await p.frameLocator('#feed iframe').getByText('Clicked',{exact:true}).waitFor();
  for(let i=0;i<2;i++){await p.getByRole('button',{name:'Element öffnen',exact:true}).click();await p.locator('#overlay iframe[data-ready=true]').waitFor();await p.frameLocator('#overlay iframe').locator('#tap').click();await p.frameLocator('#overlay iframe').getByText('Clicked',{exact:true}).waitFor();await p.getByRole('button',{name:'Element schliessen',exact:true}).click();await p.locator('#overlay').waitFor({state:'hidden'});await p.locator('#feed iframe[data-ready=true]').waitFor()}
  await p.reload();await p.locator('#feed iframe[data-ready=true]').waitFor();assert.ok(revalidated.some(url=>url?.endsWith('/app.js')),'browser receives bodyless app.js 304 and reuses validated bytes');console.log(JSON.stringify({width,assetResponses:assets.length,validated304:revalidated.length,cacheHits:assets.filter(a=>a.cache).length}));await p.close();
 }
 console.log('PASS public validators/304/stale response; API private no-store; desktop/mobile feed, overlay reopen, interaction and reload');
} finally {await browser?.close();if(app){app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r))}fs.rmSync(dir,{recursive:true,force:true})}
