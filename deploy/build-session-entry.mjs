import fs from 'node:fs';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';
const original=p=>execFileSync('git',['show','dc8d7fc:'+p],{encoding:'utf8'});
const renderer=original('src/renderer.js');assert.ok(renderer===fs.readFileSync('/opt/form/src/renderer.js','utf8'),'renderer source drift');
async function bundle(baseline){return (await build({entryPoints:['src/app.js'],bundle:true,outdir:'dist',format:'esm',platform:'browser',minify:false,write:false,plugins:[{name:'scope-release',setup(b){b.onLoad({filter:/\/src\/renderer\.js$/},()=>({contents:renderer,loader:'js',resolveDir:process.cwd()+'/src'}));if(baseline)b.onLoad({filter:/\/src\/session-entry\.js$/},()=>({contents:original('src/session-entry.js'),loader:'js',resolveDir:process.cwd()+'/src'}));}}]})).outputFiles[0].text;}
const normalize=s=>s.replaceAll('../form/node_modules/','node_modules/');
assert.ok(normalize(await bundle(true))===normalize(fs.readFileSync('/opt/form/dist/app.js','utf8')),'baseline bundle differs: stop and reconcile');
fs.writeFileSync('dist/app.js',await bundle(false));console.log('Exact installed baseline verified; candidate differs only in session-entry helper.');
