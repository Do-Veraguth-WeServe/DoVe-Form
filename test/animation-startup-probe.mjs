// Opt-in, synthetic-only diagnostic clone. Never changes installed runtime or production socket.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.FORM_STARTUP_PROBE,'1');
assert.equal(process.getuid(),0);
const run=(...args)=>execFileSync('systemctl',args,{encoding:'utf8'}).trim();
const name='form-startup-probe-'+process.pid,root='/opt/form-verifier/'+name,socket='/run/'+name+'.sock',unitDir='/run/systemd/system';
const service=await fs.readFile('/etc/systemd/system/form-verifier@.service','utf8');
const socketUnit=await fs.readFile('/etc/systemd/system/form-verifier.socket','utf8');
const units=()=>run('list-units',name+'@*','--all','--plain','--no-legend').split('\n').filter(Boolean).map(x=>x.trim().split(/\s+/).find(x=>x.startsWith(name+'@'))).filter(Boolean);
const fixture={version:1,html:'<div id="a">Synthetic</div>',css:'',js:'',state:{},animations:{version:1,clips:{fade:{type:'tween',target:'a',duration:200,easing:'linear',frames:[{opacity:1},{opacity:0}]}}}};
let madeRoot=false,madeService=false,madeSocket=false;
try{
 await fs.mkdir(root);madeRoot=true;
 for(const entry of await fs.readdir('/opt/form-verifier'))if(entry.endsWith('.mjs'))await fs.copyFile('/opt/form-verifier/'+entry,root+'/'+entry);
 await fs.cp('/opt/form-verifier/dist',root+'/dist',{recursive:true});
 let bundle=await fs.readFile(root+'/dist/animation-verification.js','utf8');
 assert.ok(bundle.includes('onError: () => record.errors.push("runtime-error")'));
 bundle=bundle.replace('onError: () => record.errors.push("runtime-error")','onError: (error) => record.errors.push(String(error))');
 await fs.writeFile(root+'/dist/animation-verification.js',bundle);
 let verification=await fs.readFile(root+'/animation-verification.mjs','utf8');
 verification=verification.replaceAll("'Runtime startup rejected'","JSON.stringify(await page.evaluate(()=>window.verification.errors))");
 await fs.writeFile(root+'/animation-verification.mjs',verification);
 let worker=await fs.readFile(root+'/animation-verifier-worker.mjs','utf8');
 worker=worker.replace("root:'/opt/form-verifier'","root:"+JSON.stringify(root)).replace('stage,code:','diagnostic:String(error.message),stage,code:');
 await fs.writeFile(root+'/animation-verifier-worker.mjs',worker);
 await fs.writeFile(unitDir+'/'+name+'@.service',service.replace('WorkingDirectory=/opt/form-verifier','WorkingDirectory='+root).replace('/opt/form-verifier/animation-verifier-worker.mjs',root+'/animation-verifier-worker.mjs'),{flag:'wx'});madeService=true;
 await fs.writeFile(unitDir+'/'+name+'.socket',socketUnit.replace('/run/form-verifier.sock',socket),{flag:'wx'});madeSocket=true;
 run('daemon-reload');run('start',name+'.socket');
 for(let i=0;i<12;i++){
  const start=Date.now();
  const result=await new Promise((resolve,reject)=>{const s=net.createConnection(socket);let data='';const timer=setTimeout(()=>{s.destroy();reject(Error('probe timeout'));},36000);const finish=(e,v)=>{clearTimeout(timer);s.destroy();e?reject(e):resolve(v);};s.on('error',e=>finish(e));s.on('connect',()=>s.write(JSON.stringify({artifact:fixture})+'\n'));s.on('data',chunk=>{data+=chunk;if(data.includes('\n')){try{finish(null,JSON.parse(data.split('\n')[0]));}catch(e){finish(e);}}});s.on('end',()=>{if(!data.includes('\n'))finish(Error('incomplete'));});});
  console.log(JSON.stringify({attempt:i,elapsedMs:Date.now()-start,ok:result.ok,code:result.code,diagnostic:result.diagnostic}));
 }
}finally{
 if(madeSocket)try{run('stop',name+'.socket');}catch{}
 for(const u of units()){try{run('stop',u);}catch{}try{run('reset-failed',u);}catch{}}
 if(madeSocket)await fs.rm(unitDir+'/'+name+'.socket',{force:true});
 if(madeService)await fs.rm(unitDir+'/'+name+'@.service',{force:true});
 if(madeSocket||madeService)run('daemon-reload');
 if(madeSocket)await fs.rm(socket,{force:true});
 if(madeRoot)await fs.rm(root,{recursive:true,force:true});
 console.log('CLEAN isolated synthetic probe; installed runtime unchanged');
}
