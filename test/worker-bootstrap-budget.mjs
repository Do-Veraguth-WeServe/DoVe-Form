// Deterministic cold-bootstrap scheduling delay, no production state or service changes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {verifyAnimationArtifact} from '../animation-verification.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'form-bootstrap-budget-'));
let browser;
try {
 await fs.mkdir(path.join(root,'dist'));
 for(const file of ['worker.js','quickjs.wasm','animation-verification.js'])await fs.copyFile(path.join(process.env.FORM_TEST_ROOT||process.cwd(),'dist',file),path.join(root,'dist',file));
 const file=path.join(root,'dist/worker.js');let worker=await fs.readFile(file,'utf8');
 const original='rt.setInterruptHandler(() => Date.now() > deadline);';
 assert.ok(worker.includes(original),'instrument actual built interrupt handler');
 worker=worker.replace(original,
  'let delayedBootstrap=false; rt.setInterruptHandler(() => { if(!delayedBootstrap){delayedBootstrap=true;const until=Date.now()+220;while(Date.now()<until){}} return Date.now()>deadline; });');
 await fs.writeFile(file,worker);
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',args:['--no-sandbox'],headless:true});
 const artifact={version:1,html:'<div id="a">Synthetic</div>',css:'',js:'',state:{},animations:{version:1,clips:{fade:{type:'tween',target:'a',duration:200,easing:'linear',frames:[{opacity:1},{opacity:0}]}}}};
 assert.equal((await verifyAnimationArtifact(browser,artifact,{root})).status,'passed');
 console.log('PASS trusted cold bootstrap tolerates injected 220ms scheduling delay');
 for(const js of ['while(true){}','var start=Date.now();while(Date.now()-start<400){}','document.body.innerHTML="escape"']){
  const start=Date.now();await assert.rejects(verifyAnimationArtifact(browser,{...artifact,js},{root}),{verificationCode:'STARTUP'});
  assert.ok(Date.now()-start<10000,'guest still terminated within bounded execution');
 }
 const initialized={...artifact,state:{value:7},js:'if(state.value!==7 || __state.value!==7)throw Error("state mismatch");state.value=8;ui.persist();'};
 assert.equal((await verifyAnimationArtifact(browser,initialized,{root})).status,'passed');
 await fs.writeFile(file,worker.replace('Date.now()+220','Date.now()+1700'));
 await assert.rejects(verifyAnimationArtifact(browser,artifact,{root}),{verificationCode:'STARTUP'});
 assert.equal(browser.contexts().length,0);
 console.log('PASS guest 400ms work/runaway/global denial, initial state compatibility, bounded trusted bootstrap, context cleanup');
}finally{await browser?.close();await fs.rm(root,{recursive:true,force:true});}
