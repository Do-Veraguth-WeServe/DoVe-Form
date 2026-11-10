// Synthetic profiling only: no production accounts, provider calls or runtime edits.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';import {Store} from '../store.mjs';
const root=process.env.FORM_TEST_ROOT||process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-startup-profile-'));
const s=new Store(dir),u=s.createUser('profilefixture','password123'),c=s.createConversation(u.id);
s.appendMessage(c.id,'assistant',{render:{version:1,name:'Synthetic startup',html:'<button id="tap">Ready</button>',css:'',js:'ui.on("tap","click",()=>ui.text("tap","Clicked"));',state:{}}});s.close();
let app,browser;const results=[];
try {
 app=spawn('node',['server.mjs'],{cwd:root,env:{...process.env,PORT:'4788',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});app.once('exit',()=>{clearTimeout(t);reject(Error('server exited'));});});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:844}}),p=await context.newPage();
  // Passive instrumentation, no routing/interception or production debug hook.
  await p.addInitScript(()=>{
   window.startupMarks=[];const seen=new WeakSet(),ready=new WeakSet();
   const record=()=>{for(const f of document.querySelectorAll('iframe')){
    const surface=f.closest('#overlay')?'overlay':'feed';
    if(!seen.has(f)){seen.add(f);window.startupMarks.push({phase:'frame-attached',surface,t:performance.now()});}
    if(f.dataset.ready==='true'&&!ready.has(f)){ready.add(f);window.startupMarks.push({phase:'frame-ready',surface,t:performance.now()});}
   }};
   new MutationObserver(record).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-ready']});
  });
  await p.goto('http://127.0.0.1:4788');
  await p.locator('#loginform [name=username]').fill('profilefixture');await p.locator('#loginform [name=password]').fill('password123');
  const collect=async(label,start,surface)=>{
   await p.locator('#'+surface+' iframe[data-ready=true]').waitFor();
   const evidence=await p.evaluate(({start,surface})=>({marks:window.startupMarks.filter(m=>m.t>=start&&m.surface===surface),resources:performance.getEntriesByType('resource').filter(e=>e.startTime>=start&&(['/owner/view','/worker.js','/quickjs.wasm'].some(part=>e.name.includes(part)))).map(e=>({path:new URL(e.name).pathname,start:e.startTime-start,duration:e.duration,transfer:e.transferSize,body:e.encodedBodySize}))}),{start,surface});
   const attached=evidence.marks.find(m=>m.phase==='frame-attached'),ready=evidence.marks.find(m=>m.phase==='frame-ready');
   assert.ok(attached&&ready,label+' lifecycle observed');
   await p.frameLocator('#'+surface+' iframe').locator('#tap').click();await p.frameLocator('#'+surface+' iframe').getByText('Clicked',{exact:true}).waitFor();
   results.push({width,label,toAttachedMs:attached.t-start,toReadyMs:ready.t-start,engineAndBridgeMs:ready.t-attached.t,resources:evidence.resources});
  };
  let start=await p.evaluate(()=>performance.now());await p.locator('#loginform button').click();await collect('login-feed',start,'feed');
  for(let i=0;i<3;i++){
   start=await p.evaluate(()=>performance.now());await p.getByRole('button',{name:'Element öffnen',exact:true}).click();await collect('overlay-'+i,start,'overlay');
   start=await p.evaluate(()=>performance.now());await p.getByRole('button',{name:'Element schliessen',exact:true}).click();await collect('feed-return-'+i,start,'feed');
  }
  await context.close();
 }
 console.log(JSON.stringify({kind:'synthetic-loopback-startup-profile',notes:['Times include Playwright click dispatch; not a real-user latency SLA.','Frame-ready marks first DOM application, not all asynchronous database work.','Parent Resource Timing does not include WASM requests owned by Worker.','No network emulation; mobile viewport is not mobile CPU/network.'],results},null,2));
}finally{await browser?.close();if(app){app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r));}fs.rmSync(dir,{recursive:true,force:true});}
