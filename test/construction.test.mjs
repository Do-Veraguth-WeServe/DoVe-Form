import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {offeredPlan} from './planning-fixture.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-construction-'));
const PORT=process.env.CONSTRUCTION_PORT||'4596',MOCK_PORT=process.env.CONSTRUCTION_MOCK_PORT||'4597';
const BASE='http://127.0.0.1:'+PORT, MOCK='http://127.0.0.1:'+MOCK_PORT;
const ready=p=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),15000);p.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});p.on('exit',c=>{clearTimeout(t);reject(Error('early exit '+c))})});
const mock=spawn('node',['test/mock-provider.mjs'],{env:{...process.env,MOCK_PORT},stdio:['ignore','pipe','inherit']});
const server=spawn('node',['server.mjs'],{env:{...process.env,PORT,FORM3_ORIGIN:BASE,FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_REGISTRATION:'1'},stdio:['ignore','pipe','inherit']});
let browser;
try{
 await Promise.all([ready(mock),ready(server)]);
 const chrome=['/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome','/usr/bin/chromium'].find(fs.existsSync);
 browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 const ctx=await browser.newContext({viewport:{width:1280,height:900}}),p=await ctx.newPage();
 await p.goto(BASE);await p.locator('#switchreg').click();await p.locator('#regform [name=username]').fill('construction');await p.locator('#regform [name=password]').fill('password123');await p.locator('#regform [name=password2]').fill('password123');await p.locator('#regform button').last().click();await p.locator('#emptystate').waitFor();
 await p.locator('#preferencesbtn').click();await p.locator('#settingsbtn2').click();for(const [k,v] of Object.entries({label:'Mock',baseUrl:MOCK+'/v1',model:'mock-model',apiKey:'test-key-1234567890'}))await p.locator('#addmodel [name='+k+']').fill(v);await p.locator('#addmodel button').last().click();await p.locator('#emptystate').waitFor({state:'detached'});await p.keyboard.press('Escape');await p.locator('#preferences[open]').waitFor({state:'detached'});
 await p.locator('#prompt').fill('Baue eine to do liste die die listen elemente zerknüllt. Ein post it stapel. siteholda');await offeredPlan(p,dir);await p.locator('.blueprint-execute:not([disabled])').waitFor({state:'attached'});await p.waitForFunction(()=>!document.querySelector('.live'));if(await p.locator('.blueprint-toggle').getAttribute('aria-expanded')==='false')await p.locator('.blueprint-toggle').click();await p.locator('.blueprint-execute').click();await p.locator('.site[data-jobid]').waitFor();assert.equal(await p.locator('.site .crane').count(),1);
 await p.reload();await p.locator('.site[data-jobid]').waitFor();assert.equal(await p.locator('.site .crane').count(),1);assert.equal(await p.locator('.think').count(),0);
 const shots='docs/screenshots';fs.mkdirSync(shots,{recursive:true});
 // clip-based capture: the held site can be re-bound by job re-renders, which
 // makes Playwright's element-screenshot stability wait fail spuriously
 const shotSite=async name=>{for(let i=0;i<3;i++){try{const b=await p.locator('.site').boundingBox();if(!b)break;const vp=p.viewportSize();await p.screenshot({path:shots+'/'+name,clip:{x:Math.max(0,b.x),y:Math.max(0,b.y),width:Math.max(1,Math.min(b.width,vp.width-Math.max(0,b.x))),height:Math.max(1,Math.min(b.height,vp.height-Math.max(0,b.y)))}});return}catch{await new Promise(r=>setTimeout(r,150))}}throw Error('site screenshot failed: '+name)};
 await shotSite('site-reasoning-desktop.png');await p.setViewportSize({width:390,height:844});await shotSite('site-reasoning-mobile.png');
 await p.locator('.site button',{hasText:'Abbrechen'}).click();await p.locator('.site').waitFor({state:'detached'});console.log('PASS construction before content, reload, desktop/mobile, explicit cancel');
}finally{await browser?.close();mock.kill();server.kill();await Promise.all([new Promise(r=>mock.exitCode!==null?r():mock.once('exit',r)),new Promise(r=>server.exitCode!==null?r():server.once('exit',r))]);fs.rmSync(dir,{recursive:true,force:true});}
