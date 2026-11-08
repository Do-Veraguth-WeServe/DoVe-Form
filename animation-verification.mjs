// Isolated startup/declared-clip smoke evidence, not semantic visual acceptance.
import fs from 'node:fs/promises';
import {verificationError} from './animation-verification-errors.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateRender} from './contract.mjs';
import {validateAnimations} from './animation-policy.mjs';
const ORIGIN='https://form-verification.invalid';
const targets=n=>n.type==='tween'?[n.target]:n.type==='crumple'?n.targets:n.children.flatMap(targets);
const duration=n=>n.type==='tween'||n.type==='crumple'?n.duration:n.type==='sequence'?n.children.reduce((s,c)=>s+duration(c),0):Math.max(...n.children.map(duration));
export async function verifyAnimationArtifact(browser,artifact,{root=process.cwd(),timeoutMs=25000,signal,screenshotDir}={}){
 validateRender(artifact);if(!artifact.animations)return {status:'not-applicable'};
 validateAnimations(artifact.animations);
 const clips=Object.entries(artifact.animations.clips);
 if(clips.reduce((s,[,n])=>s+duration(n)+200,0)>16000)throw verificationError('BUDGET','Animation verification budget exceeded; simplify clips');
 if(signal?.aborted)throw verificationError('CANCELLED','Animation verification cancelled');
 const sourceHash=crypto.createHash('sha256').update(JSON.stringify(artifact)).digest('hex');
 const files=new Map();
 for(const [url,file,type] of [['/verify.js','animation-verification.js','text/javascript'],['/worker.js','worker.js','text/javascript'],['/quickjs.wasm','quickjs.wasm','application/wasm']])files.set(url,{body:await fs.readFile(path.join(root,'dist',file)),contentType:type});
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',acceptDownloads:false});
 let page,cancelled=false;
 const cancel=()=>{cancelled=true;void page?.close().catch(()=>{});};
 signal?.addEventListener('abort',cancel,{once:true});
 if(signal?.aborted)cancel();
 const timer=setTimeout(cancel,Math.max(1000,Math.min(timeoutMs,30000)));
 let phase='startup';
 try{
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(u.origin!==ORIGIN)return route.abort();
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><script type="module" src="/verify.js"></script>'});
   const resource=files.get(u.pathname);return resource?route.fulfill(resource):route.abort();
  });
  page=await context.newPage();if(cancelled)throw Error('cancelled');page.setDefaultTimeout(5000);
  await page.goto(ORIGIN);await page.waitForFunction(()=>typeof window.mountVerification==='function');
  // Reject initial sanitizer losses before any guest code executes. Existing saved
  // artifacts remain compatible; only the generation verifier calls this gate.
  if(!await page.evaluate(html=>window.preflightVerificationHTML(html),artifact.html))throw verificationError('HTML','Initial HTML violates the supported sanitizer policy');
  const mount=async data=>{
   await page.evaluate(d=>window.mountVerification(d),data);
   await page.waitForFunction(()=>document.querySelector('iframe')?.dataset.ready==='true'||window.verification.errors.length);
   if(await page.evaluate(()=>window.verification.errors.length))throw verificationError('STARTUP','Runtime startup rejected');
  };
  await mount(artifact);await page.waitForTimeout(150);
  if(await page.evaluate(()=>window.verification.errors.length))throw verificationError('STARTUP','Runtime startup rejected');
  const effectiveHTML=await page.frameLocator('iframe').locator('body').evaluate(el=>{const clone=el.cloneNode(true);clone.querySelectorAll('script').forEach(s=>s.remove());return clone.innerHTML;});
  const evidence=[];
  for(const [index,[name,node]] of clips.entries()){
   phase='declared-clip';
   const stateKey='verification_'+crypto.randomBytes(12).toString('hex');
   const js='ui.animate('+JSON.stringify(name)+',function(r){state['+JSON.stringify(stateKey)+']=r;ui.persist();});';
   await mount({...artifact,html:effectiveHTML,js,state:{}});
   const frame=page.frameLocator('iframe');
   const ids=[...new Set(targets(node))];
   await page.waitForTimeout(Math.max(1,Math.min(100,duration(node)/3)));
   const samples=[];
   for(const id of ids){
    const loc=frame.locator('[id="'+id+'"]');
    if(await loc.count()!==1)throw verificationError('TARGET','Animation target missing or ambiguous');
    samples.push(await loc.evaluate(el=>({transform:getComputedStyle(el).transform,opacity:getComputedStyle(el).opacity,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
   }
   if(screenshotDir)await page.locator('iframe').screenshot({path:path.join(screenshotDir,'clip-'+index+'-middle.png')});
   await page.waitForFunction(key=>window.verification.states[0]?.[key],stateKey,{timeout:9000});
   const result=await page.evaluate(key=>window.verification.states[0][key],stateKey);
   if(result.status!=='finished'||result.ok!==true)throw verificationError('EXECUTION','Declared animation execution failed');
   if(screenshotDir)await page.locator('iframe').screenshot({path:path.join(screenshotDir,'clip-'+index+'-end.png')});
   evidence.push({clip:index,targets:ids.length,samples,status:'finished'});
  }
  return {status:'passed',scope:'startup-and-declared-clips',sourceHash,viewport:{width:390,height:844},clips:evidence,limitations:['No semantic visual-intent certification','No generated click/persistence workflow certification','Empty isolated data; no production actions']};
 }catch(e){throw verificationError(signal?.aborted?'CANCELLED':cancelled?'DEADLINE':e.verificationCode||'INTERNAL','Animation browser verification failed ('+phase+'): '+(signal?.aborted?'cancelled':String(e.message).includes('Target page')?'deadline or browser closed':String(e.message).slice(0,100)));}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);await context.close().catch(()=>{});}
}
