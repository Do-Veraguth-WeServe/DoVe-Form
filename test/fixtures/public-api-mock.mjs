// Test-process preload only. Production server never imports this module.
import https from 'node:https';import dns from 'node:dns/promises';import {EventEmitter} from 'node:events';
const originalLookup=dns.lookup.bind(dns),originalRequest=https.request.bind(https);
dns.lookup=async(host,opts)=>host==='api.form-fixture.test'?[{address:'8.8.8.8',family:4}]:originalLookup(host,opts);
https.request=(url,opts,cb)=>{if(url.hostname!=='api.form-fixture.test')return originalRequest(url,opts,cb);const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.destroy=()=>{};cb(res);res.emit('data',Buffer.from(JSON.stringify({results:[{name:url.searchParams.get('name'),country:'Schweiz',latitude:46.9,longitude:7.4}]})));res.emit('end')});return req;};
