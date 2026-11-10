import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {chromium} from 'playwright-core';import {Store} from '../store.mjs';import {ElementSharing,elementCodeRevision} from '../element-sharing.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-owner-save-')),BASE='http://127.0.0.1:4777';let app,browser;
const s=new Store(dir),a=s.createUser('alice','password123'),b=s.createUser('bobby','password123'),conv=s.createConversation(a.id);
const render={version:1,name:'Owner CAS',html:'<p id="n"></p><button id="inc">Increment</button>',css:'',js:'ui.text("n",state.n);ui.on("inc","click",()=>{state.n++;ui.text("n",state.n);ui.persist(state);});',state:{n:0}};
const mid=s.appendMessage(conv.id,'assistant',{render}),g=new ElementSharing(s,null),offer=g.offer(a.id,{messageId:mid,revision:elementCodeRevision(render),recipient:'bobby'});g.accept(b.id,offer.id);
const state=()=>s.getRender(mid).state.n;
try{
 app=spawn('node',['server.mjs'],{cwd:process.env.FORM_TEST_ROOT||process.cwd(),env:{...process.env,PORT:'4777',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const p=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));if(process.env.REPRO_BASELINE==='1')await p.route('**/app.js',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync('/opt/form/dist/app.js')}));await p.goto(BASE);await p.locator('#loginform [name=username]').fill('alice');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#login[open]').waitFor({state:'detached'});
 const frame=()=>p.frameLocator('#feed iframe').first();
 for(const width of [1280,390]){
 await p.setViewportSize({width,height:844});await p.reload();await frame().locator('#inc').waitFor();
 for(const overlay of [false,true]){
 if(overlay)await p.getByRole('button',{name:'Element öffnen',exact:true}).click();
 const target=()=>p.frameLocator(overlay?'#overlay iframe':'#feed iframe').first();
 await target().locator('#n').waitFor();const before=state();const view=g.view(b.id,offer.id);g.state(b.id,offer.id,{state:{n:before+10},expectedRevision:view.stateRevision});
 if(process.env.FORM_OWNER_STALE_REPRO==='1'){
 await new Promise(r=>setTimeout(r,2500));assert.equal(state(),before+10);assert.equal(await target().locator('#n').textContent(),String(before),'reproduce stale mounted owner view');console.log('REPRODUCED stale owner '+(overlay?'overlay':'feed')+' width='+width);await p.screenshot({path:'docs/screenshots/owner-stale-'+width+'-'+(overlay?'overlay':'feed')+'.png'});
 }else{await target().locator('#n').filter({hasText:new RegExp('^'+(before+10)+'$')}).waitFor({timeout:6000});const saved=p.waitForResponse(r=>r.url().endsWith('/api/state'));await target().locator('#inc').click();assert.equal((await saved).status(),200);assert.equal(state(),before+11);}
 if(overlay)await p.getByRole('button',{name:'Element schliessen',exact:true}).click();else await p.reload();
 }
 }
 assert.deepEqual(errors,[]);
 console.log(process.env.FORM_OWNER_STALE_REPRO==='1'?'Baseline reproduced only; NOT fixed':'PASS owner state sync and fresh owner write desktop/mobile feed/overlay');
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit');}s.close();fs.rmSync(dir,{recursive:true,force:true});}
