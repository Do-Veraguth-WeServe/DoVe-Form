import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {chromium} from 'playwright-core';import {Store} from '../store.mjs';import {ElementDB} from '../db.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-owner-initial-')),BASE='http://127.0.0.1:4778';let app,browser;
const store=new Store(dir),user=store.createUser('alice','password123'),conv=store.createConversation(user.id),db=new ElementDB(path.join(dir,'elements.sqlite'));
const mid=store.appendMessage(conv.id,'assistant',{render:{version:1,name:'Initial DB',html:'<p id="rows"></p>',css:'',js:'ui.db.select("notes",{},r=>ui.text("rows",r.rows.length));',state:{}}});
const op=p=>db.op({sessionId:conv.id,elementId:mid,table:'notes',...p});op({op:'create'});op({op:'insert',row:{text:'first'}});
try{
 app=spawn('node',['server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:'4778',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const context=await browser.newContext(),p=await context.newPage();const errors=[];context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
 let release,seen;const gate=new Promise(r=>release=r),arrived=new Promise(r=>seen=r);let held=false;
 await p.route('**/api/elements/owner/view?*',async route=>{if(held){await route.continue();return;}held=true;const response=await route.fetch();seen();await gate;await route.fulfill({response}).catch(()=>{});});
 await p.goto(BASE);await p.locator('#loginform [name=username]').fill('alice');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();
 try{
 await arrived;assert.equal(await p.locator('#feed iframe').count(),0,'no guest DB reads before canonical baseline');op({op:'insert',row:{text:'during snapshot'}});
 }finally{release();await p.unrouteAll({behavior:'wait'});}
 await p.frameLocator('#feed iframe').first().locator('#rows').filter({hasText:/^2$/}).waitFor({timeout:6000});
 console.log('PASS initial canonical baseline before guest startup, concurrent DB revision reconciled');
 const p2=await context.newPage();await p2.goto(BASE);await p2.locator('#feed iframe[data-ready=true]').waitFor();
 const p3=await context.newPage();await p3.goto(BASE);await p3.getByRole('button',{name:'Erneut verbinden',exact:true}).waitFor();assert.equal(await p3.locator('#feed iframe').count(),0);
 await p2.close();await p3.getByRole('button',{name:'Erneut verbinden',exact:true}).click();await p3.locator('#feed iframe[data-ready=true]').waitFor();
 console.log('PASS two-tab stream budget, third tab fails visibly and reconnects after slot release');
 // Close the second live tab, then invalidate the remaining source.
 await p3.evaluate(()=>dispatchEvent(new Event('offline')));await p3.close();
 store.db.prepare('DELETE FROM messages WHERE id=?').run(mid);
 await p.getByText('Element nicht mehr verfügbar.',{exact:true}).waitFor({timeout:6000});assert.equal(await p.locator('#feed iframe').count(),0);
 console.log('PASS source deletion invalidates live owner surface without stale iframe');
 await p.screenshot({path:'docs/screenshots/owner-deleted-desktop.png'});assert.deepEqual(errors,[]);
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit');}db.close();store.close();fs.rmSync(dir,{recursive:true,force:true});}
