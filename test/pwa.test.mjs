import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';

// PWA shell contract: build wires registration + versioned service worker,
// the server serves /sw.js revalidation-safe (no-cache + ETag), and the SW
// precaches exactly the static shell while never intercepting /api/*.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-pwa-'));
const base='http://127.0.0.1:4779';let app;
async function get(route){const r=await fetch(base+route);return {status:r.status,type:r.headers.get('content-type'),cache:r.headers.get('cache-control'),etag:r.headers.get('etag'),body:await r.text()};}
try{
  const appjs=fs.readFileSync('dist/app.js','utf8'),sw=fs.readFileSync('dist/sw.js','utf8');
  assert.match(appjs,/serviceWorker\.register\((['"])\/sw\.js\1\)/,'app.js registers /sw.js');
  assert.ok(!sw.includes('__FORM_SHELL_VERSION__'),'SW version placeholder is replaced at build time');
  assert.ok(sw.includes('form-shell-'),'SW uses a content-versioned cache name');
  const quotedIn=(s,v)=>s.includes("'"+v+"'")||s.includes('"'+v+'"');
  assert.ok(quotedIn(sw,'/api/'),'SW explicitly skips /api/* (user data stays uncached)');
  assert.ok(quotedIn(sw,'/'),'SW precaches / (shell entry)');
  for(const f of ['app.js','worker.js','animation-verification.js','quickjs.wasm','manifest.webmanifest','icon-192.png','icon-512.png','icon-maskable-512.png'])
    assert.ok(quotedIn(sw,'/'+f),'SW precaches /'+f);

  app=spawn('node',['server.mjs'],{env:{...process.env,PORT:'4779',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json'),FORM3_CONFIG:path.join(dir,'config.json')},stdio:['ignore','pipe','inherit']});
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('startup')),10000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);resolve();}});app.once('exit',()=>{clearTimeout(t);reject(Error('early exit'));});});

  const swr=await get('/sw.js');
  assert.equal(swr.status,200,'/sw.js is served');
  assert.match(swr.type,/text\/javascript/,'correct MIME type');
  assert.match(swr.cache,/no-cache/,'always revalidated (updates reach clients)');
  assert.ok(swr.etag,'ETag present');

  const manifest=await get('/manifest.webmanifest');
  assert.equal(manifest.status,200,'manifest is served');
  assert.match(manifest.type,/application\/manifest\+json/,'manifest MIME type');
  assert.ok(JSON.parse(manifest.body).name,'manifest is valid JSON');

  const root=await get('/');
  assert.equal(root.status,200,'shell served at /');
  assert.match(root.type,/text\/html/);

  const revalidate=await fetch(base+'/sw.js',{headers:{'if-none-match':swr.etag}});
  assert.equal(revalidate.status,304,'ETag revalidation works for /sw.js');

  console.log('pwa shell test ok');
}catch(e){console.error(e);process.exitCode=1;}
finally{if(app)app.kill();fs.rmSync(dir,{recursive:true,force:true});}
