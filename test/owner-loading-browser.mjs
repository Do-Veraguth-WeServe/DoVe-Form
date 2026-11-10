import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const bundle=await build({entryPoints:[path.join(root,'src/owner-live-view.js')],bundle:true,write:false,format:'esm',platform:'browser'});
const server=http.createServer((req,res)=>{
 if(req.url==='/view.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].contents);}
 if(req.url==='/worker.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(root,'dist/worker.js')));}
 if(req.url==='/quickjs.wasm'){return setTimeout(()=>{res.setHeader('Content-Type','application/wasm');res.end(fs.readFileSync(path.join(root,'dist/quickjs.wasm')));},1800);}
 res.setHeader('Content-Type','text/html');res.end(`<body><script type="module">
 import {ownerLiveView} from '/view.js';
 window.mount=(loop=false)=>{
 window.view?.destroy();document.body.replaceChildren();
 let render={html:'<button id="go">Add</button><p id="out">Ready</p>',css:'',js:loop?'while(true){}':'ui.on("go","click",()=>ui.text("out","42"));',state:{}};
 let observer;const subscriptions={subscribe(id,o){observer=o;return {destroy(){},changed(){},ready(){}}},reconnect(){}};
 window.view=ownerLiveView({id:'synthetic',render,getRender:()=>render,adopt:r=>render=r,subscriptions,callbacks:{onState(){},onSuggest(){}}});
 document.body.append(window.view.element);
 window.apply=()=>observer.apply({render,dbRevision:0,stateRevision:'state',codeRevision:'code'});
 };
 </script>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 for(const width of [1280,390]){
  const p=await browser.newPage({viewport:{width,height:800}});
  await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>window.mount);
  await p.evaluate(()=>window.mount());
  assert.equal(await p.getByText('Element wird geladen …',{exact:true}).isVisible(),true);
  await p.evaluate(()=>window.apply());
  await p.waitForSelector('iframe',{state:'attached'});
  assert.equal(await p.getByText('Element wird geladen …',{exact:true}).isVisible(),true,'loading notice survives canonical response and hidden engine startup');
  await p.screenshot({path:'docs/screenshots/owner-loading-'+width+'.png'});
  await p.waitForFunction(()=>document.querySelector('iframe')?.dataset.ready==='true');
  await p.waitForFunction(()=>!document.body.textContent.includes('Element wird geladen …'));
  await p.frameLocator('iframe').locator('#go').click();
  assert.equal(await p.frameLocator('iframe').locator('#out').textContent(),'42');
  await p.evaluate(()=>{window.mount(true);window.apply();});
  await p.getByText('Erneut verbinden',{exact:true}).waitFor();
  assert.equal(await p.getByText('Element wird geladen …',{exact:true}).count(),0);
  assert.equal(await p.locator('iframe').count(),0);
  await p.evaluate(()=>{window.mount();window.apply();window.view.destroy();});
  await p.waitForTimeout(2100);
  assert.equal(await p.locator('iframe').getAttribute('data-ready'),null);
  await p.close();console.log('PASS owner loading '+width+': initial/engine notice, ready interaction, runaway failure, teardown');
 }
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
