// One request per systemd socket instance; OS deadline/cgroup kills all descendants.
import fs from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {verifyAnimationArtifact} from './animation-verification.mjs';
if(process.getuid()===0)throw Error('Verifier refuses root');
let browser,stage='input';
const deadline=setTimeout(()=>process.exit(2),32000);
let input='';const controller=new AbortController();
process.stdin.on('end',()=>controller.abort());
process.stdout.on('error',()=>controller.abort());
try{
 for await(const chunk of process.stdin.iterator({destroyOnReturn:false})){input+=chunk;if(Buffer.byteLength(input)>220000)throw Error('request-size');if(input.includes('\n'))break;}
 process.stdin.resume();
 const request=JSON.parse(input);
 if(!request||Object.keys(request).some(k=>k!=='artifact'))throw Error('request-schema');
 stage='browser-start';
 const home=await fs.mkdtemp('/tmp/form-verifier-');
 browser=await chromium.launch({env:{PATH:'/usr/bin:/bin',HOME:home,XDG_CONFIG_HOME:home,XDG_CACHE_HOME:home},ignoreDefaultArgs:['--disable-ipc-flooding-protection','--enable-unsafe-swiftshader'],executablePath:'/opt/form-verifier/chrome/chrome',chromiumSandbox:true,headless:true,args:['--disable-dev-shm-usage']});
 stage='verification';
 const evidence=await verifyAnimationArtifact(browser,request.artifact,{root:'/opt/form-verifier',timeoutMs:25000,signal:controller.signal});
 process.stdout.write(JSON.stringify({ok:true,evidence})+'\n');
}catch{process.stdout.write(JSON.stringify({ok:false,stage,error:'Isolated animation verification rejected or unavailable'})+'\n');}
finally{await browser?.close().catch(()=>{});clearTimeout(deadline);}
