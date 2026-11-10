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
 `<script type="module">import {renderUI} from "/renderer.js";window.mount=()=>{window.view?.destroy();document.body.replaceChildren();window.saves=0;window.errors=[];window.view=renderUI({html:'<button id="tap">Ready</button>',css:"",js:'ui.persist();ui.on("tap","click",()=>ui.text("tap","Clicked"));',state:{}},{onState(){window.saves++},onError(e){window.errors.push(e)}});};window.attach=()=>document.body.append(window.view.element);</script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]){
 const p=await browser.newPage({viewport:{width,height:800}});await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>window.mount);
 const before=wasmRequests;await p.evaluate(()=>window.mount());
 await p.waitForTimeout(600);assert.ok(wasmRequests>before,'WASM loads while iframe is still detached');
 assert.equal(await p.evaluate(()=>window.saves),0,'guest does not execute before handshake');
 await p.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'ready',channel:'forged'},origin:'null',source:window})));
 await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>window.saves),0,'forged public readiness cannot execute guest');
 await p.evaluate(()=>window.attach());await p.waitForFunction(()=>document.querySelector('iframe')?.dataset.ready==='true');
 assert.equal(await p.evaluate(()=>window.saves),1);await p.frameLocator('iframe').locator('#tap').click();await p.frameLocator('iframe').getByText('Clicked',{exact:true}).waitFor();
 await p.evaluate(()=>{window.mount();window.view.destroy();window.attach();});await p.waitForTimeout(700);
 assert.equal(await p.evaluate(()=>window.saves),0,'destroy before handshake prevents guest execution');assert.equal(await p.locator('iframe').getAttribute('data-ready'),null);
 failWorker=true;await p.evaluate(()=>window.mount());await p.waitForFunction(()=>window.errors.length===1);await p.evaluate(()=>window.attach());await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>window.saves),0,'early Worker failure fails closed');failWorker=false;
 await p.evaluate(()=>window.view.destroy());await p.close();console.log('PASS preload '+width+': detached WASM, no early guest, forged ready, one init, interaction, teardown, early failure');
 }
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
