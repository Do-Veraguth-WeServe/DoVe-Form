// Optional report replay reads only one artifact; never copies user rows, credentials or actions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {Store} from '../store.mjs';
import {ElementDB} from '../db.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-db-lifecycle-'));
let app,browser;
try {
 let render={version:1,name:'Database lifecycle fixture',html:'<input id="ort"><div id="list"></div>',css:'',state:{},js:
 'ui.db.create("places",["name"],function(){ui.db.select("places",{},function(r){if(r.ok)ui.html("list",r.rows.map(function(x){return "<p>"+x.name+"</p>";}).join(""));});});ui.on("ort","input",function(e){state.draft=e.value;ui.persist();});ui.every(1000,function(){});'};
 if(process.env.FORM_REPLAY_REPORT){
  const original=new DatabaseSync('/opt/form/data/form.db',{readOnly:true});
  try {const row=original.prepare('SELECT m.render FROM messages m JOIN bug_reports b ON b.conversation_id=m.conversation_id JOIN conversations c ON c.id=m.conversation_id AND c.user_id=b.user_id WHERE b.id=? AND m.render IS NOT NULL ORDER BY m.seq DESC LIMIT 1').get(process.env.FORM_REPLAY_REPORT);assert.ok(row,'report artifact exists');render=JSON.parse(row.render);}finally{original.close();}
 }
 const artifactHash=crypto.createHash('sha256').update(JSON.stringify(render)).digest('hex');
 const store=new Store(dir),user=store.createUser('lifecycle','password123'),conversation=store.createConversation(user.id);
 const mid=store.appendMessage(conversation.id,'assistant',{render});const adjacent=store.appendMessage(conversation.id,'assistant',{prose:'Independent message'});store.close();
 const db=new ElementDB(path.join(dir,'elements.sqlite'));const base={sessionId:conversation.id,elementId:mid,table:'places'};
 assert.equal(db.op({...base,op:'create',columns:['name','lat','lon','temp','code','wind','hum','tmax','tmin','fetched']}).status,200);
 assert.equal(db.op({...base,op:'insert',row:{name:'Synthetic Town',lat:0,lon:0,temp:12,code:0,wind:2,hum:50,tmax:14,tmin:8,fetched:'12:00'}}).status,200);db.close();
 app=spawn('node',['server.mjs'],{cwd:process.env.FORM_TEST_ROOT||process.cwd(),env:{...process.env,PORT:'4781',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup deadline')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(timer);resolve();}});});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[],requests=[];
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(/\/api\/(element-actions|connections|mcp|tools|jobs)/.test(url.pathname)&&route.request().method()!=='GET')return route.abort();if(url.origin!=='http://127.0.0.1:4781'&&!['data:','blob:'].includes(url.protocol))return route.abort();return route.continue();});
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')requests.push({path:new URL(r.url()).pathname,body:r.postDataJSON()});});
  await page.addInitScript(()=>{const Native=window.EventSource;window.EventSource=class extends Native{constructor(...args){super(...args);if(String(args[0]).includes('/api/jobs/stream'))window.fixtureStream=this;}};window.lifecycle={added:0,removed:0};new MutationObserver(records=>{for(const r of records)for(const type of ['added','removed'])for(const n of r[type+'Nodes'])if(n.nodeType===1)window.lifecycle[type]+=(n.matches?.('iframe.render')?1:0)+(n.querySelectorAll?.('iframe.render').length||0);}).observe(document,{childList:true,subtree:true});});
  await page.goto('http://127.0.0.1:4781');await page.locator('#loginform [name=username]').fill('lifecycle');await page.locator('#loginform [name=password]').fill('password123');await page.locator('#loginform button').click();await page.locator('#login[open]').waitFor({state:'detached'});if(await page.locator('.session-open[aria-current=true]').locator('..').getAttribute('data-sid')!==conversation.id){if(width===390)await page.locator('#mobile').click();await page.locator('[data-sid="'+conversation.id+'"] .session-open').click();}
  const loaded=async()=>{await page.locator('#feed iframe[data-ready=true]').waitFor();await page.frameLocator('#feed iframe').locator('#list').filter({hasText:'Synthetic Town'}).waitFor({timeout:10000}).catch(async e=>{console.log(JSON.stringify({requestPaths:requests.map(r=>({path:r.path,op:r.body?.op})),errorCount:errors.length,noticeCount:await page.locator('.notice.error').count()}));throw e;});};
  await loaded();await page.waitForTimeout(2300);assert.deepEqual(await page.evaluate(()=>window.lifecycle),{added:1,removed:0});
  const frame=await page.locator('#feed iframe').elementHandle();
  const save=page.waitForResponse(r=>r.url().endsWith('/api/state')&&r.request().method()==='POST');await page.frameLocator('#feed iframe').locator('#ort').fill('local fixture draft');assert.equal((await save).status(),200);
  await page.evaluate(job=>window.fixtureStream.dispatchEvent(new MessageEvent('snapshot',{data:JSON.stringify({jobs:[job]})})),{id:'lifecycle-job',conversationId:conversation.id,messageId:adjacent,kind:'chat',state:'failed',rev:1,error:'Fixture failure'});
  await page.waitForTimeout(200);assert.equal(await frame.evaluate(e=>e.isConnected),true);assert.equal(await page.frameLocator('#feed iframe').locator('#ort').inputValue(),'local fixture draft');
  await page.mouse.wheel(0,500);await page.mouse.wheel(0,-500);await page.waitForTimeout(250);assert.equal(await frame.evaluate(e=>e.isConnected),true);assert.deepEqual(await page.evaluate(()=>window.lifecycle),{added:1,removed:0});
  await page.reload();await loaded();await page.waitForTimeout(2300);assert.deepEqual(await page.evaluate(()=>window.lifecycle),{added:1,removed:0},'reload starts once even with DB create conflict and async select');
  if(width===390)await page.locator('#mobile').click();await page.locator('#new').click();await page.locator('#feed iframe').waitFor({state:'detached'});
  if(width===390)await page.locator('#mobile').click();await page.locator('[data-sid="'+conversation.id+'"] .session-open').click();await loaded();await page.waitForTimeout(2300);assert.deepEqual(await page.evaluate(()=>window.lifecycle),{added:2,removed:1},'session return creates one replacement context, not repeated remounts');
  assert.deepEqual(errors,[]);assert.equal(requests.filter(r=>/action|connection|tool/.test(r.path)).length,0,'no external action executed');
  const ops=requests.filter(r=>r.path==='/api/db').map(r=>r.body.op);assert.ok(ops.includes('select'),'real isolated database select used');assert.ok(ops.every(op=>['create','select'].includes(op)),'no row mutation from startup');
  if(!process.env.FORM_REPLAY_REPORT)await page.screenshot({path:'docs/screenshots/db-lifecycle-'+width+'.png'});
  await page.close();
 }
 console.log(JSON.stringify({result:'PASS',mode:process.env.FORM_REPLAY_REPORT?'read-only original artifact, synthetic rows':'synthetic',artifactHash,checks:['desktop/mobile','one initialization','real DB create-conflict/select','local persist and unrelated update retain frame/draft','scroll','browser reload','session leave/return','no actions or row mutations','no browser errors']}));
} finally {await browser?.close();if(app&&app.exitCode===null){app.kill();await new Promise(r=>app.once('exit',r));}fs.rmSync(dir,{recursive:true,force:true});}
