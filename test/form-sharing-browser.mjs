import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {chromium} from 'playwright-core';import {Store} from '../store.mjs';import {Forms} from '../forms.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-sharing-browser-')),BASE='http://127.0.0.1:4766';let app,browser;
const store=new Store(dir),a=store.createUser('alice','password123'),b=store.createUser('bobby','password123'),c=store.createUser('carol','password123'),forms=new Forms(store),conv=store.createConversation(a.id);
const render={version:1,name:'Copy counter',html:'<p id="n"></p>',css:'',js:'ui.text("n",state.n)',state:{n:4}};
const mid=store.appendMessage(conv.id,'assistant',{render});const f=forms.save(a.id,{name:'Copy counter',layout:'custom',instructions:'For counters',sourceMessageId:mid});
const card=store.appendMessage(conv.id,'assistant',{prose:'A persisted custom Form'});store.db.prepare('UPDATE messages SET forms=? WHERE id=?').run(JSON.stringify({items:[{formId:f.id,layout:'custom',template:render,data:{n:37}}]}),card);const checklist=forms.save(a.id,{name:'Shared checklist',layout:'list',instructions:'Fixture'});const listmid=store.appendMessage(conv.id,'assistant',{prose:'Checklist copy fixture'});store.db.prepare('UPDATE messages SET forms=? WHERE id=?').run(JSON.stringify({items:[{formId:checklist.id,layout:'list',title:'Shared checklist',text:'Copied text',items:[{label:'One'},{label:'Two'}],data:{checked:[true,false]}}]}),listmid);store.close();
const api=async(p,url,body)=>p.evaluate(async({url,body})=>{const boot=await(await fetch('/api/bootstrap')).json();const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':boot.csrf},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};},{url,body});
try{
 app=spawn('node',['server.mjs'],{cwd:process.env.FORM_TEST_ROOT||process.cwd(),env:{...process.env,PORT:'4766',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const errors=[];
 async function login(name){const p=await browser.newPage({viewport:{width:1280,height:900}});p.on('pageerror',e=>errors.push(e.message));await p.goto(BASE);await p.locator('#loginform [name=username]').fill(name);await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#login[open]').waitFor({state:'detached'});return p;}
 const pa=await login('alice'),pb=await login('bobby'),pc=await login('carol');
 assert.equal((await fetch(BASE+'/api/forms/copies')).status,401);
 assert.equal(await pa.evaluate(async()=> (await fetch('/api/forms/copies/offer',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status),403);
 await pa.locator('#formsbtn').click();pa.once('dialog',d=>d.accept('bobby'));await pa.locator('.library-row').filter({hasText:'Copy counter'}).getByRole('button',{name:'Teilen',exact:true}).click();await pa.locator('.copy-offer').waitFor();
 let offers=(await api(pb,'/api/forms/copies')).data.offers;assert.equal(offers.length,1);const id=offers[0].id;
 assert.deepEqual((await api(pc,'/api/forms/copies')).data.offers,[]);assert.equal((await api(pc,'/api/forms/copies/accept',{id})).status,400);assert.equal((await api(pc,'/api/forms/copies/close',{id})).status,400);assert.equal((await api(pb,'/api/forms/copies/offer',{id:f.id,revision:1,recipient:'carol'})).status,400);
 await pb.locator('#formsbtn').click();await pb.getByRole('button',{name:'Kopie annehmen'}).waitFor();await pb.screenshot({path:'docs/screenshots/form-copy-desktop.png'});await pb.setViewportSize({width:390,height:844});assert.ok(await pb.locator('#formsdialog').evaluate(e=>e.scrollWidth<=e.clientWidth+2));await pb.locator('.copy-offer').scrollIntoViewIfNeeded();await pb.screenshot({path:'docs/screenshots/form-copy-mobile.png'});await pb.getByRole('button',{name:'Kopie annehmen'}).click();await pb.locator('.copy-offer').waitFor({state:'detached'});
 let copies=(await api(pb,'/api/forms')).data.forms.filter(x=>x.name==='Copy counter');assert.equal(copies.length,1);assert.equal(copies[0].enabled,false);assert.equal(copies[0].template.state.n,4);assert.equal((await api(pb,'/api/forms/copies/accept',{id})).data.id,copies[0].id);
 assert.equal((await api(pa,'/api/forms/save',{...copies[0],name:'Forbidden'})).status,400);
 await pa.locator('#formsclose').click();assert.equal(await pa.getByRole('button',{name:'Form-Zustand kopieren'}).count(),0,'chat state-copy control removed');
 const revoked=(await api(pa,'/api/forms/copies/offer',{id:f.id,revision:1,recipient:'bobby'})).data.id;assert.ok(revoked);assert.equal((await api(pa,'/api/forms/copies/close',{id:revoked})).status,200);assert.equal((await api(pb,'/api/forms/copies/accept',{id:revoked})).status,400);
 await pb.reload();await pb.locator('#mobile').click();await pb.locator('#formsbtn').click();await pb.locator('.library-row').filter({hasText:'Copy counter · deaktiviert'}).first().waitFor();assert.equal(await pb.locator('.library-row').filter({hasText:'Copy counter · deaktiviert'}).count(),1);
 await pb.locator('#formsclose').click();
 await pa.locator('#formsbtn').click();pa.once('dialog',d=>d.accept('bobby'));await pa.locator('.library-row').filter({hasText:'Shared checklist'}).getByRole('button',{name:'Teilen',exact:true}).click();await pa.locator('#formsclose').click();
 await pb.locator('#formsbtn').click();await pb.getByRole('button',{name:'Kopie annehmen'}).click();
 await pb.locator('.copy-offer').filter({hasText:'Shared checklist'}).waitFor({state:'detached'});
 assert.equal(await pb.getByRole('button',{name:'Kopie annehmen'}).count(),0);
 await pb.locator('.library-row').filter({hasText:'Shared checklist · deaktiviert'}).first().waitFor();
 await pb.setViewportSize({width:1280,height:900});await pb.locator('#formsclose').click();
 assert.equal(await pa.locator('#feed .form-list input').nth(1).isChecked(),false);
 // Element template copies use a new message identity and a fresh database namespace.
 for(let attempt=0;attempt<3&&!(await pa.locator('#overlay[open]').count());attempt++){await pa.getByRole('button',{name:'Element öffnen',exact:true}).first().click();await pa.waitForTimeout(400);}
 const copyButton=pa.getByRole('button',{name:'Element-Vorlage kopieren',exact:true});
 if(process.env.REPRO_ELEMENT_BASELINE==='1'){assert.equal(await copyButton.count(),0);console.log('BASELINE: no Element template copy control in previous deployment');}
 else {
 await copyButton.waitFor().catch(async e=>{throw e;});assert.equal(await pa.evaluate(async()=> (await fetch('/api/forms/copies/element',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status),403);pa.once('dialog',d=>d.accept('bobby'));await copyButton.click();
 await pb.locator('#formsbtn').click();await pb.getByRole('button',{name:'Kopie annehmen'}).waitFor();
 const elementOffer=(await api(pb,'/api/forms/copies')).data.offers.find(o=>o.status==='pending'&&o.kind==='element');assert.ok(elementOffer);
 assert.equal((await api(pc,'/api/forms/copies/accept',{id:elementOffer.id})).status,400);
 const sourceDb={sessionId:conv.id,elementId:mid,table:'private_rows'};
 assert.equal((await api(pa,'/api/db',{...sourceDb,op:'create'})).status,200);
 assert.equal((await api(pa,'/api/db',{...sourceDb,op:'insert',row:{value:'owner-only'}})).status,200);
 await pb.getByRole('button',{name:'Kopie annehmen'}).click();await pb.locator('#formsdialog').waitFor({state:'hidden'});
 await pb.locator('#feed iframe').first().waitFor();await pb.waitForFunction(()=>document.querySelector('#feed iframe'));
 const accepted=(await api(pb,'/api/forms/copies')).data.offers.find(o=>o.id===elementOffer.id);assert.equal(accepted.status,'accepted');
 const check=new Store(dir),copyOwner=check.messageOwner(accepted.copyId);assert.equal(copyOwner.userId,b.id);assert.equal(check.getRender(accepted.copyId).state.n,4);check.close();
 const targetDb={sessionId:copyOwner.conversationId,elementId:accepted.copyId,table:'private_rows'};
 assert.equal((await api(pb,'/api/db',{...sourceDb,op:'select'})).status,403);
 assert.equal((await api(pc,'/api/db',{...targetDb,op:'select'})).status,403);
 assert.equal((await api(pb,'/api/db',{...targetDb,op:'select'})).status,404);
 assert.equal((await api(pb,'/api/db',{...targetDb,op:'create'})).status,200);
 assert.equal((await api(pb,'/api/db',{...targetDb,op:'insert',row:{value:'copy-only'}})).status,200);
 const ownerRows=(await api(pa,'/api/db',{...sourceDb,op:'select'})).data.rows;assert.equal(ownerRows.length,1);assert.equal(ownerRows[0].value,'owner-only');
 assert.equal((await api(pb,'/api/state',{messageId:accepted.copyId,state:{n:7}})).status,200);
 assert.equal((await api(pa,'/api/state',{messageId:accepted.copyId,state:{n:90}})).status,403);
 await pb.reload();await pb.frameLocator('#feed iframe').first().locator('#n').waitFor();assert.equal(await pb.frameLocator('#feed iframe').first().locator('#n').textContent(),'7');
 await pb.getByRole('button',{name:'Element öffnen',exact:true}).first().click();await pb.getByRole('button',{name:'Code bearbeiten',exact:true}).waitFor();
 await pb.frameLocator('#overlay iframe').locator('#n').waitFor();await pb.waitForFunction(()=>document.querySelector('#overlay iframe'));assert.equal(await pb.frameLocator('#overlay iframe').locator('#n').textContent(),'7');await pb.screenshot({path:'docs/screenshots/element-copy-desktop.png'});await pb.setViewportSize({width:390,height:844});await pb.screenshot({path:'docs/screenshots/element-copy-mobile.png'});
 console.log('PASS Element copy: actual UI acceptance; independent state/reload; empty DB, owner/copy writes isolated, third-party denied; editable desktop/mobile.');
 }
 assert.deepEqual(errors,[]);console.log('PASS: opt-in library sharing via Teilen; chat state-copy control removed; desktop/mobile; CSRF/auth; three-account ACL; revoked offer rejected; recipient-owned disabled copies.');
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit');}fs.rmSync(dir,{recursive:true,force:true});}
