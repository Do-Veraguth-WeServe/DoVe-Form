import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';import {chromium} from 'playwright-core';import {Store} from '../store.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-sidebar-'));const store=new Store(dir);const user=store.createUser('layout','password123');
for(let i=1;i<=36;i++){const c=store.createConversation(user.id,'Chat '+String(i).padStart(2,'0'));const m=store.appendMessage(c.id,'assistant',{prose:'Layout fixture',render:{version:1,name:'Element '+String(i).padStart(2,'0'),html:'<p>Fixture</p>',css:'',js:'',state:{}}});store.setPinned(user.id,m,true);}store.close();
const BASE='http://127.0.0.1:4696';const server=spawn('node',['server.mjs'],{env:{...process.env,PORT:'4696',FORM3_ORIGIN:BASE,FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});let browser;
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),15000);server.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});server.on('exit',reject)});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const p=await browser.newPage();await p.goto(BASE);await p.locator('#loginform [name=username]').fill('layout');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#sessions .session-open').nth(35).waitFor({state:'attached'});
 const reports=[];
 for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:390,height:568}]){
  await p.setViewportSize(viewport);if(viewport.width<761&&!await p.locator('#sidebar').evaluate(e=>e.classList.contains('open')))await p.locator('#mobile').click();
  for(const tab of ['chats','elements']){
   await p.locator('#'+tab+'-tab').click();const selector=tab==='chats'?'#sessions':'#elements-list';
   const r=await p.locator(selector).evaluate(e=>{const rows=[...e.querySelectorAll(e.id==='sessions'?'.session-open':'button')];return {count:rows.length,height:e.clientHeight,scrollHeight:e.scrollHeight,minRow:Math.min(...rows.map(b=>b.getBoundingClientRect().height)),bottom:e.getBoundingClientRect().bottom,footerTop:document.querySelector('.sidebottom').getBoundingClientRect().top};});
   await p.locator(selector).evaluate(e=>{e.scrollTop=0});await p.locator(selector).hover();await p.mouse.wheel(0,2000);await p.waitForTimeout(100);r.wheelScroll=await p.locator(selector).evaluate(e=>e.scrollTop);r.viewport=viewport;r.tab=tab;reports.push(r);
   if(!process.env.EXPECT_LAYOUT_BUG){assert.ok(r.minRow>=40,JSON.stringify(r));assert.ok(r.height>0&&r.scrollHeight>r.height,JSON.stringify(r));assert.ok(r.wheelScroll>0,JSON.stringify(r));assert.ok(r.bottom<=r.footerTop+1,JSON.stringify(r));}
  }
  const shots='docs/screenshots';fs.mkdirSync(shots,{recursive:true});await p.screenshot({path:shots+'/sidebar-'+viewport.width+'x'+viewport.height+(process.env.EXPECT_LAYOUT_BUG?'-before':'-after')+'.png'});
 }
 console.log(JSON.stringify(reports));if(process.env.EXPECT_LAYOUT_BUG)assert.ok(reports.some(r=>r.minRow<40||r.scrollHeight<=r.height||r.wheelScroll===0),'baseline should reproduce');else console.log('PASS sidebar rows retain size; chat and element lists wheel-scroll on desktop and mobile');
}finally{await browser?.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
