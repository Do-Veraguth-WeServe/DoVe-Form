// Synthetic fixtures only; no production data or provider calls.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {verifyAnimationArtifact:verify}=await import(pathToFileURL(path.join(root,'animation-verification.mjs')));
const browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',args:['--no-sandbox'],headless:true});
const fixture={version:1,html:'<div id="a">Synthetic</div><div id="container"></div><svg id="drawing"></svg><table><tbody id="rows"></tbody></table>',css:'',js:'',state:{},animations:{version:1,clips:{fade:{type:'tween',target:'a',duration:100,easing:'linear',frames:[{opacity:1},{opacity:0}]}}}};
const insert=(id,html)=>'ui.html('+JSON.stringify(id)+','+JSON.stringify(html)+');';
try {
 for(const html of ['<div id="title">PRIVATE_SENTINEL</div>','<button onclick="PRIVATE_SENTINEL()">Click</button>','<img src="https://private.invalid/SECRET">','<input type="date">','<span>x</span>'.repeat(601)]) {
  await assert.rejects(verify(browser,{...fixture,js:insert('container',html)},{root}),error=>{assert.equal(error.verificationCode,'HTML');assert.doesNotMatch(error.message,/PRIVATE_SENTINEL|private.invalid|SECRET/);return true;});
 }
 for(const [id,html] of [['container','<span>Safe</span>'],['drawing','<path d="M0 0L20 20"/>'],['rows','<tr><td>Cell</td></tr>']]) assert.equal((await verify(browser,{...fixture,js:insert(id,html)},{root})).status,'passed');
 // This mode deliberately must not execute dynamic HTML or any other guest code.
 assert.equal((await verify(browser,{...fixture,animations:undefined,js:insert('container','<div id="title">Legacy</div>')},{root,htmlOnly:true})).scope,'initial-html-only');
 assert.equal(browser.contexts().length,0);
 console.log('PASS observed animated startup dynamic HTML: five rejections; safe HTML/SVG/table contexts; static-only no execution; privacy; cleanup');
} finally {await browser.close();}
