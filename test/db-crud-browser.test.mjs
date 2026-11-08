// Legacy browser section 6g migrated to a synthetic persisted artifact.
// Real authenticated /api/db + QuickJS, no model, external service or production DB.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {pathToFileURL} from 'node:url';import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-db-crud-')),base='http://127.0.0.1:4830';
const store=new Store(dir),user=store.createUser('crudowner','password123');
const render={version:1,name:'Synthetic CRUD',html:'<input id="draft"><button id="add">Add</button><button id="toggle">Toggle first</button><button id="erase">Delete first</button><button id="large">Oversize</button><button id="drop">Drop</button><p id="msg"></p><div id="rows"></div>',css:'',state:{},js:
 'var rows=[],draft="";function load(){ui.db.select("items",{},r=>{if(!r.ok){ui.text("msg",r.error);return}rows=r.rows;ui.text("rows",rows.map(x=>x.name+(x.done?" ✓":"")).join(" / "));ui.text("msg","loaded "+rows.length)})}ui.db.create("items",["name","done"],()=>load());ui.on("draft","input",e=>{draft=e.value});ui.on("add","click",()=>ui.db.insert("items",{name:draft,done:false},r=>{if(r.ok)load();else ui.text("msg",r.error)}));ui.on("toggle","click",()=>ui.db.update("items",rows[0].id,{done:true},r=>{if(r.ok)load()}));ui.on("erase","click",()=>ui.db.delete("items",rows[0].id,r=>{if(r.ok)load()}));ui.on("large","click",()=>ui.db.insert("items",{name:"x".repeat(17000),done:false},r=>ui.text("msg",r.ok?"unexpected":r.error)));ui.on("drop","click",()=>ui.db.drop("items",r=>ui.text("msg",r.ok?"dropped":r.error)));'};
const scoped={version:1,name:'Independent element',html:'<p id="scope"></p>',css:'',state:{},js:'ui.db.select("items",{},r=>ui.text("scope",r.ok?"unexpected access":r.error));'};
let app,browser;
try{
 app=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4830',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});app.once('exit',c=>{clearTimeout(t);reject(Error('early exit '+c))})});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]){
  const conv=store.createConversation(user.id),mid=store.appendMessage(conv.id,'assistant',{render});store.appendMessage(conv.id,'assistant',{render:scoped});
  const ctx=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}),p=await ctx.newPage(),errors=[],external=[],ops=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url()===base+'/api/db')ops.push(r.postDataJSON());});
  await p.route('**/*',route=>{const u=route.request().url();if(u.startsWith('http')&&!u.startsWith(base+'/')){external.push(u);return route.abort()}return route.continue()});
  await p.goto(base);await p.locator('#loginform [name=username]').fill('crudowner');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#login[open]').waitFor({state:'detached'});
  const f=()=>p.frameLocator('#feed iframe.render').nth(0),g=()=>p.frameLocator('#feed iframe.render').nth(1);
  await f().locator('#msg').filter({hasText:'loaded 0'}).waitFor();await g().locator('#scope').filter({hasText:'Tabelle nicht gefunden.'}).waitFor();
  await f().locator('#draft').fill('Milch');await f().locator('#add').click();await f().locator('#msg').filter({hasText:'loaded 1'}).waitFor();await f().locator('#rows').filter({hasText:'Milch'}).waitFor();
  await f().locator('#draft').fill('Brot');await f().locator('#add').click();await f().locator('#msg').filter({hasText:'loaded 2'}).waitFor();assert.equal(await f().locator('#rows').innerText(),'Milch / Brot');
  await f().locator('#toggle').click();await f().locator('#rows').filter({hasText:'Milch ✓ / Brot'}).waitFor();
  await f().locator('#erase').click();await f().locator('#msg').filter({hasText:'loaded 1'}).waitFor();assert.equal(await f().locator('#rows').innerText(),'Brot');
  await p.reload();await f().locator('#msg').filter({hasText:'loaded 1'}).waitFor();assert.equal(await f().locator('#rows').innerText(),'Brot');await g().locator('#scope').filter({hasText:'Tabelle nicht gefunden.'}).waitFor();
  await f().locator('#large').click();await f().locator('#msg').filter({hasText:'Zeile zu gross'}).waitFor();assert.equal(await f().locator('#rows').innerText(),'Brot');
  await p.reload();await f().locator('#msg').filter({hasText:'loaded 1'}).waitFor();assert.equal(await f().locator('#rows').innerText(),'Brot','quota rejection has no persisted insert');
  await f().locator('#drop').click();await f().locator('#msg').filter({hasText:'dropped'}).waitFor();
  await p.reload();await f().locator('#msg').filter({hasText:'loaded 0'}).waitFor();assert.equal(await f().locator('#rows').innerText(),'');await g().locator('#scope').filter({hasText:'Tabelle nicht gefunden.'}).waitFor();
  assert.deepEqual(store.getRender(mid),render);assert.ok(['create','select','insert','update','delete','drop'].every(op=>ops.some(o=>o.op===op)));
  assert.ok(ops.every(o=>o.sessionId===conv.id));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS '+width+': real CRUD bridge, sibling isolation, row quota with unchanged reload, drop/recreate, unchanged artifact and no egress/errors');await ctx.close();
 }
 console.log('PASS database CRUD browser source='+root);
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit')}store.close();fs.rmSync(dir,{recursive:true,force:true});}
