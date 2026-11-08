import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-html-diagnostics-')),base='http://127.0.0.1:4829';
const store=new Store(dir),user=store.createUser('htmlowner','password123'),conv=store.createConversation(user.id);
const render={version:1,name:'Sanitizer fixture',html:'<h2 id="title">Synthetic heading</h2><p id="safe">Safe remainder</p><button id="increment">Increment</button><span id="count">0</span>',css:'',js:'let n=0;ui.on("increment","click",()=>{n++;ui.text("count",String(n));});',state:{}};
const mid=store.appendMessage(conv.id,'assistant',{render});
const bundle=await build({stdin:{contents:"import {inspectHTML,safeHTML,safeFragment} from './src/sanitize.js';window.inspectHTML=inspectHTML;window.safeHTML=safeHTML;window.safeFragment=safeFragment;",resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser'});
let app,browser;
try{
 app=spawn(process.execPath,['server.mjs'],{cwd:process.env.FORM_TEST_APP_ROOT||root,env:{...process.env,PORT:'4829',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});app.once('exit',c=>{clearTimeout(t);reject(Error('early exit '+c))})});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 const unit=await browser.newPage();await unit.setContent('<main></main>');await unit.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await unit.evaluate(()=>{
  const cases=['<p id="safe">ok</p>','<h2 id="title">private text</h2>','<div onclick="private()">x</div>','<img src="https://invalid.example/private">','<input type="file">','<svg><circle cx="2" r="1"/></svg>','<table><tbody><tr><td>one</td></tr></tbody></table>','<span title="url(private)">x</span>'];
  return {cases:cases.map(s=>{const d=inspectHTML(s);return {...d,same:d.html===safeHTML(s)}}),bounded:inspectHTML('<div onclick="private()">x</div>'.repeat(40)),fresh:inspectHTML('<p>ok</p>'),fragment:safeFragment('<circle cx="2" r="1"/>').svg};
 });
 assert.ok(result.cases.every(c=>c.same));assert.equal(result.cases[0].removedCount,0);assert.ok(result.cases[1].diagnostics.some(d=>d.reason==='id-removed'));assert.ok(!result.cases[1].html.includes('id='));assert.ok(result.cases[2].removedCount>0);assert.ok(result.cases[3].removedCount>0);assert.match(result.cases[4].html,/type="text"/);assert.equal(result.cases[5].removedCount,0);assert.equal(result.cases[6].removedCount,0);assert.ok(result.cases[7].diagnostics.some(d=>d.reason==='unsafe-attribute-value'));assert.equal(result.bounded.diagnostics.length,16);assert.equal(result.bounded.removedCount,40);assert.equal(result.bounded.truncated,true);assert.equal(result.fresh.removedCount,0);assert.match(result.fragment,/<circle/);
 assert.ok(!JSON.stringify(result.cases.map(({html,...d})=>d)).includes('private'));await unit.close();
 console.log('PASS HTML diagnostic reasons, redaction, cap, no stale DOMPurify state, SVG/table/input/scrub compatibility');
 for(const width of [1280,390]){
  const ctx=await browser.newContext({viewport:{width,height:844}}),p=await ctx.newPage(),errors=[],external=[];
  p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith(base+'/'))external.push(r.url())});
  await p.goto(base);await p.locator('#loginform [name=username]').fill('htmlowner');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').last().click();await p.locator('#login[open]').waitFor({state:'detached'});
  const frame=p.frameLocator('#feed iframe.render');await frame.locator('#safe').waitFor();await p.locator('#feed .notice').filter({hasText:'Eine Element-ID wurde entfernt'}).waitFor();assert.equal(await frame.locator('#title').count(),0);
  await frame.locator('#increment').click();await frame.locator('#count').filter({hasText:'1'}).waitFor();
  await p.locator('#feed').screenshot({path:'docs/screenshots/html-diagnostics-'+width+'.png'});
  await p.getByRole('button',{name:'Element öffnen',exact:true}).click();await p.locator('#overlay .notice').filter({hasText:'Eine Element-ID wurde entfernt'}).waitFor();await p.getByRole('button',{name:'Element schliessen',exact:true}).click();
  await p.reload();await p.locator('#feed .notice').filter({hasText:'Eine Element-ID wurde entfernt'}).waitFor();assert.deepEqual(store.getRender(mid),render);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS '+width+' trusted feed/overlay/reload warning, working allowed interaction, unchanged artifact, zero egress/page errors');await ctx.close();
 }
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit')}store.close();fs.rmSync(dir,{recursive:true,force:true});}
