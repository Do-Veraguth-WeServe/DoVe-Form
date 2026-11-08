// Isolated test-only preload. Never loaded by production server or build.
import dns from 'node:dns/promises';import https from 'node:https';import {EventEmitter} from 'node:events';import {Readable} from 'node:stream';
const lookup=dns.lookup.bind(dns),request=https.request.bind(https);
dns.lookup=async(host,options)=>host==='example.org'?[{address:'93.184.216.34',family:4}]:lookup(host,options);
https.request=(url,options,callback)=>{if(url.hostname!=='example.org')return request(url,options,callback);const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{options.lookup(url.hostname,{},(error,address)=>{if(error||address!=='93.184.216.34'){req.emit('error',Error('pin missing'));return;}const res=Readable.from([Buffer.from(JSON.stringify({weather:'sunny',echo:options.headers.authorization||options.headers.Authorization||''}))]);res.statusCode=200;res.headers={'content-type':'application/json'};callback(res);});});return req;};
