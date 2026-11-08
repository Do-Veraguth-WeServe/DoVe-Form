// Disposable API regression harness; never connects to production accounts/data.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-api-acceptance-'));
const port=process.env.TEST_PORT||'4598', mockPort=process.env.TEST_MOCK_PORT||'4599';
const base='http://127.0.0.1:'+port,mockURL='http://127.0.0.1:'+mockPort;
const children=[];
const start=(args,env,cwd=root)=>{const p=spawn(process.execPath,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','inherit']});children.push(p);return p;};
const ready=p=>new Promise((resolve,reject)=>{let out='';const t=setTimeout(()=>reject(Error('fixture readiness timeout')),20000);p.stdout.on('data',d=>{out+=d;if(out.includes('ready')){clearTimeout(t);resolve();}});p.once('exit',code=>{clearTimeout(t);reject(Error('fixture exited '+code));});});
const stop=p=>new Promise(resolve=>{if(p.exitCode!==null)return resolve();const t=setTimeout(()=>p.kill('SIGKILL'),5000);p.once('exit',()=>{clearTimeout(t);resolve();});p.kill('SIGTERM');});
try{
 await ready(start(['test/mock-provider.mjs'],{MOCK_PORT:mockPort}));
 const models=path.join(dir,'models.json');
 await ready(start(['server.mjs'],{PORT:port,FORM3_ORIGIN:base,FORM3_MODELS:models,FORM3_DATA:path.join(dir,'data'),FORM3_PING_FIXTURE:'1',FORM3_DB_RATE:'600',FORM3_REGISTRATION:'1',FORM3_JOB_CONCURRENCY:'2'},process.env.FORM_TEST_ROOT||root));
 const p=start(['--test',...process.argv.slice(2),'test/api.test.mjs'],{BASE_URL:base,MOCK_URL:mockURL,MODELS_FILE:models});p.stdout.pipe(process.stdout);
 process.exitCode=await new Promise(resolve=>p.once('exit',code=>resolve(code??1)));
}finally{await Promise.all(children.map(stop));fs.rmSync(dir,{recursive:true,force:true});}
