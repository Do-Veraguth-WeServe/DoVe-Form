// Legacy browser sections 8/9 boundary acceptance with synthetic persisted data.
// Actual QuickJS/opaque iframe, no provider call or production DB.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {once} from 'node:events';import {pathToFileURL} from 'node:url';import {chromium} from 'playwright-core';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const {Store}=await import(pathToFileURL(path.join(root,'store.mjs')));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-boundary-')),base='http://127.0.0.1:4832';
const store=new Store(dir),user=store.createUser('boundaryowner','password123');
const boundaryRender = {
  version: 1,
  html: '<meta http-equiv="refresh" content="0;url=https://example.com"><a href="https://example.com">link</a><img src="https://example.com"><svg><a href="https://example.com"><text>X</text></a></svg><input id="amount" type="number"><p id="result"></p><svg viewBox="0 0 100 100"><g id="dyn"></g><g id="dyn3"></g></svg><div id="dyn2"></div><button id="suggest" onclick="location="https://example.com"">Suggest</button><script>location="https://example.com"</script>',
  css: '@import "https://example.com";p{background:url(https://example.com);color:#d4ef8b}',
  js: 'state.amount=state.amount||2;ui.value("amount",String(state.amount));ui.text("result",typeof window+"/"+typeof fetch+"/"+typeof document);ui.on("amount","input",e=>{state.amount=Number(e.value);ui.text("result",String(state.amount*12));ui.persist()});ui.on("suggest","click",()=>ui.suggest("explicit only"));ui.value("result","nope");ui.html("dyn","<script>location=\'https://example.com\'</script><img src=\'https://example.com\'><rect width=\'13\' height=\'13\'/>");ui.html("dyn2","<p>ok</p>");ui.html("dyn3","<rect width=\'9\' height=\'9\'/>");',
  state: {}
};

