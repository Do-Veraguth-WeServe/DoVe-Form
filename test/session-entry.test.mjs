import http from 'node:http';import crypto from 'node:crypto';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';import {chromium} from 'playwright-core';import {Store} from '../store.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-entry-')),store=new Store(dir),user=store.createUser('entry','password123'),ids=[];
for(let j=0;j<2;j++){const c=store.createConversation(user.id,'Entry '+j);ids.push(c.id);for(let i=0;i<10;i++)store.appendMessage(c.id,'assistant',{prose:'Message '+i+' '+('Long history paragraph. '.repeat(80))});store.appendMessage(c.id,'assistant',{prose:'Entry element',render:{version:1,name:'Entry fixture',html:'<div>Isolated entry fixture</div>',css:'div{height:400px}',js:'',state:{}}});}
store.close();let releaseReply=null,calls=0;const mock=http.createServer(async(req,res)=>{for await(const c of req){}res.writeHead(200,{'Content-Type':'text/event-stream'});calls++;await new Promise(resolve=>{releaseReply=resolve;res.once('close',resolve)});if(!res.destroyed)res.end('data: '+JSON.stringify({choices:[{delta:{content:'Fixture response.'}}]})+'\n\ndata: [DONE]\n\n')});await new Promise(r=>mock.listen(4769,'127.0.0.1',r));fs.writeFileSync(path.join(dir,'models.json'),JSON.stringify({models:[{id:crypto.randomUUID(),label:'Fixture',model:'mock',baseUrl:'http://127.0.0.1:4769/v1',apiKey:'fixture'}]}),{mode:0o600});const BASE='http://127.0.0.1:4768';let app,browser;
try{app=spawn('node',['server.mjs'],{cwd:process.env.FORM_TEST_ROOT||process.cwd(),env:{...process.env,PORT:'4768',FORM3_ORIGIN:BASE,FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}})});
browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
for(const width of [1280,390]){const p=await browser.newPage({viewport:{width,height:844}});await p.goto(BASE);await p.locator('#loginform [name=username]').fill('entry');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#feed .message').last().waitFor();
const gap=()=>p.locator('#feed').evaluate(e=>e.scrollHeight-e.clientHeight-e.scrollTop);await p.waitForTimeout(150);console.log('initial',width,await gap());assert.ok(await gap()<2,'login enters at bottom');
// Each viewport ends on a different synthetic conversation, keeping its Element inside the disclosed history window.
for(const id of width===390?[...ids].reverse():ids){if(width===390)await p.locator('#mobile').click();await p.locator('[data-sid="'+id+'"] .session-open').click();assert.ok(await gap()<2,'sidebar entry is immediately bottom, without smooth travel');await p.locator('#feed').evaluate(e=>e.scrollTop=200);await p.waitForTimeout(150);assert.equal(await p.locator('#feed').evaluate(e=>e.scrollTop),200,'user reading is not pinned');}
await p.reload();await p.locator('#feed .message').last().waitFor();await p.waitForTimeout(150);assert.ok(await gap()<2,'reload enters bottom');
await p.locator('#feed iframe[data-ready=true]').waitFor();await p.screenshot({path:'docs/screenshots/session-entry-'+width+'.png'});
// Change only the isolated fixture iframe to exercise late renderer sizing.
await p.locator('#feed iframe').evaluate(e=>e.style.height='1200px');await p.waitForTimeout(80);assert.ok(await gap()<2,'late entry layout stays at end');
await p.locator('#feed').evaluate(e=>e.scrollTop=200);await p.waitForTimeout(50);await p.locator('#feed iframe').evaluate(e=>e.style.height='1400px');await p.waitForTimeout(80);assert.equal(await p.locator('#feed').evaluate(e=>e.scrollTop),200,'manual scroll cancels late sizing follow');
const anchor=()=>p.locator('#feed').evaluate(f=>{const top=f.getBoundingClientRect().top;const el=[...f.querySelectorAll('.message[data-mid]')].find(e=>e.getBoundingClientRect().bottom>top+2);return {mid:el?.dataset.mid,offset:el?.getBoundingClientRect().top-top,scrollTop:f.scrollTop};});
const stable=async(before,stage)=>{const after=await anchor();assert.ok(before.mid,'visible message exists');assert.equal(after.mid,before.mid,stage+' visible message');assert.ok(Math.abs(after.offset-before.offset)<2,stage+' anchor offset '+JSON.stringify({before,after}));assert.ok(Math.abs(after.scrollTop-before.scrollTop)<2,stage+' scrollTop '+JSON.stringify({before,after}));};
for(const bottom of [false,true])for(const method of ['Enter','button']){
 await p.locator('#prompt').fill('Keep viewport '+bottom+' '+method);
 await p.locator('#feed').evaluate((e,b)=>e.scrollTop=b?e.scrollHeight:(e.scrollHeight-e.clientHeight)*0.45,bottom);
 await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const before=await anchor(),priorCalls=calls;releaseReply=null;
 if(method==='button')await p.locator('#send').click();else await p.locator('#prompt').press('Enter');
 const deadline=Date.now()+10000;while(!releaseReply&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
 assert.equal(calls,priorCalls+1,'exactly one held provider request');assert.ok(releaseReply,'provider is held before output');
 await p.locator('.activity').waitFor();await stable(before,width+' '+bottom+' '+method+' held');
 releaseReply();releaseReply=null;
 await p.locator('.activity').waitFor({state:'detached'});
 await p.locator('.message.assistant').last().locator('.prose').filter({hasText:'Fixture response.'}).waitFor();
 await stable(before,width+' '+bottom+' '+method+' completed');
 console.log('PASS scroll anchor',width,bottom?'bottom':'middle',method,'held/completed',JSON.stringify(before));
}

await p.reload();await p.locator('#feed iframe[data-ready=true]').waitFor();await p.waitForTimeout(2200);const settled=await p.locator('#feed').evaluate(e=>e.scrollTop);await p.locator('#feed iframe').evaluate(e=>e.style.height='1500px');await p.waitForTimeout(80);assert.equal(await p.locator('#feed').evaluate(e=>e.scrollTop),settled,'entry settling expires without further forced scroll');await p.close();}
console.log('PASS session entry desktop/mobile/login/sidebar/reload, iframe settling/cancel/deadline, Enter/button middle/bottom submit and completion preservation');
}finally{releaseReply?.();await browser?.close();if(app){app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r))}mock.closeAllConnections();await new Promise(r=>mock.close(r));fs.rmSync(dir,{recursive:true,force:true});}
