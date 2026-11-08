import net from 'node:net';
export function requestAnimationVerification(artifact,{socketPath='/run/form-verifier.sock',signal,timeoutMs=34000}={}){
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
   try{const result=JSON.parse(data.slice(0,data.indexOf('\n')));if(result.ok!==true||result.evidence?.status!=='passed')throw Error();finish(null,result.evidence);}catch{finish(Error('Animation browser verification rejected'));}
  });
 });
}
