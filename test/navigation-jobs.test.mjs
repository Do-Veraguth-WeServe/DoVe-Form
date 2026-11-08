import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {chromium} from 'playwright-core';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-activity-')),BASE='http://127.0.0.1:4756',id=crypto.randomUUID();let next,finish,calls=0,fail=false;
const mock=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const plan=JSON.parse(raw).messages[0].content.includes('fast conversational planner');calls++;if(fail){res.writeHead(400);res.end('fixture failure');return;}res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();const put=t=>res.write('data: '+JSON.stringify({choices:[{delta:{content:t}}]})+'\n\n');await new Promise(r=>{next=r;res.on('close',r)});if(res.destroyed)return;put(plan?'<reply>Eine **Antwort** wächst. ':'Eine **Antwort** wächst. ');await new Promise(r=>{finish=r;res.on('close',r)});if(res.destroyed)return;put(plan?'Fertig.</reply><title>Testplan</title><summary>Test.</summary><ready>true</ready>':'Fertig.');res.end('data: [DONE]\n\n');});
await new Promise(r=>mock.listen(4757,'127.0.0.1',r));fs.writeFileSync(path.join(dir,'models.json'),JSON.stringify({models:[{id,label:'Fixture',model:'mock',baseUrl:'http://127.0.0.1:4757/v1',apiKey:'fixture'}]}),{mode:0o600});let app,browser;
try{app=spawn('node',['server.mjs'],{cwd:process.env.FORM_TEST_ROOT||process.cwd(),env:{...process.env,PORT:'4756',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}})});
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});const p=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(BASE);await p.locator('#switchreg').click();for(const [k,v] of Object.entries({username:'activity',password:'password123',password2:'password123'}))await p.locator('#regform [name='+k+']').fill(v);await p.locator('#regform button').last().click();await p.locator('#login[open]').waitFor({state:'detached'});

 const cancel=[];p.on('request',r=>{if(r.url().endsWith('/api/jobs/cancel'))cancel.push(r.url())});
 for(const mode of ['chat','plan']){
 await p.locator('#new').click();
 await p.locator('#prompt').fill('Navigation '+mode);await p.locator(mode==='plan'?'#planbtn':'#send').click();await p.locator('.activity[data-phase=thinking]').waitFor();
 const origin=await p.locator('.session-open[aria-current=true]').locator('..').getAttribute('data-sid');
 await p.locator('#new').click();await p.waitForTimeout(200);
 assert.equal(cancel.length,0,'navigation must not cancel server job');
 assert.equal(await p.locator('.activity').count(),0,'foreign thinking stays out of new chat');
 const destination=await p.locator('.session-open[aria-current=true]').locator('..').getAttribute('data-sid');assert.notEqual(origin,destination);
 next();await p.waitForTimeout(150);assert.equal(await p.locator('.prose').count(),0,'foreign prose stays out of new chat');
 await p.locator('[data-sid="'+origin+'"] .session-open').click();await p.locator('.activity[data-phase=writing]').waitFor();assert.equal(await p.locator('.activity').count(),1);
 await p.locator('[data-sid="'+destination+'"] .session-open').click();finish();await p.waitForTimeout(500);
 assert.equal(await p.locator('.session-open[aria-current=true]').locator('..').getAttribute('data-sid'),destination,'completion must not navigate back');
 await p.locator('[data-sid="'+origin+'"] .session-open').click();await p.locator('.prose').filter({hasText:'Fertig.'}).waitFor();assert.equal(await p.locator('.activity').count(),0);
 await p.reload();await p.locator('[data-sid="'+origin+'"] .session-open').click();await p.locator('.prose').filter({hasText:'Fertig.'}).waitFor();
 assert.equal(calls,mode==='chat'?1:2,'navigation/reload must not regenerate');
 }
 assert.deepEqual(errors,[]);console.log('PASS navigation chat/plan/new/existing/reload: no cancellation, no foreign live content, completion preserves selection, one provider call');
}finally{next?.();finish?.();await browser?.close();if(app){app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r))}mock.closeAllConnections();await new Promise(r=>mock.close(r));fs.rmSync(dir,{recursive:true,force:true});}
