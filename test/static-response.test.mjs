import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {staticResponse} from '../static-response.mjs';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v},writeHead(status,h={}){this.status=status;Object.assign(this.headers,h)},end(body){this.body=body}}}
test('content validators invalidate same-size replacements and allow weak/list/wildcard GET comparisons',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'form-validator-')),file=path.join(dir,'app.js');
 try {
  await fs.writeFile(file,'old');const first=response();await staticResponse({headers:{}},first,file,'text/javascript');assert.equal(first.status,200);
  const tag=first.headers.ETag;
  for(const value of [tag,'W/'+tag,'"unrelated", W/'+tag,'*']){const r=response();await staticResponse({headers:{'if-none-match':value}},r,file,'text/javascript');assert.equal(r.status,304);assert.equal(r.body,undefined);assert.equal(r.headers.ETag,tag)}
  await fs.writeFile(path.join(dir,'next'),'new');await fs.rename(path.join(dir,'next'),file);
  const next=response();await staticResponse({headers:{'if-none-match':tag}},next,file,'text/javascript');assert.equal(next.status,200);assert.notEqual(next.headers.ETag,tag);assert.equal(next.body.toString(),'new');assert.equal(next.headers['Content-Length'],3);
  const absent=response();await staticResponse({headers:{'if-none-match':'*'}},absent,path.join(dir,'missing'),'text/javascript');assert.equal(absent.status,404);assert.equal(absent.headers['Cache-Control'],'no-store');assert.equal(absent.headers.ETag,undefined);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
