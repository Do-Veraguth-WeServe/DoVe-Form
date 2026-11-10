import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Only call for the server's public static-file allowlist. Never API/user data.
// Revalidation on EVERY use avoids stale unversioned app/worker/WASM URLs.
// Hash the same bytes we send, including after an atomic deployment replacement.
export async function staticResponse(req,res,file,type) {
 let body;
 try {body=await readFile(file)} catch(e) {
  if(e.code!=='ENOENT') throw e;
  res.writeHead(404,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify({error:'Not found'}));return;
 }
 const etag='"'+createHash('sha256').update(body).digest('hex')+'"';
 res.setHeader('Content-Type',type);
 res.setHeader('Cache-Control','public, no-cache');
 res.setHeader('ETag',etag);
 const match=String(req.headers['if-none-match']||'').split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag);
 if(match){res.writeHead(304);res.end();return}
 res.setHeader('Content-Length',body.length);res.writeHead(200);res.end(body);
}