const key='synthetic-boundary-secret-1234567890';
let app,browser;
try{
 fs.writeFileSync(path.join(dir,'models.json'),JSON.stringify({models:[{id:'boundary',label:'Synthetic only',model:'fixture',baseUrl:'http://127.0.0.1:1/v1',apiKey:key}]}),{mode:0o600});
 app=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'4832',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup timeout')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve()}});app.once('exit',c=>{clearTimeout(t);reject(Error('early exit '+c))})});
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});

 for(const width of [1280,390]){
  const conv=store.createConversation(user.id),mid=store.appendMessage(conv.id,'assistant',{render:boundaryRender});
  const ctx=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}),p=await ctx.newPage(),errors=[],external=[],submits=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST'&&['/api/chat','/api/jobs','/api/plan'].some(s=>r.url().includes(s)))submits.push(r.url())});
  await p.route('**/*',route=>{const u=route.request().url();if(u.startsWith('http')&&!u.startsWith(base+'/')){external.push(u);return route.abort()}return route.continue()});
  await p.goto(base);await p.locator('#loginform [name=username]').fill('boundaryowner');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();await p.locator('#login[open]').waitFor({state:'detached'});
  const f=()=>p.frameLocator('#feed iframe.render').first();
  await f().locator('#result').filter({hasText:'undefined/undefined/undefined'}).waitFor();
  await f().locator('#amount').fill('7');await f().locator('#result').filter({hasText:'84'}).waitFor();
  await f().locator('#suggest').click();assert.equal(await p.locator('#prompt').inputValue(),'explicit only');
  assert.equal(await f().locator('#dyn script,#dyn img').count(),0);
  // Mixed malicious fragment: legacy acceptance requires removal, not shape retention.
  // Shape loss in this mixed script/img/SVG input is a separate recorded follow-up.
  assert.equal(await f().locator('#dyn3 rect').count(),1);assert.equal(await f().locator('#dyn2 p').innerText(),'ok');
  await p.locator('.notice.error').filter({hasText:'ui.value'}).first().waitFor();
  assert.equal(await f().locator('a,img,meta[http-equiv=refresh],script:not([nonce]),[onclick]').count(),0);
  const iframe=p.locator('#feed iframe.render').first(),frame=await(await iframe.elementHandle()).contentFrame();
  assert.equal(await frame.evaluate(()=>{try{return parent.document.body?'accessible':'no'}catch{return 'blocked'}}),'blocked');
  assert.equal(await frame.evaluate(async()=>{try{await fetch('https://example.com');return 'allowed'}catch{return 'blocked'}}),'blocked');
  assert.equal(await iframe.getAttribute('sandbox'),'allow-scripts');assert.equal(await iframe.evaluate(e=>e.contentDocument),null);
  await p.waitForTimeout(300);const height=await iframe.evaluate(e=>e.style.height);
  await p.evaluate(()=>window.postMessage({channel:'fake',type:'resize',height:999999},'*'));await p.waitForTimeout(100);assert.equal(await iframe.evaluate(e=>e.style.height),height);
  assert.equal(await p.locator('#export,#import,#file,#importbar').count(),0);assert.ok(!(await p.evaluate(()=>JSON.stringify(localStorage))).includes(key));
  const statuses=await p.evaluate(async()=>[await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.status),await fetch('/form.models.json').then(r=>r.status),await fetch('/api/models').then(r=>r.text())]);
  assert.equal(statuses[0],403);assert.equal(statuses[1],404);assert.ok(!statuses[2].includes(key));assert.match(statuses[2],/Synthetic only/);
  assert.equal(submits.length,1,'only explicit CSRF probe, no suggestion submission');assert.equal(store.db.prepare('SELECT count(*) n FROM jobs WHERE conversation_id=?').get(conv.id).n,0);
  await p.waitForFunction(async id=>{const d=await(await fetch('/api/conversations')).json();return d.conversations?.some(s=>s.messages?.some(m=>m.id===id&&m.render?.state?.amount===7))},mid);
  const open=p.getByRole('button',{name:'Element öffnen',exact:true});
  // Keep automatic-scroll reproduction available; normal path waits for compositing.
  await p.evaluate(()=>{window.__boundaryClicks=[];document.addEventListener('click',e=>window.__boundaryClicks.push(e.target.closest('button')?.getAttribute('title')||e.target.tagName),true)});
  if(process.env.FORM_BOUNDARY_AUTOCLICK!=='1'){
    await open.scrollIntoViewIfNeeded();
    await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  }
  await open.click();
  const pointerClicks=await p.evaluate(()=>window.__boundaryClicks);
  console.log('overlay pointer trace',width,JSON.stringify(pointerClicks));
  assert.equal(pointerClicks.length,1,'exactly one pointer click reaches the parent document');
  await p.frameLocator('#overlay iframe.render').locator('#dyn3 rect').waitFor({state:'attached',timeout:5000});
  await p.locator('#overlay .notice.error').filter({hasText:'ui.value'}).waitFor();
  await p.locator('#overlay').screenshot({path:'docs/screenshots/boundary-error-'+width+'.png'});
  await p.getByRole('button',{name:'Element schliessen',exact:true}).click();
  await p.reload();await f().locator('#amount').waitFor();await p.waitForFunction(()=>document.querySelector('#feed iframe.render')?.dataset.ready==='true');assert.equal(await f().locator('#amount').inputValue(),'7');assert.deepEqual(store.getRender(mid),{...boundaryRender,state:{amount:7}});
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  // Legacy11: a previous owner's local cache is evidence, never authority to import.
  const ownerCache=await p.evaluate(()=>JSON.parse(localStorage.getItem('form.v3')));
  assert.ok(ownerCache.sessions.some(s=>s.id===conv.id));
  const foreign=store.createUser('cacheforeign'+width,'password456');
  const ownConv=store.createConversation(foreign.id,'Foreign own '+width);
  const ownMid=store.appendMessage(ownConv.id,'user',{text:'foreign-only-marker-'+width});
  const foreignCtx=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'});
  try{
    const fp=await foreignCtx.newPage(),foreignErrors=[],foreignWrites=[];
    fp.on('pageerror',e=>foreignErrors.push(e.message));
    fp.on('request',r=>{if(r.method()==='POST'&&!r.url().endsWith('/api/auth/login'))foreignWrites.push(r.url())});
    await fp.goto(base);
    await fp.evaluate(cache=>localStorage.setItem('form.v3',JSON.stringify(cache)),ownerCache);
    await fp.reload();
    await fp.locator('#login[open]').waitFor();
    assert.equal(await fp.locator('#feed iframe.render').count(),0,'unauthenticated cache does not mount owner code');
    await fp.locator('#loginform [name=username]').fill('cacheforeign'+width);
    await fp.locator('#loginform [name=password]').fill('password456');
    await fp.locator('#loginform button').click();
    await fp.locator('#login[open]').waitFor({state:'detached'});
    for(const stage of ['login','reload']){
      if(stage==='reload')await fp.reload();
      await fp.locator('#feed').getByText('foreign-only-marker-'+width,{exact:true}).waitFor();
      const snapshot=await fp.evaluate(async()=>({
        canonical:await(await fetch('/api/conversations')).json(),
        cache:JSON.parse(localStorage.getItem('form.v3')),
        titles:[...document.querySelectorAll('#sessions .session-open')].map(e=>e.textContent)
      }));
      assert.deepEqual(snapshot.canonical.conversations.map(c=>c.id),[ownConv.id],stage+' canonical own-only');
      assert.deepEqual(snapshot.cache.sessions.map(c=>c.id),[ownConv.id],stage+' cache replaces foreign history');
      assert.deepEqual(snapshot.cache.sessions[0].messages.map(m=>m.id),[ownMid]);
      assert.deepEqual(snapshot.titles,['Foreign own '+width]);
      for(const id of [conv.id,mid])assert.ok(!JSON.stringify(snapshot).includes(id),stage+' contains no owner IDs');
      assert.equal(await fp.locator('iframe.render,#importbar,#import,#export,#file').count(),0);
      assert.equal(await fp.locator('#elements-list button').count(),0);
      assert.ok(await fp.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    }
    assert.deepEqual(foreignWrites,[],'no auto-import/build/mutation from seeded cache');
    assert.deepEqual(foreignErrors,[]);
    assert.equal(store.db.prepare('SELECT count(*) n FROM conversations WHERE user_id=?').get(foreign.id).n,1);
    assert.deepEqual(store.getRender(mid),{...boundaryRender,state:{amount:7}},'owner data unchanged');
    console.log('PASS '+width+': foreign-account seeded owner cache ignored, own canonical/cache/DOM after login+reload, no auto-import or mutation');
  }finally{await foreignCtx.close()}
  console.log('PASS '+width+': guest globals, dynamic HTML/SVG, suggestion without submit, opaque parent/network denial, forged resize, masked key/cache/CSRF, persisted state and overflow');await ctx.close();
 }
 console.log('PASS sandbox boundary browser source='+root);
}finally{await browser?.close();if(app&&app.exitCode===null){app.kill('SIGTERM');await once(app,'exit')}store.close();fs.rmSync(dir,{recursive:true,force:true});}
