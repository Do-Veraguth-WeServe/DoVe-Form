// Opt-in installed-service acceptance. Never signals/saturates the production socket.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {requestAnimationVerification as verify} from '../animation-verifier-client.mjs';
const run=(...args)=>execFileSync('systemctl',args,{encoding:'utf8'}).trim();
assert.equal(process.env.FORM_OS_PROBE,'1','Explicit isolated systemd probe opt-in required');
assert.equal(process.getuid(),0,'Requires root to install temporary isolated units');
const name='form-verifier-probe-'+process.pid, socket='/run/'+name+'.sock';
const unitDir='/run/systemd/system';
const service=await fs.readFile('/etc/systemd/system/form-verifier@.service','utf8');
const socketUnit=await fs.readFile('/etc/systemd/system/form-verifier.socket','utf8');
assert.match(service,/RuntimeMaxSec=35\b/);assert.match(service,/KillMode=control-group/);
const units=()=>run('list-units',name+'@*','--all','--plain','--no-legend').split('\n').filter(Boolean).map(x=>x.trim().split(/\s+/).find(x=>x.startsWith(name+'@'))).filter(Boolean);
const properties=u=>Object.fromEntries(run('show',u,'-p','MainPID,User,PrivateNetwork,PrivateTmp,ProtectSystem,ProtectHome,MemoryMax,MemorySwapMax,TasksMax,CPUQuotaPerSecUSec,NoNewPrivileges,KillMode,RuntimeMaxUSec,ControlGroup,Result').split('\n').map(x=>{const p=x.indexOf('=');return[x.slice(0,p),x.slice(p+1)];}));
const sockets=[];let owned=[];let createdService=false,createdSocket=false;
const fixture={version:1,html:'<div id="a">Isolated</div>',css:'',js:'',state:{},animations:{version:1,clips:{fade:{type:'tween',target:'a',duration:2000,easing:'linear',frames:[{opacity:1},{opacity:0}]}}}};
async function members(group){const found=[];for(const entry of await fs.readdir('/proc')){if(!/^[0-9]+$/.test(entry))continue;try{const c=await fs.readFile('/proc/'+entry+'/cgroup','utf8');if(c.split(String.fromCharCode(10)).some(x=>x.endsWith(':'+group)))found.push(+entry);}catch(e){if(e.code!=='ENOENT'&&e.code!=='ESRCH')throw e;}}return found;}
async function connect(){const s=net.createConnection(socket);s.on('error',()=>{});s.on('data',()=>{});sockets.push(s);await new Promise((r,j)=>{s.once('connect',r);s.once('error',j);});return s;}
async function until(fn,ms=4000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await delay(100);}throw Error('bounded readiness timeout');}
try{
 // Exclusive creation refuses any pre-existing probe configuration.
 await fs.writeFile(unitDir+'/'+name+'@.service',service,{flag:'wx',mode:0o644});createdService=true;
 await fs.writeFile(unitDir+'/'+name+'.socket',socketUnit.replace('/run/form-verifier.sock',socket),{flag:'wx',mode:0o644});createdSocket=true;
 run('daemon-reload');run('start',name+'.socket');
 assert.equal((await fs.stat(socket)).mode&0o777,0o600);
 const first=await connect();first.write('{');
 await until(()=>units().length===1);
 const u=units()[0];owned.push(u);
 const p=await until(()=>{const p=properties(u);return +p.MainPID?p:null;});
 assert.equal(p.User,'form-verifier');assert.equal(p.PrivateNetwork,'yes');assert.equal(p.PrivateTmp,'yes');assert.equal(p.ProtectSystem,'strict');assert.equal(p.ProtectHome,'yes');assert.equal(p.MemoryMax,'1073741824');assert.equal(p.MemorySwapMax,'0');assert.equal(p.TasksMax,'256');assert.equal(p.NoNewPrivileges,'yes');assert.equal(p.KillMode,'control-group');assert.equal(p.RuntimeMaxUSec,'35s');
 const pid=+p.MainPID;
 // MainPID exists during systemd pre-exec setup; wait until Node actually execs.
 await until(async()=>{const cmd=await fs.readFile('/proc/'+pid+'/cmdline','utf8');return cmd.includes('/opt/form-verifier/animation-verifier-worker.mjs');});
 const status=await fs.readFile('/proc/'+pid+'/status','utf8');assert.doesNotMatch(status,/Uid:\s+0\s/);assert.match(status,/CapEff:\s+0000000000000000/);assert.match(status,/NoNewPrivs:\s+1/);
 assert.notEqual(await fs.readlink('/proc/'+pid+'/ns/net'),await fs.readlink('/proc/self/ns/net'));
 assert.notEqual(await fs.readlink('/proc/'+pid+'/ns/mnt'),await fs.readlink('/proc/self/ns/mnt'));
 const addresses=await fs.readFile('/proc/'+pid+'/net/dev','utf8');assert.ok(!addresses.includes('eth0:'));
 // Probe actual inaccessible mount without reading any application file.
 const mounts=await fs.readFile('/proc/'+pid+'/mountinfo','utf8');assert.match(mounts,/ \/opt\/form /);
 console.log('PASS non-root, empty capabilities, no-new-privileges, separate network/mount namespaces; configured cgroup ceilings');
 const second=await connect();second.write('{');await until(()=>units().length===2);owned=units();
 const third=await connect();await until(()=>third.destroyed);assert.equal(units().length,2);
 console.log('PASS third concurrent socket rejected; max two isolated probe workers');
 let browserPids=[];
 if(process.env.FORM_OS_BROWSER==='1'){
  first.write(JSON.stringify({artifact:fixture}).slice(1)+String.fromCharCode(10));
  browserPids=await until(async()=>{const result=[];for(const child of await members(p.ControlGroup)){try{if((await fs.readFile('/proc/'+child+'/cmdline','utf8')).includes('/opt/form-verifier/chrome/'))result.push(child);}catch(e){if(e.code!=='ENOENT')throw e;}}return result.length?result:null;});
  console.log('Observed Chromium descendants in owned probe cgroup: '+browserPids.length);
 }
 // Stop JS itself: its 32-second application timer cannot fire. Only OS deadline can clean it.
 const stoppedAt=Date.now();process.kill(pid,'SIGSTOP');
 await until(()=>/State:\s+T/.test(execFileSync('cat',['/proc/'+pid+'/status'],{encoding:'utf8'})));
 await until(async()=>{try{await fs.stat('/proc/'+pid);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}},39000);
 const elapsed=Date.now()-stoppedAt;assert.ok(elapsed>29000&&elapsed<39000,'OS termination timing '+elapsed);
 const final=properties(u);assert.equal(final.Result,'timeout');
 console.log('PASS stopped worker killed by systemd timeout, elapsedMs='+elapsed+', Result=timeout');
 await until(async()=>!(await members(p.ControlGroup)).length);
 console.log('PASS owned cgroup empty after OS timeout; Chromium mode='+Boolean(browserPids.length));
 assert.equal((await verify(fixture,{socketPath:socket})).status,'passed');
 console.log('PASS real sandboxed Chromium request succeeds after capacity recovery');
 console.log('LIMIT: memory/CPU limits inspected, not destructive exhaustion stress-tested');
}finally{
 for(const s of sockets)s.destroy();
 if(createdSocket)try{run('stop',name+'.socket');}catch{}
 for(const u of [...new Set([...owned,...units()])]){try{run('stop',u);}catch{}try{run('reset-failed',u);}catch{}}
 if(createdSocket)await fs.rm(unitDir+'/'+name+'.socket',{force:true});
 if(createdService)await fs.rm(unitDir+'/'+name+'@.service',{force:true});
 if(createdSocket||createdService)run('daemon-reload');
 if(createdSocket)await fs.rm(socket,{force:true});
 console.log('CLEAN temporary probe units/socket; production service unchanged');
}
