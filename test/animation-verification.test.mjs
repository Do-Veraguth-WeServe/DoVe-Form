import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from 'playwright-core';
import {verifyAnimationArtifact} from '../animation-verification.mjs';
const browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',args:['--no-sandbox'],headless:true});
const fixture={version:1,html:'<div class="sheet"><div id="a">Aufgabe 1</div><div id="b">Papiermitte</div><div id="c">Papierende</div></div>',css:'.sheet{display:flex;padding:30px;min-height:180px}.sheet div{background:#f2e96e;color:#161916;width:90px;height:150px;padding:8px}',js:'',state:{},animations:{version:1,clips:{fold:{type:'crumple',targets:['a','b','c'],duration:700}}}};
try{
 fs.mkdirSync('docs/screenshots/animation-verification',{recursive:true});
 const out=await verifyAnimationArtifact(browser,fixture,{screenshotDir:'docs/screenshots/animation-verification'});
 console.log('valid clip passed');
 await verifyAnimationArtifact(browser,{...fixture,html:'<div id="root"></div>',js:'ui.html("root",'+JSON.stringify(fixture.html)+');'});
 const large={...fixture,animations:{version:1,clips:Object.fromEntries(Array.from({length:9},(_,i)=>['fold'+i,{...fixture.animations.clips.fold,duration:2000}]))}};
 await assert.rejects(verifyAnimationArtifact(browser,large),/budget exceeded/);
 assert.equal(out.status,'passed');assert.equal(out.clips.length,1);assert.equal(new Set(out.clips[0].samples.map(s=>s.transform)).size,3);
 assert.match(out.sourceHash,/^[a-f0-9]{64}$/);
 assert.equal(browser.contexts().length,0);
 console.log('missing target');
 await assert.rejects(verifyAnimationArtifact(browser,{...fixture,html:'<div>missing</div>'}),/missing or ambiguous/);
 await assert.rejects(verifyAnimationArtifact(browser,{...fixture,html:fixture.html+'<div id="a">duplicate</div>'}),/missing or ambiguous/);
 await assert.rejects(verifyAnimationArtifact(browser,{...fixture,js:'while(true){}'}),/startup/);
 await assert.rejects(verifyAnimationArtifact(browser,{...fixture,js:'document.body.innerHTML="escape"'}),/startup/);
 console.log('abort cleanup');
 const controller=new AbortController();setTimeout(()=>controller.abort(),100);
 await assert.rejects(verifyAnimationArtifact(browser,fixture,{signal:controller.signal}),/cancelled/);
 assert.equal(browser.contexts().length,0);
 // No DB, external actions, fetch, or stored live user state are available.
 const unavailable={...fixture,js:'ui.db.select("tasks",{},function(r){if(r.ok)throw Error("unexpected live DB");});'};
 await verifyAnimationArtifact(browser,unavailable);
 fs.writeFileSync('docs/test-results/2026-11-08-animation-verification.json',JSON.stringify(out,null,2)+'\n');
 console.log('PASS isolated startup + declared clips, missing/duplicate targets, runaway/global escape, abort cleanup, unavailable DB; original workflow NOT certified');
}finally{await browser.close();}
