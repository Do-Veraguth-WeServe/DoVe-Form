import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {chromium} from 'playwright-core';import {Store} from '../store.mjs';import {Forms} from '../forms.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-checklist-stability-')),BASE='http://127.0.0.1:4778';let app,browser;
const s=new Store(dir),a=s.createUser('alice','password123'),b=s.createUser('bobby','password123'),forms=new Forms(s),conv=s.createConversation(a.id),mid=s.appendMessage(conv.id,'assistant',{prose:'Checklist fixture'});
const payload={items:[{layout:'list',title:'Test checklist',items:[{label:'First'},{label:'Second'}]},{layout:'custom',template:{version:1,html:'<p>Custom</p>',css:'',js:'',state:{}},data:{n:2}},{layout:'note',title:'Immutable note',text:'Original'}]};s.db.prepare('UPDATE messages SET forms=? WHERE id=?').run(JSON.stringify(payload),mid);
const stored=()=>JSON.parse(s.db.prepare('SELECT forms FROM messages WHERE id=?').get(mid).forms);
if(!process.env.REPRO_BASELINE){
 forms.updateCardState(a.id,mid,0,{checked:[true,false]});assert.deepEqual(stored().items[0].data,{checked:[true,false]});
 for(const state of [{checked:[true]}, {checked:[true,1]},{checked:[false,false],text:'overwrite'},[],null,{checked:'bad'}])assert.throws(()=>forms.updateCardState(a.id,mid,0,state));
 assert.throws(()=>forms.updateCardState(b.id,mid,0,{checked:[false,false]}));assert.throws(()=>forms.updateCardState(a.id,mid,3,{}));assert.throws(()=>forms.updateCardState(a.id,mid,2,{}));assert.equal(stored().items[2].text,'Original');
 forms.updateCardState(a.id,mid,1,{n:37});assert.deepEqual(stored().items[1].data,{n:37});assert.throws(()=>forms.updateCardState(a.id,mid,1,{x:'x'.repeat(4097)}));forms.updateCardState(a.id,mid,0,{checked:[false,false]});
} s.close();
try{
 app=spawn('node',['server.mjs'],{cwd:process.env.FORM_TEST_ROOT||process.cwd(),env:{...process.env,PORT:'4778',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const errors=[];
 const p=await browser.newPage({viewport:{width:1280,height:900}});p.on('pageerror',e=>errors.push(e.message));await p.goto(BASE);await p.locator('#loginform [name=username]').fill('alice');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#login[open]').waitFor({state:'detached'});
 const boxes=p.locator('#feed .form-list input[type=checkbox]');await boxes.first().waitFor();
 let release,held=false,writes=0;
 await p.route('**/api/forms/state',async route=>{writes++;held=true;await new Promise(r=>release=r);await route.continue();});
 await boxes.first().focus();await boxes.first().check();
 while(!held)await new Promise(r=>setTimeout(r,10));
 assert.equal(await boxes.evaluateAll(es=>es.some(e=>e.disabled)),false,'saving one checkbox must not disable/blink the whole list');
 assert.equal(await boxes.first().evaluate(e=>e===document.activeElement),true,'focus survives pending save');
 await boxes.nth(1).click();
 assert.equal(await boxes.nth(1).isChecked(),false,'pending save rejects concurrent toggle without losing state');
 assert.equal(writes,1,'no overlapping writes');
 const saved=p.waitForResponse(r=>r.url().endsWith('/api/forms/state')&&r.status()===200);release();await saved;
 await p.unroute('**/api/forms/state');
 await p.waitForFunction(()=>!document.querySelector('#feed .form-list').hasAttribute('aria-busy'));
await p.waitForFunction(()=>!document.querySelector('#feed .form-list').hasAttribute('aria-busy'));await p.reload();await boxes.first().waitFor();assert.equal(await boxes.first().isChecked(),true,'checked state must survive reload');assert.equal(await boxes.nth(1).isChecked(),false);
 await p.screenshot({path:'docs/screenshots/checklist-stability-desktop.png'});await p.setViewportSize({width:390,height:844});const mobileSaved=p.waitForResponse(r=>r.url().endsWith('/api/forms/state')&&r.status()===200);await boxes.nth(1).check();await mobileSaved;await p.waitForFunction(()=>!document.querySelector('#feed .form-list').hasAttribute('aria-busy'));await p.reload();await boxes.first().waitFor();assert.equal(await boxes.first().isChecked(),true);assert.equal(await boxes.nth(1).isChecked(),true);await p.screenshot({path:'docs/screenshots/checklist-stability-mobile.png'});
 await p.route('**/api/forms/state',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Rejected test write'})}));const rejected=p.waitForResponse(r=>r.url().endsWith('/api/forms/state')&&r.status()===400);await boxes.first().click();await rejected;await p.waitForFunction(()=>!document.querySelector('#feed .form-list').hasAttribute('aria-busy'));assert.equal(await boxes.first().isChecked(),true,'failed write rolls UI back');await p.unroute('**/api/forms/state');
 const unauthorized=await p.evaluate(async({mid})=>{const boot=await(await fetch('/api/bootstrap')).json();const r=await fetch('/api/forms/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messageId:mid,index:0,state:{checked:[false,false]}})});return r.status;},{mid});assert.equal(unauthorized,403);
 const q=await browser.newPage();await q.goto(BASE);await q.locator('#loginform [name=username]').fill('bobby');await q.locator('#loginform [name=password]').fill('password123');await q.locator('#loginform button').click();await q.locator('#login[open]').waitFor({state:'detached'});assert.equal(await q.evaluate(async({mid})=>{const boot=await(await fetch('/api/bootstrap')).json();return(await fetch('/api/forms/state',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':boot.csrf},body:JSON.stringify({messageId:mid,index:0,state:{checked:[false,false]}})})).status;},{mid}),400);
 await p.reload();await boxes.first().waitFor();assert.equal(await boxes.first().isChecked(),true);assert.equal(await boxes.nth(1).isChecked(),true);assert.deepEqual(errors,[]);console.log('PASS checklist stable enabled appearance/focus, in-flight guard, desktop/mobile/reload, failed-write rollback, shape limits, custom state compatibility, CSRF and cross-account mutation rejection.');
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit');}fs.rmSync(dir,{recursive:true,force:true});}
