// Isolated actual Worker/opaque-frame fixture: no user stores or provider calls.
import {build} from 'esbuild';import {chromium} from 'playwright-core';
import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const bundle=await build({entryPoints:[path.join(root,'src/renderer.js')],bundle:true,write:false,format:'esm',platform:'browser'});
let wasmRequests=0,failWorker=false;
const server=http.createServer((req,res)=>{
 if(req.url==='/renderer.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].contents);}
 if(req.url==='/worker.js'){res.setHeader('Content-Type','text/javascript');if(failWorker){res.statusCode=500;return res.end('');}return res.end(fs.readFileSync(path.join(root,'dist/worker.js')));}
 if(req.url==='/quickjs.wasm'){wasmRequests++;res.setHeader('Content-Type','application/wasm');return res.end(fs.readFileSync(path.join(root,'dist/quickjs.wasm')));}
 res.setHeader('Content-Type','text/html');res.end(
 `<script type="module">import {renderUI} from "/renderer.js";window.mount=(revision="A")=>{window.view?.destroy();document.body.replaceChildren();window.saves=0;window.errors=[];window.view=renderUI({html:'<button id="tap">Ready</button>',css:"",js:'ui.text("tap",state.revision);ui.persist();ui.on("tap","click",()=>ui.text("tap","Clicked '+revision+'"));',state:{revision}},{onState(){window.saves++},onError(e){window.errors.push(e)}});};window.attach=()=>document.body.append(window.view.element);</script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]){
 const p=await browser.newPage({viewport:{width,height:800}});await p.addInitScript(()=>{const Native=Worker;window.engineRecords=[];window.Worker=class extends Native{constructor(...a){super(...a);this.record={inits:0,terminated:0};window.engineRecords.push(this.record);}postMessage(d,...a){if(d.type==='init')this.record.inits++;return super.postMessage(d,...a);}terminate(){this.record.terminated++;return super.terminate();}};});await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>window.mount);

 await p.evaluate(()=>{window.mount('A');window.attach();});
 await p.waitForFunction(()=>window.engineRecords.length===2&&document.querySelector('iframe')?.dataset.ready==='true');
 assert.deepEqual(await p.evaluate(()=>window.engineRecords.map(w=>w.inits)),[1,0]);
 // Actual wall-clock expiry; no mocked timers.
 await p.waitForFunction(()=>window.engineRecords[1].terminated===1,{},{timeout:18000});
 assert.equal(await p.evaluate(()=>window.engineRecords[0].terminated),0);
 await p.frameLocator('iframe').locator('#tap').click();
 await p.frameLocator('iframe').getByText('Clicked A',{exact:true}).waitFor();
 await p.evaluate(()=>{window.mount('B');window.attach();});
 await p.waitForFunction(()=>window.engineRecords.length===4&&document.querySelector('iframe')?.dataset.ready==='true');
 await p.frameLocator('iframe').getByText('B',{exact:true}).waitFor();
 await p.frameLocator('iframe').locator('#tap').click();
 await p.frameLocator('iframe').getByText('Clicked B',{exact:true}).waitFor();
 assert.deepEqual(await p.evaluate(()=>window.engineRecords.map(w=>w.inits)),[1,0,1,0]);
 assert.equal(await p.evaluate(()=>window.saves),1,'new code/state initialize once after expiry');
 // Synthetic lifecycle dispatch, not physical-device suspension certification.
 await p.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
 assert.equal(await p.evaluate(()=>window.engineRecords[3].terminated),1);
 assert.equal(await p.evaluate(()=>window.engineRecords[2].terminated),0);
 await p.evaluate(()=>{window.mount('C');window.attach();});
 await p.waitForFunction(()=>window.engineRecords.length===6&&document.querySelector('iframe')?.dataset.ready==='true');
 await p.frameLocator('iframe').getByText('C',{exact:true}).waitFor();
 assert.deepEqual(await p.evaluate(()=>window.engineRecords.map(w=>w.inits)),[1,0,1,0,1,0]);
 // Consume a good spare, fail only its speculative successor.
 failWorker=true;
 await p.evaluate(()=>{window.mount('D');window.attach();});
 await p.waitForFunction(()=>window.engineRecords.length===7&&window.engineRecords[6].terminated===1);
 assert.equal(await p.evaluate(()=>window.errors.length),0,'failed spare must not invalidate active guest');
 await p.frameLocator('iframe').getByText('D',{exact:true}).waitFor();
 await p.frameLocator('iframe').locator('#tap').click();
 await p.frameLocator('iframe').getByText('Clicked D',{exact:true}).waitFor();
 failWorker=false;
 await p.evaluate(()=>{window.mount('E');window.attach();});
 await p.waitForFunction(()=>window.engineRecords.length===9&&document.querySelector('iframe')?.dataset.ready==='true');
 await p.frameLocator('iframe').getByText('E',{exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>window.saves),1);
 assert.deepEqual(await p.evaluate(()=>window.engineRecords.map(w=>w.inits)),[1,0,1,0,1,1,0,1,0]);
 await p.evaluate(()=>window.view.destroy());await p.close();
 console.log('PASS lifecycle '+width+': real15s expiry, active survives, pagehide disposal, fresh code/state/callbacks, speculative failure recovery');

 }
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
