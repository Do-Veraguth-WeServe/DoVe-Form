// Real Chromium parser/sanitizer; all inputs are synthetic, never user content.
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';import {build} from 'esbuild';
const root=process.env.FORM_TEST_ROOT||process.cwd();
const bundle=await build({stdin:{contents:"import {inspectFragment} from './src/sanitize.js';window.inspectFragment=inspectFragment",resolveDir:root},bundle:true,write:false});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',args:['--no-sandbox'],headless:true});
try{
 const page=await browser.newPage(),requests=[],errors=[];
 await page.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
 page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<svg id="target"></svg>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(()=>{
  const fragments=[
   '<circle cx="4" cy="4" r="3"/><img src="https://invalid.example/leak"><rect width="9" height="9"/>',
   '<circle r="3"/><div>HTML breakout</div><rect width="9"/>',
   '<circle r="3"/><script>window.forged=true</script><img src="https://invalid.example"><rect width="9"/>',
   '<circle r="3"/><foreignObject><img src="https://invalid.example" onerror="window.forged=true"></foreignObject><rect width="9"/>',
   '<circle r="3"/><svg><script>window.forged=true</script></svg><rect width="9" onclick="window.forged=true"/>',
   '<circle r="3"/><iframe src="https://invalid.example"></iframe><rect width="9"/>',
   '<circle r="3"/><math><mtext><img src="https://invalid.example"></mtext></math><rect width="9"/>',
   '<circle r="3"/><style>@import "https://invalid.example";</style><rect width="9" fill="url(https://invalid.example)"/>',
  ];
  const target=document.querySelector('#target');
  const cases=fragments.map(s=>{const out=inspectFragment(s);target.innerHTML=out.svg;
   for(const el of target.querySelectorAll('*'))el.dispatchEvent(new Event('click'));
   return {circle:target.querySelectorAll('circle').length,rect:target.querySelectorAll('rect').length,
    unsafe:target.querySelectorAll('script,img,iframe,foreignObject,math,style,[onclick],[onerror],[src],[href]').length,
    namespace:[...target.querySelectorAll('circle,rect')].every(e=>e.namespaceURI==='http://www.w3.org/2000/svg'),warning:out.warnings.svg,output:out.svg};});
  const safe=inspectFragment('<circle cx="4" r="3"/><rect width="9"/>');
  const clobber=inspectFragment('<circle id="title"/><img><rect/>');
  const count=n=>{try{const o=inspectFragment('<circle r="1"/>'.repeat(n));target.innerHTML=o.svg;return target.querySelectorAll('circle').length}catch(e){return e.message}};
  return {cases,safe:safe.warnings.svg,clobber:clobber.warnings.svg,limit:count(600),over:count(601),forged:window.forged===true};
 });
 for(const [i,c] of result.cases.entries()){assert.equal(c.circle,1,'case '+i+' circle');assert.equal(c.rect,1,'case '+i+' following rectangle');assert.equal(c.unsafe,0,'case '+i+' active content');assert.equal(c.namespace,true);assert.equal(c.warning.removed,true);assert.ok(!c.output.includes('https:'));}
 assert.deepEqual(result.safe,{removed:false,idRemoved:false});assert.equal(result.clobber.idRemoved,true);
 assert.equal(result.limit,600);assert.equal(result.over,'Zu viele Elemente');assert.equal(result.forged,false);
 await page.waitForTimeout(100);assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
 console.log('PASS eight mixed SVG/HTML variants: following shapes retained, active content/URLs removed, correct namespaces, no execution/egress, redacted warning, 600-node limit, 601 rejected; source='+root);
}finally{await browser.close()}
