// Synthetic isolated browser only. No production data or external provider.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {verifyAnimationArtifact:verify}=await import(pathToFileURL(path.join(root,'animation-verification.mjs')));
const browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',args:['--no-sandbox'],headless:true});
const fixture={version:1,html:'<div id="a">Synthetic</div>',css:'',js:'',state:{},animations:{version:1,clips:{fade:{type:'tween',target:'a',duration:100,easing:'linear',frames:[{opacity:1},{opacity:0}]}}}};
try {
 for(const html of ['<div id="title">PRIVATE_SENTINEL</div>','<button onclick="PRIVATE_SENTINEL()">Click</button>','<img src="https://private.invalid/SECRET">','<input type="date">','<svg><path fill="url(#PRIVATE_SENTINEL)"/></svg>']) {
  await assert.rejects(verify(browser,{...fixture,html:fixture.html+html},{root}),error=>{assert.equal(error.verificationCode,'HTML');assert.doesNotMatch(error.message,/PRIVATE_SENTINEL|private.invalid|SECRET/);return true;});
 }
 assert.equal((await verify(browser,fixture,{root})).status,'passed');
 for(const html of ['<svg viewBox="0 0 20 20"><path d="M0 0L20 20"/></svg>','<table><tbody><tr><td>Cell</td></tr></tbody></table>','<input type="number" value="3">']) assert.equal((await verify(browser,{...fixture,html:fixture.html+html},{root})).status,'passed');
 // New gate does not silently migrate or start checking legacy nonanimated artifacts.
 assert.deepEqual(await verify(browser,{...fixture,animations:undefined,html:'<div id="title">Legacy</div>'},{root}),{status:'not-applicable'});
 assert.equal(browser.contexts().length,0);
 console.log('PASS initial animated HTML preflight: five rejected variants, supported SVG/table/input, privacy, legacy compatibility, cleanup');
} finally {await browser.close();}
