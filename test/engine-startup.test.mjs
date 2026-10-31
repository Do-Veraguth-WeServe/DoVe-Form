import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['src/renderer.js'],bundle:true,write:false,format:'esm',platform:'browser'});
let render={html:'<button id="go">Add</button><p id="out"></p>',css:'',js:'ui.on("go","click",()=>ui.text("out","42"));',state:{}};
if(process.env.FORM_RENDER_DB){const db=new DatabaseSync(process.env.FORM_RENDER_DB,{readOnly:true});render=JSON.parse(db.prepare('SELECT render FROM messages WHERE id=(SELECT message_id FROM jobs ORDER BY created_at DESC LIMIT 1)').get().render);db.close();}
const server=http.createServer((req,res)=>{
 if(req.url==='/renderer.js'){res.setHeader('Content-Type','text/javascript');return res.end(bundle.outputFiles[0].contents)}
 if(req.url==='/worker.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync('dist/worker.js'))}
 if(req.url==='/quickjs.wasm'){return setTimeout(()=>{res.setHeader('Content-Type','application/wasm');res.end(fs.readFileSync('dist/quickjs.wasm'))},4500)}
 res.setHeader('Content-Type','text/html');res.end('<body><script type="module">import {renderUI} from "/renderer.js";window.mount=(data)=>{window.errors=[];window.view?.destroy();document.body.innerHTML="";window.view=renderUI(data,{onState:()=>{},onSuggest:()=>{},onError:e=>window.errors.push(e)});document.body.append(window.view.element)};</script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 const p=await browser.newPage();await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>window.mount);
 await p.evaluate(r=>window.mount(r),render);await p.waitForTimeout(6000);
 assert.deepEqual(await p.evaluate(()=>window.errors),[]);
 const f=p.frameLocator('iframe');
 if(process.env.FORM_RENDER_DB){for(const id of ['c','b7','add','b8','eq'])await f.locator('#'+id).click();await p.waitForTimeout(200);assert.equal(await f.locator('#out').textContent(),'15');}
 else{await f.locator('#go').click();await p.waitForTimeout(200);assert.equal(await f.locator('#out').textContent(),'42');}
 console.log('PASS delayed engine startup and actual interaction');
 await p.evaluate(()=>window.mount({html:'<p>loop</p>',css:'',state:{},js:'while(true){}'}));
 await p.waitForFunction(()=>window.errors.length>0,null,{timeout:12000});console.log('PASS runaway guest still stopped');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
