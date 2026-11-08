import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-dynamic-html-')),base='http://127.0.0.1:4830';
const store=new Store(dir),user=store.createUser('htmlowner','password123'),conv=store.createConversation(user.id);
const render={"version":1,"name":"Dynamic sanitizer fixture","html":"<button id=\"inject\">Insert</button><div id=\"dynamicContent\"></div><svg id=\"graphic\"></svg><table><tbody id=\"gridRows\"></tbody></table>","css":"","js":"ui.html(\"graphic\",'<circle cx=\"5\" cy=\"5\" r=\"4\"/>');ui.html(\"gridRows\",'<tr><td>Safe cell</td></tr>');ui.on(\"inject\",\"click\",()=>{ui.html(\"dynamicContent\",'<h2 id=\"title\">Dynamic heading</h2><button id=\"ok\">Safe button</button>');});","state":{}};
const mid=store.appendMessage(conv.id,'assistant',{render});
const bundle=await build({stdin:{contents:"import {inspectHTML,inspectFragment,safeHTML,safeFragment} from './src/sanitize.js';window.inspectHTML=inspectHTML;window.inspectFragment=inspectFragment;window.safeHTML=safeHTML;window.safeFragment=safeFragment;",resolveDir:root},bundle:true,write:false,format:'iife',platform:'browser'});
let app,browser;
try{
 app=spawn(process.execPath,['server.mjs'],{cwd:process.env.FORM_TEST_APP_ROOT||root,env:{...process.env,PORT:'4830',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});app.once('exit',c=>{clearTimeout(t);reject(Error('early exit '+c))})});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 const unit=await browser.newPage();await unit.setContent('<main></main>');await unit.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await unit.evaluate(()=>{
  const cases=['<p id="safe">ok</p>','<h2 id="title">private text</h2>','<div onclick="private()">x</div>','<img src="https://invalid.example/private">','<input type="file">','<svg><circle cx="2" r="1"/></svg>','<table><tbody><tr><td>one</td></tr></tbody></table>','<span title="url(private)">x</span>'];
  return {cases:cases.map(s=>{const d=inspectHTML(s);return {...d,same:d.html===safeHTML(s)}}),bounded:inspectHTML('<div onclick="private()">x</div>'.repeat(40)),fresh:inspectHTML('<p>ok</p>'),fragment:safeFragment('<circle cx="2" r="1"/>').svg};
 });
 assert.ok(result.cases.every(c=>c.same));assert.equal(result.cases[0].removedCount,0);assert.ok(result.cases[1].diagnostics.some(d=>d.reason==='id-removed'));assert.ok(!result.cases[1].html.includes('id='));assert.ok(result.cases[2].removedCount>0);assert.ok(result.cases[3].removedCount>0);assert.match(result.cases[4].html,/type="text"/);assert.equal(result.cases[5].removedCount,0);assert.equal(result.cases[6].removedCount,0);assert.ok(result.cases[7].diagnostics.some(d=>d.reason==='unsafe-attribute-value'));assert.equal(result.bounded.diagnostics.length,16);assert.equal(result.bounded.removedCount,40);assert.equal(result.bounded.truncated,true);assert.equal(result.fresh.removedCount,0);assert.match(result.fragment,/<circle/);
 assert.ok(!JSON.stringify(result.cases.map(({html,...d})=>d)).includes('private'));
 const fragments=await unit.evaluate(()=>({svg:inspectFragment('<circle cx="5" r="4"/>'),table:inspectFragment('<tr><td>Safe</td></tr>'),bad:inspectFragment('<circle id="title" onclick="private()"/>'),many:inspectFragment('<span onclick="private()">x</span>'.repeat(40)),fresh:inspectFragment('<p>Safe</p>')}));
 assert.equal(fragments.svg.warnings.svg.removed,false);assert.equal(fragments.table.warnings.section.removed,false);assert.equal(fragments.bad.warnings.svg.idRemoved,true);assert.equal(fragments.many.warnings.html.removed,true);assert.equal(fragments.fresh.warnings.html.removed,false);assert.ok(!JSON.stringify(Object.values(fragments).map(x=>x.warnings)).includes('private'));
 await unit.close();
 console.log('PASS HTML diagnostic reasons, redaction, cap, no stale DOMPurify state, SVG/table/input/scrub compatibility');
 for(const width of [1280,390]){
  const ctx=await browser.newContext({viewport:{width,height:844}}),p=await ctx.newPage(),errors=[],external=[];
  p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().startsWith('http')&&!r.url().startsWith(base+'/'))external.push(r.url())});
  await p.goto(base);await p.locator('#loginform [name=username]').fill('htmlowner');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').last().click();await p.locator('#login[open]').waitFor({state:'detached'});
  const frame=p.frameLocator('#feed iframe.render');await frame.locator('#gridRows td').waitFor();assert.equal(await frame.locator('#graphic circle').count(),1);
  assert.equal(await p.locator('#feed .notice').filter({hasText:'Darstellung eingeschränkt'}).count(),0,'safe SVG and table fragments must not warn');
  await p.evaluate(()=>window.postMessage({type:'html-warning',idRemoved:true},'*'));
  assert.equal(await p.locator('#feed .notice').filter({hasText:'Darstellung eingeschränkt'}).count(),0,'forged public messages must not warn');
  await frame.locator('#inject').click();await frame.locator('#ok').waitFor();await p.locator('#feed .notice').filter({hasText:'Eine Element-ID wurde entfernt'}).waitFor();assert.equal(await frame.locator('#title').count(),0);
  await p.locator('#feed').screenshot({path:'docs/screenshots/dynamic-html-'+width+'.png'});
  await p.getByRole('button',{name:'Element öffnen',exact:true}).click();await p.frameLocator('#overlay iframe.render').locator('#inject').click();await p.locator('#overlay .notice').filter({hasText:'Eine Element-ID wurde entfernt'}).waitFor();await p.getByRole('button',{name:'Element schliessen',exact:true}).click();
  await p.reload();await p.frameLocator('#feed iframe.render').locator('#gridRows td').waitFor();assert.equal(await p.locator('#feed .notice').filter({hasText:'Darstellung eingeschränkt'}).count(),0);assert.deepEqual(store.getRender(mid),render);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS '+width+' dynamic trusted feed/overlay warning, namespace-correct SVG/table, forged public event ignored, reload reset, unchanged artifact, zero egress/page errors');await ctx.close();
 }
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit')}store.close();fs.rmSync(dir,{recursive:true,force:true});}
