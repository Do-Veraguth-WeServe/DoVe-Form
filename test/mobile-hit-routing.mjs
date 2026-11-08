// Test-only Chromium routing probe: no Form server, code, accounts or user data.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
const results=[];
try {
 for(const mode of ['automatic','settled','wheel']) {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  await page.addInitScript(()=>{window.inputs=[];document.addEventListener('click',e=>window.inputs.push({target:e.target.tagName,x:e.clientX,y:e.clientY}),true);});
  await page.goto('data:text/html,'+encodeURIComponent('<style>body{margin:0}#feed{margin-top:100px;height:450px;overflow:auto}button{display:block;height:32px;margin-left:160px}iframe{display:block;width:350px;height:200px;border:0;margin-left:20px}</style><div id="feed"><div style="height:42px"></div><button>Open</button><iframe sandbox="allow-scripts" srcdoc="<html><body>synthetic frame</body></html>"></iframe><div style="height:371px"></div></div>'));
  await page.locator('iframe').waitFor();
  await page.evaluate(()=>{document.querySelector('#feed').scrollTop=195;});
  await page.waitForTimeout(100);
  const button=page.getByRole('button',{name:'Open',exact:true});
  const before=await button.boundingBox();assert.ok(before.y<100);
  if(mode==='settled') {await button.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
  if(mode==='wheel') {await page.mouse.move(360,400);await page.mouse.wheel(0,-900);await page.waitForFunction(()=>document.querySelector('#feed').scrollTop===0);}
  await button.click();
  const parent=await page.evaluate(()=>window.inputs);
  const frames=[];for(const f of page.frames().slice(1))frames.push(await f.evaluate(()=>window.inputs||[]));
  results.push({mode,before,after:await button.boundingBox(),parent,frames,opened:parent.some(e=>e.target==='BUTTON')});
  await page.close();
 }
 console.log(JSON.stringify({browser:browser.version(),results},null,2));
 assert.ok(results.find(r=>r.mode==='settled').opened,'settled explicit scroll routes one click');
 assert.ok(results.find(r=>r.mode==='wheel').opened,'user wheel scroll routes one click');
 // Automatic result is evidence, not a required failure: browser fixes may change it.
} finally {await browser.close();}
