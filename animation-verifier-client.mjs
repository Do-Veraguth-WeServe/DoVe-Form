import net from 'node:net';
import {verificationFailure} from './animation-verification-errors.mjs';
function requestAnimationVerificationOnce(artifact,{socketPath='/run/form-verifier.sock',signal,timeoutMs=34000}={}){
 if(signal?.aborted)return Promise.reject(Error('Animation verification cancelled'));
 const payload=JSON.stringify({artifact})+'\n';
 if(Buffer.byteLength(payload)>220000)return Promise.reject(Error('Animation verification request too large'));
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection(socketPath);let data='',done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(value);};
  const abort=()=>finish(Error('Animation verification cancelled'));
  const timer=setTimeout(()=>finish(Error('Animation verification deadline')),Math.min(34000,Math.max(1,timeoutMs)));
  signal?.addEventListener('abort',abort,{once:true});
  socket.on('connect',()=>socket.write(payload));
  socket.on('error',()=>finish(Error('Animation verification unavailable')));
  socket.on('end',()=>finish(Error('Animation verification incomplete')));
  socket.on('data',chunk=>{
   data+=chunk;if(Buffer.byteLength(data)>64000)return finish(Error('Animation verification response too large'));
   if(!data.includes('\n'))return;
   try{const result=JSON.parse(data.slice(0,data.indexOf('\n')));if(result.ok!==true||result.evidence?.status!=='passed')return finish(Error(verificationFailure(result.code).message));finish(null,result.evidence);}catch{finish(Error(verificationFailure('INTERNAL').message));}
  });
 });
}

export async function requestAnimationVerification(artifact,opts={}){
 const end=Date.now()+(opts.timeoutMs??34000);
 for(let attempt=0;;attempt++){
  try{return await requestAnimationVerificationOnce(artifact,{...opts,timeoutMs:end-Date.now()});}
  catch(e){if(attempt>=2||opts.signal?.aborted||!/^Animation verification (unavailable|incomplete)$/.test(e.message)||end-Date.now()<600)throw e;
   await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(Error('Animation verification cancelled'));};const timer=setTimeout(()=>{opts.signal?.removeEventListener('abort',abort);resolve();},250*(attempt+1));opts.signal?.addEventListener('abort',abort,{once:true});if(opts.signal?.aborted)abort();});
  }
 }
}
