// Legacy6c through chat, plan and explicit build approval.
// Synthetic accounts/local mock only, no production data or provider spend.
import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {pathToFileURL} from 'node:url';import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-refine-browser-')),base='http://127.0.0.1:4831';
const store=new Store(dir),user=store.createUser('editorowner','password123');
const initial={version:1,name:'Editor fixture',html:'<h2 id="fixture-heading">Original</h2><p id="value"></p>',css:'h2{color:#d4ef8b}',js:'ui.text("value",String(state.n));',state:{n:7}};
let app,browser,release,arrived,builds=0,plans=0,chats=0;
const replacement={...initial,html:'<h2 id="fixture-heading">Refined</h2><p id="value"></p>',css:'h2{color:#7fd4ef}'};
const mock=http.createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const system=JSON.parse(raw).messages[0].content;res.writeHead(200,{'Content-Type':'text/event-stream'});res.flushHeaders();let text;
if(system.includes('fast conversational planner')){plans++;text='<reply>Akzent ändern.</reply><title>Akzent</title><summary>Blau färben, Wert erhalten.</summary><questions></questions><ready>true</ready>';}
else if(system.includes('warm, concise conversational')){chats++;text='Änderung planen. '+JSON.stringify({forms:[],planningOffer:{title:'Akzent ändern'}});}
else{builds++;await new Promise(r=>{release=r;arrived?.();res.once('close',r)});if(res.destroyed)return;text=String.fromCharCode(96).repeat(3)+'json'+String.fromCharCode(10)+JSON.stringify(replacement)+String.fromCharCode(10)+String.fromCharCode(96).repeat(3);}
res.end('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+String.fromCharCode(10,10)+'data: [DONE]'+String.fromCharCode(10,10));}catch(e){res.destroy(e)}});
try{
 await new Promise(r=>mock.listen(4832,'127.0.0.1',r));
 fs.writeFileSync(path.join(dir,'models.json'),JSON.stringify({models:[{id:'fixture',label:'Fixture',model:'fixture',baseUrl:'http://127.0.0.1:4832/v1',apiKey:'fixture-only',ownerId:user.id}]}),{mode:0o600});
 app=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4831',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});app.once('exit',c=>{clearTimeout(t);reject(Error('early exit '+c))})});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]){
  const conv=store.createConversation(user.id),mid=store.appendMessage(conv.id,'assistant',{render:initial});
  const ctx=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}),p=await ctx.newPage(),errors=[],external=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith(base+'/'))external.push(r.url())});
  await p.goto(base);await p.locator('#loginform [name=username]').fill('editorowner');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').last().click();await p.locator('#login[open]').waitFor({state:'detached'});

const before={builds,plans,chats},f=()=>p.frameLocator('#feed iframe.render');
await f().locator('#value').filter({hasText:'7'}).waitFor();
await p.getByRole('button',{name:'Element öffnen',exact:true}).click();await p.getByRole('button',{name:'Mit KI bearbeiten',exact:true}).click();await p.locator('#refchip').waitFor();
await p.locator('#prompt').fill('Mache den Akzent blau und erhalte den Wert');await p.locator('#send').click();await p.locator('.planning-offer-start').waitFor();assert.equal(builds,before.builds);assert.deepEqual(store.getRender(mid),initial);
await p.locator('.planning-offer-start').click();await p.locator('.blueprint-execute:not([disabled])').waitFor({state:'attached'});assert.equal(chats,before.chats+1);assert.equal(plans,before.plans+1);assert.equal(builds,before.builds);assert.deepEqual(store.getRender(mid),initial);
const started=new Promise(r=>{arrived=r});if(await p.locator('.blueprint-toggle').getAttribute('aria-expanded')==='false')await p.locator('.blueprint-toggle').click();await p.locator('.blueprint-execute').click();await p.locator('.site[data-jobid]').waitFor();
await Promise.race([started,new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('provider arrival')),10000);t.unref()})]);
const jobs=(await(await ctx.request.get(base+'/api/jobs')).json()).jobs;assert.ok(jobs.some(j=>j.kind==='refine'&&j.targetMessageId===mid&&j.state==='building'));
assert.deepEqual(store.getRender(mid),initial);assert.equal(await p.locator('#feed iframe.render').count(),1);await f().locator('#fixture-heading').filter({hasText:'Original'}).waitFor();release();
await f().locator('#fixture-heading').filter({hasText:'Refined'}).waitFor();await f().locator('#value').filter({hasText:'7'}).waitFor();assert.equal(await f().locator('#fixture-heading').evaluate(el=>getComputedStyle(el).color),'rgb(127, 212, 239)');
assert.deepEqual(store.getRender(mid),replacement);assert.equal(await p.locator('#feed iframe.render').count(),1);assert.equal(store.db.prepare('SELECT count(*) n FROM messages WHERE conversation_id=? AND render IS NOT NULL').get(conv.id).n,1);assert.equal(store.db.prepare('SELECT count(*) n FROM versions WHERE message_id=?').get(mid).n,1);
await p.reload();await f().locator('#fixture-heading').filter({hasText:'Refined'}).waitFor();assert.equal(builds,before.builds+1);
await p.getByRole('button',{name:'Element öffnen',exact:true}).click();await p.getByRole('button',{name:'Versionen',exact:true}).click();assert.equal(await p.locator('.verow').count(),1);await p.getByRole('button',{name:'Wiederherstellen',exact:true}).click();await p.frameLocator('#overlay iframe.render').locator('#fixture-heading').filter({hasText:'Original'}).waitFor();assert.deepEqual(store.getRender(mid),initial);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
console.log('PASS '+width+' chat/plan preserve original; approval, held refinement, same ID, state/color/reload/archive/restore');
 await ctx.close();
 }
}finally{release?.();await browser?.close();if(app&&app.exitCode===null){app.kill();await once(app,"exit")}mock.closeAllConnections();await new Promise(r=>mock.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});}
