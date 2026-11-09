import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {chromium} from 'playwright-core';import {Store} from '../store.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-dialogs-'));const s=new Store(dir);s.createUser('dialoguser','password123');s.close();let app,browser;
try{
 app=spawn('node',['server.mjs'],{cwd:process.env.FORM_TEST_ROOT||process.cwd(),env:{...process.env,PORT:'4776',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}})});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 const p=await browser.newPage();const errors=[],native=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',async d=>{native.push(d.message());await d.dismiss()});
 await p.goto('http://127.0.0.1:4776');await p.locator('#loginform [name=username]').fill('dialoguser');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#login[open]').waitFor({state:'detached'});
 for(const width of [1280,390]){
 await p.setViewportSize({width,height:844});if(width===390)await p.locator('#mobile').click();await p.locator('#preferencesbtn').click();await p.locator('#memorybtn').click();await p.locator('#memoryadd [name=content]').fill('Synthetic reminder '+width);await p.locator('#memoryadd button').click();const del=p.locator('#memorylist').getByRole('button',{name:'Löschen',exact:true});await del.waitFor();await del.click();
 if(process.env.FORM_DIALOG_BASELINE==='1'){assert.equal(native.length,1);assert.equal(await p.locator('.app-question').count(),0);console.log('REPRODUCED: memory delete opens native browser confirmation');break;}
 const q=p.locator('dialog.app-question');await q.waitFor();assert.equal(await q.locator('p').textContent(),'Erinnerung löschen?');assert.equal(await q.getByRole('button',{name:'Abbrechen'}).evaluate(e=>e===document.activeElement),true);assert.ok(await q.evaluate(e=>e.scrollWidth<=e.clientWidth+2));
 await q.screenshot({path:'docs/screenshots/dialog-memory-'+width+'.png'});await p.keyboard.press('Enter');await q.waitFor({state:'detached'});assert.equal(await del.count(),1);assert.equal(await p.locator('#preferences').isVisible(),true);assert.equal(await del.evaluate(e=>e===document.activeElement),true);
 await del.click();await q.waitFor();await p.keyboard.press('Escape');await q.waitFor({state:'detached'});assert.equal(await del.count(),1);assert.equal(await p.locator('#preferences').isVisible(),true);
 await del.click();await q.getByRole('button',{name:'Bestätigen'}).click();await del.waitFor({state:'detached'});await p.locator('#preferencesclose').click();
 }
 if(!process.env.FORM_DIALOG_BASELINE){assert.deepEqual(native,[]);assert.deepEqual(errors,[]);console.log('PASS actual memory deletion: desktop/mobile app modal, cancel/Enter-safe-default/Escape no mutation, focus restored, parent preserved, explicit confirmation deletes, no native dialogs');}
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill();await once(app,'exit')}fs.rmSync(dir,{recursive:true,force:true})}
