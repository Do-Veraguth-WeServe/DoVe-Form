// Isolated browser/Playwright transport diagnostic: no Form code or user data.
import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const requests=[];
const server=http.createServer((req,res)=>{requests.push({url:req.url,at:Date.now()});if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<button id="go">Go</button><script>go.onclick=async()=>{window.stage="state";await fetch("/state",{method:"POST"}).then(r=>r.json());window.stage="view";await fetch("/view").then(r=>r.json());window.stage="done"}</script>');}else{res.setHeader('Content-Type','application/json');res.end('{}');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 const p=await browser.newPage();const stable=process.env.FORM_ROUTING_BASELINE!=='1';
 if(stable)await p.route('**/*',route=>route.continue());
 await p.goto('http://127.0.0.1:'+server.address().port);
 for(let trial=0;trial<40;trial++){
  let release,seen;const gate=new Promise(r=>release=r),arrived=new Promise(r=>seen=r);
  await p.route('**/state',async route=>{const response=await route.fetch();seen();await gate;await route.fulfill({response});});
  await p.locator('#go').click();await arrived;release();if(stable)await p.unroute('**/state');else await p.unrouteAll({behavior:'wait'});
  try{await p.waitForFunction(()=>window.stage==='done',null,{timeout:6000});}catch(e){console.log(JSON.stringify({trial,stage:await p.evaluate(()=>window.stage),requests:requests.slice(-5)}));throw e;}
 }
 assert.equal(requests.filter(r=>r.url==='/view').length,40);console.log('PASS forty isolated held-response/follow-up fetch trials; stable interception='+stable);
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
