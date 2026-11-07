// Non-admin-owned providers can reach only public HTTPS, with DNS pinned per request.
import https from 'node:https';import dns from 'node:dns/promises';import {Readable} from 'node:stream';import {endpoint,publicIPv4} from './http-tools.mjs';
export async function publicProviderFetch(url,opts){
 const u=new URL(endpoint(url));
 const records=await dns.lookup(u.hostname,{family:4,all:true});
 if(!records.length||records.some(r=>!publicIPv4(r.address)))throw Error('Private oder reservierte Provideradresse gesperrt.');
 opts.signal?.throwIfAborted();const address=records[0].address;
 return new Promise((resolve,reject)=>{
  const req=https.request(u,{method:opts.method,headers:opts.headers,signal:opts.signal,lookup:(_h,o,cb)=>o.all?cb(null,[{address,family:4}]):cb(null,address,4)},res=>{
   if(res.statusCode>=300&&res.statusCode<400){res.destroy();reject(Error('Provider-Redirect gesperrt.'));return;}
   resolve(new Response(Readable.toWeb(res),{status:res.statusCode}));
  });req.on('error',reject);req.end(opts.body);
 });
}
