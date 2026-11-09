// Recipient-side discoverability: pending shared elements badge (isolated fixture).
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {chromium} from 'playwright-core';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'form-shared-badge-')),BASE='http://127.0.0.1:4793';
const {Store}=await import('../store.mjs');
const {elementCodeRevision}=await import('../element-sharing.mjs');
const s=new Store(dir);const owner=s.createUser('owner','password123');s.createUser('bob','password123');
const conv=s.createConversation(owner.id);
const mid=s.appendMessage(conv.id,'assistant',{render:{version:1,name:'Badge-Karte',html:'<p id="hi">Hallo</p>',css:'p{color:#eee}',js:'',state:{}}});
const revision=elementCodeRevision(s.getRender(mid));s.close();
const app=spawn('node',['server.mjs'],{env:{...process.env,PORT:'4793',FORM3_DATA:dir,FORM3_MODELS:path.join(dir,'models.json')},stdio:['ignore','pipe','inherit']});
const api=async(p,body,sess)=>fetch(BASE+p,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:BASE,Cookie:sess?.cookie||'','X-Form-CSRF':sess?.csrf||''},body:body===undefined?undefined:JSON.stringify(body)});
const login=async u=>{const r=await api('/api/auth/login',{username:u,password:'password123'});assert.equal(r.status,200);const x=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:x.csrf};};
let b;try{
 await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error('startup')),15000);app.stdout.on('data',d=>{if(String(d).includes('ready')){clearTimeout(t);res();}});});
 const o=await login('owner');
 assert.equal((await api('/api/elements/grants/offer',{messageId:mid,revision,recipient:'bob'},o)).status,200);
 b=await chromium.launch({executablePath:'/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',headless:true,args:['--no-sandbox']});
 // recipient: badge appears right after login, without opening anything
 const rb=await b.newContext({viewport:{width:1280,height:900}});const p=await rb.newPage();
 await p.goto(BASE);
 await p.locator('#loginform [name=username]').fill('bob');await p.locator('#loginform [name=password]').fill('password123');await p.locator('#loginform button').click();
 await p.locator('.session-open[aria-current=true]').waitFor();
 await p.locator('#elements-tab[data-shared-pending="1"]').waitFor();
 assert.match(await p.locator('#elements-tab').getAttribute('aria-label'),/Freigabe wartet/);
 // discover and accept through the sidebar
 await p.locator('#elements-tab').click();
 await p.locator('#shared-elements-button[data-pending="1"]').waitFor();
 await p.locator('#shared-elements-button').click();
 await p.getByText('Annahme ausstehend').waitFor();
 await p.getByRole('button',{name:'Annehmen',exact:true}).click();
 await p.locator('#shared-elements-button[data-pending=""]').waitFor();
 await p.locator('#elements-tab[data-shared-pending=""]').waitFor();
 await p.getByRole('button',{name:'Gemeinsam öffnen',exact:true}).waitFor();
 await p.screenshot({path:'docs/screenshots/shared-badge.png'});
 await p.reload();await p.locator('.session-open[aria-current=true]').waitFor();await p.locator('#whoami').filter({hasText:'bob'}).waitFor();
 await p.locator('#elements-tab[data-shared-pending=""]').waitFor();
 await rb.close();
 // owner: outgoing pending must not badge the owner
 const ob=await b.newContext({viewport:{width:1280,height:900}});const q=await ob.newPage();
 await q.goto(BASE);
 await q.locator('#loginform [name=username]').fill('owner');await q.locator('#loginform [name=password]').fill('password123');await q.locator('#loginform button').click();
 await q.locator('.session-open[aria-current=true]').waitFor();await q.locator('#whoami').filter({hasText:'owner'}).waitFor();
 await q.locator('#elements-tab[data-shared-pending=""]').waitFor();
 await ob.close();
 console.log('PASS shared badge: recipient sees waiting dot on Elemente + Geteilte after login; Annehmen clears it; reload stays cleared; owner outgoing does not badge');
}finally{await b?.close();app.kill();await new Promise(r=>app.exitCode!==null?r():app.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
