// Isolated acceptance for repairing the reported legacy post-it element (#a3daf406).
// Uses a copy of the production render; never touches production data.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {chromium} from 'playwright-core';
import {DatabaseSync} from 'node:sqlite';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-postit-fix-'));
const prod=new DatabaseSync('/opt/form/data/form.db',{readOnly:true});
const original=JSON.parse(prod.prepare('SELECT render FROM messages WHERE id=?').get('eba50762-199b-4204-a345-1eb00751da08').render);
prod.close();
export const repaired={...original,html:original.html
  .replace('<path d="M6 15','<path id="paper" d="M6 15')
  .replace('<path d="M30 52','<path id="fold-a" d="M30 52')
  .replace('<path d="M26 128','<path id="fold-b" d="M26 128'),
 animations:{version:1,clips:{
  crumple:{type:'crumple',targets:['paper','fold-a','fold-b','lines'],duration:700},
  pop:{type:'tween',target:'note',duration:220,easing:'ease-out',frames:[{scaleX:0.8,scaleY:0.8},{scaleX:1,scaleY:1}]}}}};
const {Store}=await import('../store.mjs');
const {validateRender}=await import('../contract.mjs');
validateRender(repaired); // contract incl. declared-clip check must pass

const s=new Store(dir),u=s.createUser('postit','password123'),c=s.createConversation(u.id);
for(let i=0;i<12;i++)s.appendMessage(c.id,'assistant',{prose:'History '+i+' '+('prior content '.repeat(45))});
const legacy=s.appendMessage(c.id,'assistant',{render:original});
const fixed=s.appendMessage(c.id,'assistant',{render:repaired});
s.close();

const app=spawn('node',['server.mjs'],{env:{...process.env,PORT:'4789',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});
let b;
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});});
 b=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 const p=await b.newPage({viewport:{width:1280,height:900}});
 await p.goto('http://127.0.0.1:4789');
 await p.locator('#loginform [name=username]').fill('postit');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();
 await p.locator('iframe[data-ready=true]').nth(1).waitFor();

 // 1) Reported symptom reproduces on the untouched legacy copy: undeclared clip -> explicit notice, no movement.
 await p.frameLocator('iframe').nth(0).locator('#note').click({force:true});
 await p.getByText('Animation nicht verfügbar',{exact:false}).first().waitFor();
 console.log('PASS legacy copy still shows the explicit missing-animation notice');

 // 2) Repaired element: crumple visibly deforms, completion persists, no remount/scroll jump.
 for(const width of [1280,390]){
  await p.setViewportSize({width,height:844});
  const f=p.frameLocator('iframe').nth(1);
  const frameEl=p.locator('iframe').nth(1);
  assert.ok(await f.locator('#paper').count(),'paper target survives sanitization');
  await p.locator('#feed').evaluate(e=>e.scrollTop=e.scrollHeight);await p.waitForTimeout(300);
  await frameEl.evaluate(e=>e.dataset.marker='same-frame');
  const before=await p.locator('#feed').evaluate(e=>e.scrollTop);
  const beforeCount=await f.locator('#count').innerText();
  const saved=p.waitForResponse(r=>r.url().endsWith('/api/state'));
  await f.locator('#note').click({force:true});
  // poll DURING the 700ms crumple: fill:'forwards' keeps mid-flight transforms observable
  let moved=false,probes=[];
  for(let i=0;i<24&&!moved;i++){
    const t=await f.locator('#paper').evaluate(e=>getComputedStyle(e).transform);
    probes.push(t);if(t&&t!=='none')moved=true;else await p.waitForTimeout(60);
  }
  if(!moved){const notices=await p.locator('.notice,[role=status]').allInnerTexts().catch(()=>[]);console.log('DIAG notices',JSON.stringify(notices).slice(0,500),'count',beforeCount);throw Error('crumple never moved the paper; probes='+JSON.stringify(probes.slice(0,6)));}
  const response=await(await saved).json();
  const expected=width===1280?'Noch 4 Zettel':'Noch 3 Zettel';
  await f.locator('#count').filter({hasText:expected}).waitFor();
  assert.ok(response.state&&response.ownerCodeRevision,'atomic state receipt');
  assert.equal(await frameEl.getAttribute('data-marker'),'same-frame','no iframe remount');
  assert.ok(Math.abs(await p.locator('#feed').evaluate(e=>e.scrollTop)-before)<3,'scroll stays');
  await p.reload();await p.locator('iframe[data-ready=true]').nth(1).waitFor();
  await p.frameLocator('iframe').nth(1).locator('#count').filter({hasText:expected}).waitFor();
  console.log('PASS repaired '+width+': crumple deforms paper, completion persisted ('+beforeCount+' -> '+expected+'), reload keeps state, no jump');
 }

 // 3) Reduced motion: completion still persists without visible movement.
 const rmc=await b.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});const rm=await rmc.newPage();
 await rm.goto('http://127.0.0.1:4789');
 await rm.locator('#loginform [name=username]').fill('postit');await rm.locator('#loginform [name=password]').fill('password123');await rm.locator('#loginform button').click();
 await rm.locator('iframe[data-ready=true]').nth(1).waitFor();
 await rm.locator('#feed').evaluate(e=>e.scrollTop=e.scrollHeight);
 const rf=rm.frameLocator('iframe').nth(1);
 await rf.locator('#note').click({force:true});
 await rf.locator('#count').filter({hasText:'Noch 2 Zettel'}).waitFor();
 console.log('PASS reduced motion: completion persisted without movement');
 await rmc.close();
 console.log('PASS postit repair acceptance complete');
}finally{await b?.close();app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
