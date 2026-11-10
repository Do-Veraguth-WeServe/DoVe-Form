import {staticResponse} from './static-response.mjs';
import {offeredPlan,markOfferedPlan} from './planning-offer-state.mjs';
import {Bugs} from './bugs.mjs';
import {LiveDiagnostics} from './live-diagnostics.mjs';
import {saveOwnedElement} from './owner-save.mjs';
import {replyEvidence} from './reply-evidence.mjs';
import {elementEvidence,ELEMENT_EVIDENCE_POLICY} from './element-context.mjs';
import {Forms,chatPrompt} from './forms.mjs';
import {FormSharing} from './form-sharing.mjs';
import {ElementSharing} from './element-sharing.mjs';
import {ElementStreams} from './element-stream.mjs';
import {OwnerElementStreams} from './owner-stream.mjs';
import {ConnectionVault} from './connection-vault.mjs';
import {ElementConnections} from './element-connections.mjs';
import {planningPrompt} from './blueprints.mjs';
import {HTTPConnections,httpRegistry} from './http-tools.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {systemPrompt,refineInstruction,sanitizeName,validateRender} from './contract.mjs';
import {loadModels,saveModels,validateModelInput,toPublic,isAdmin,canUseModel,publicModels,claimLegacyModels} from './models.mjs';
import {runPing,setPingBackend,validHost} from './ping.mjs';
import {Store,loadConfig} from './store.mjs';
import {ElementDB} from './db.mjs';
import {JobRunner} from './jobs.mjs';
import {MCPConnections} from './mcp.mjs';
import {ToolExecution} from './tool-execution.mjs';
import {MemoryStore} from './memory.mjs';
import {ElementActions} from './element-actions.mjs';
import {memoryRegistry} from './memory-tools.mjs';

// Form v3.2 — local server with user accounts, server-side conversations and
// per-element app databases. Binds 127.0.0.1 only (tailnet via tailscale serve).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const MODELS_FILE = process.env.FORM3_MODELS || path.join(ROOT, 'form.models.json');
const DATA_DIR = process.env.FORM3_DATA || path.join(ROOT, 'data');
const CONFIG_FILE = process.env.FORM3_CONFIG || path.join(ROOT, 'form.config.json');
const PORT = Number(process.env.PORT || 5177);
const HOST = '127.0.0.1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ORIGINS = [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, ...(process.env.FORM3_ORIGIN || '').split(',').map(s=>s.trim()).filter(Boolean)];
const COOKIE = 'form3sess';

let store;
try { store = new Store(DATA_DIR); }
catch (e) { console.error('store init failed:', e.message); process.exit(1); }
if (store.interruptedOnStart > 0)
  console.log(`[jobs] marked ${store.interruptedOnStart} interrupted job(s) as failed (server restart)`);
const forms=new Forms(store);
const formSharing=new FormSharing(store,forms);
const bugs=new Bugs(store);
const liveDiagnostics=new LiveDiagnostics(store);
const CHAT_TOTAL_MS = Number(process.env.FORM3_CHAT_TIMEOUT_MS || 0); // total job budget across BOTH rounds
const mcp=new MCPConnections(path.join(DATA_DIR,'mcp.json'));
const memory=new MemoryStore(store);
const httpConnections=new HTTPConnections(path.join(DATA_DIR,'http.json'));
const actionRegistry=httpRegistry(mcp,httpConnections);
const registry=memoryRegistry(actionRegistry,memory);
const toolExecution=new ToolExecution(store,registry);
const elementActions=new ElementActions(store,actionRegistry,toolExecution);
const runner = new JobRunner(store, {
  getForms:uid=>forms.list(uid),
  getToolContext:job=>store.getUser(job.userId)?.role==='owner'?{catalog:registry.catalog().filter(t=>!t.elementId&&(!t.name.startsWith("memory_")||memory.enabled(job.userId))),execute:(call,args,opts)=>toolExecution.execute(job,call,args,opts)}:null,
  hasToolCalls:id=>toolExecution.hasCalls(id),
  concurrency: Number(process.env.FORM3_JOB_CONCURRENCY || 2),
  perUser: Number(process.env.FORM3_JOB_PER_USER || 2),
  totalMs: CHAT_TOTAL_MS,
  // model credentials are resolved LIVE from the config file — never stored
  // in a job row and never exposed through the job API
  getModel: (id,userId) => !store.getUser(userId)?.disabled && storeModels.models.find(m => m.id === id && canUseModel(m,userId)) || null
});
function createJob(opts) { const job = store.createJob(opts); setImmediate(() => runner.enqueue(job)); return job; }
const config = loadConfig(CONFIG_FILE);
let storeModels = loadModels(MODELS_FILE);
function claimLegacy(){const owner=store.db.prepare("SELECT id FROM users WHERE role='owner' ORDER BY created_at LIMIT 1").get();if(claimLegacyModels(storeModels,owner?.id))saveModels(MODELS_FILE,storeModels);}
claimLegacy();
// Per-element app databases: ONE namespaced SQLite file (data/elements.sqlite).
// Physical tables are derived from (sessionId:elementId) hashes — guests never
// see or choose them; the /api/db handler additionally enforces user ownership.
const elementDB = new ElementDB(path.join(DATA_DIR, 'elements.sqlite'));
const elementSharing = new ElementSharing(store, elementDB);
const elementStreams = new ElementStreams(elementSharing);
const ownerStreams = new OwnerElementStreams(elementSharing);
const privateConnections=new ConnectionVault(store.db,path.join(DATA_DIR,'connection-master.key'));
const elementConnections=new ElementConnections(store,privateConnections);
const DB_RATE = Number(process.env.FORM3_DB_RATE || 120);
let bridgeHash = '';
try { bridgeHash = fs.readFileSync(path.join(DIST, 'bridge-hash.txt'), 'utf8').trim(); }
catch (e) { if (e.code !== 'ENOENT') console.error('bridge-hash.txt unreadable:', e.message); }

// Test-only deterministic resolver/exec backend (see TESTING.md). Never set in production.
if (process.env.FORM3_PING_FIXTURE === '1') setPingBackend({
  lookup: async h => {
    if (h === 'good.example') return [{ address: '93.184.216.34', family: 4 }];
    if (h === 'private.example') return [{ address: '192.168.0.5', family: 4 }];
    if (h === 'dual.example') return [{ address: '93.184.216.34', family: 4 }, { address: 'fe80::1', family: 6 }];
    throw Error('NXDOMAIN');
  },
  exec: async () => ({ err: null, stdout: '64 bytes from 93.184.216.34: icmp_seq=1 ttl=54 time=23.4 ms' })
});

const rates = new Map(), loginFails = new Map();

function reply(res, status, data, headers) { res.writeHead(status, { 'Content-Type': 'application/json', ...(headers || {}) }); res.end(JSON.stringify(data)); }
function sse(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function mergeMessages(list) { const out = []; for (const m of list) { const last = out[out.length - 1]; if (last && last.role === m.role) last.content += '\n\n' + m.content; else out.push({ role: m.role, content: m.content }); } return out; }
async function readBody(req, cap) { let bytes = 0, body = ''; for await (const chunk of req) { bytes += chunk.length; if (bytes > cap) throw Error('too large'); body += chunk; } return body; }

function cookieToken(req) {
  const h = req.headers.cookie;
  if (!h) return null;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
const sessionCookie = (req, token, maxAge) => {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}` };
};
function clientKey(req) { return String((req.headers['x-forwarded-for'] || req.socket.remoteAddress || '?').split(',')[0].trim()).slice(0, 64); }
function rate(key, max, windowMs) {
  const now = Date.now(), list = (rates.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) return false;
  rates.set(key, [...list, now]);
  return true;
}
function registrationAllowed() { return store.userCount() === 0 || config.registration; }

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'" + (bridgeHash ? " 'sha256-" + bridgeHash + "'" : "") + "; style-src 'unsafe-inline'; worker-src 'self'; connect-src 'self'; frame-src 'self' about:; img-src 'self' data:; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");

  const url = new URL(req.url, 'http://local');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/health') return reply(res, 200, { ok: true, version: 3 });

  // --- auth (public): status, register, login ---
  if (req.method === 'GET' && pathname === '/api/auth/status') {
    const sess = store.getSession(cookieToken(req));
    return reply(res, 200, { authenticated: !!sess, user: sess?.user || null, registration: registrationAllowed(), hasUsers: store.userCount() > 0 });
  }
  if (req.method === 'POST' && (pathname === '/api/auth/register' || pathname === '/api/auth/login')) {
    if (req.headers.origin !== undefined && !ORIGINS.includes(req.headers.origin)) return reply(res, 403, { error: 'Ungültiger Ursprung.' });
    if (req.headers['content-type'] !== 'application/json') return reply(res, 415, { error: 'JSON erwartet.' });
    if (!rate('auth:' + clientKey(req), 30, 60000)) { res.setHeader('Retry-After', '10'); return reply(res, 429, { error: 'Zu viele Versuche. Kurz warten.' }); }
    let d;
    try { d = JSON.parse(await readBody(req, 4000)); } catch { return reply(res, 400, { error: 'Ungültige Anfrage' }); }
    const username = typeof d.username === 'string' ? d.username.trim() : '';
    const password = typeof d.password === 'string' ? d.password : '';
    if (pathname === '/api/auth/register') {
      if (!registrationAllowed()) return reply(res, 403, { error: 'Registrierung ist deaktiviert.' });
      let user;
      try { user = store.createUser(username, password); claimLegacy(); }
      catch (e) { return reply(res, 400, { error: String(e.message || e).slice(0, 160) }); }
      console.log(`[auth] registered user=${user.username} role=${user.role}`);
      const s = store.createSession(user.id);
      return reply(res, 200, { user, csrf: s.csrf }, sessionCookie(req, s.token, 30 * 86400));
    }
    // login: failures rate-limited per username+client (10 per 5 min)
    const fkey = username.toLowerCase() + '|' + clientKey(req);
    const now = Date.now(), fails = (loginFails.get(fkey) || []).filter(t => now - t < 300000);
    if (fails.length >= 10) { res.setHeader('Retry-After', '30'); return reply(res, 429, { error: 'Zu viele fehlgeschlagene Anmeldeversuche — bitte 5 Minuten warten.' }); }
    const user = store.verifyLogin(username, password);
    if (!user) {
      loginFails.set(fkey, [...fails, now]);
      console.log(`[auth] login-fail user=${username.slice(0, 32)} client=${clientKey(req)}`);
      return reply(res, 401, { error: 'Ungültiger Benutzername oder Passwort.' });
    }
    loginFails.delete(fkey);
    console.log(`[auth] login user=${user.username}`);
    const s = store.createSession(user.id);
    return reply(res, 200, { user, csrf: s.csrf }, sessionCookie(req, s.token, 30 * 86400));
  }

  // --- static files (public, no secrets) ---
  if (req.method === 'GET' && !pathname.startsWith('/api/')) {
    const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/worker.js': 'worker.js', '/quickjs.wasm': 'quickjs.wasm', '/manifest.webmanifest': 'manifest.webmanifest', '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png', '/icon-maskable-512.png': 'icon-maskable-512.png', '/.well-known/assetlinks.json': 'assetlinks.json' };
    const file = files[pathname];
    if (!file) return reply(res, 404, { error: 'Not found' });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json' };
    try { return await staticResponse(req, res, path.join(DIST, file), types[path.extname(file)]); }
    catch { return reply(res, 503, { error: 'Datei momentan nicht verfügbar.' }); }
  }

  // --- everything below requires a session ---
  let sess;
  try { sess = store.getSession(cookieToken(req)); }
  catch { res.setHeader('Retry-After','1'); return reply(res,503,{error:'Dienst beschäftigt. Bitte neu laden.'}); }
  if (!sess) return reply(res, 401, { error: 'Anmeldung erforderlich.' });
  const user = sess.user;
  const isMutating = req.method === 'POST' || (req.method === 'DELETE' && pathname.startsWith('/api/'));
  if (isMutating) {
    if (req.headers.origin !== undefined && !ORIGINS.includes(req.headers.origin)) return reply(res, 403, { error: 'Ungültiger Ursprung.' });
    if (req.method !== 'DELETE' && req.headers['content-type'] !== 'application/json') return reply(res, 415, { error: 'JSON erwartet.' });
    if (req.headers['x-form-csrf'] !== sess.csrf) return reply(res, 403, { error: 'CSRF-Schutz fehlgeschlagen.' });
  }

  // Owner-only diagnostic transport; client observations never certify visual truth.
  if(pathname.startsWith('/api/elements/diagnostics/')){
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='POST')return reply(res,405,{error:'Methode nicht erlaubt.'});
    const operation=pathname.slice('/api/elements/diagnostics/'.length);
    if(!['start','record'].includes(operation))return reply(res,404,{error:'Nicht gefunden.'});
    if(!rate('element-diagnostics:'+user.id,30,60000))return reply(res,429,{error:'Bitte kurz warten.'});
    try{
      const d=JSON.parse(await readBody(req,2048));
      const fresh=store.getSession(cookieToken(req));
      if(!fresh||fresh.user.id!==user.id||fresh.csrf!==sess.csrf)return reply(res,401,{error:'Anmeldung erforderlich.'});
      return reply(res,200,liveDiagnostics[operation](user.id,sess.csrf,d));
    }catch(e){return reply(res,[404,409,429].includes(e.status)?e.status:400,{error:[404,409,429].includes(e.status)?e.message:'Ungültige Beobachtung.'});}
  }

  // Owner-only transport; grant recipients must use the grant-scoped routes.
  if(pathname==='/api/elements/owner/stream'||pathname==='/api/elements/owner/view'){
    res.setHeader('Cache-Control','no-store');
    if(req.method!=='GET')return reply(res,405,{error:'Methode nicht erlaubt.'});
    if(req.headers.origin!==undefined&&!ORIGINS.includes(req.headers.origin))return reply(res,403,{error:'Ungültiger Ursprung.'});
    if(!rate('owner-elements:'+user.id,60,60000))return reply(res,429,{error:'Bitte kurz warten.'});
    try{
      if(pathname.endsWith('/view'))return reply(res,200,ownerStreams.snapshot(user.id,url.searchParams.get('id')));
      const ids=url.searchParams.getAll('id');ownerStreams.check(user.id,ids);
      const opened=ownerStreams.open({uid:user.id,ids,res,sessionValid:()=>{const current=store.getSession(cookieToken(req));return current?.user.id===user.id&&current.csrf===sess.csrf;}});
      if(!opened){res.setHeader('Retry-After','5');return reply(res,429,{error:'Zu viele offene Element-Streams.'});}
      return;
    }catch{return reply(res,404,{error:'Element nicht verfügbar.'});}
  }

  // Shared-data identity always comes from the authenticated session and grant.
  // This source integration must not deploy before UI/live-sync acceptance.
  if(pathname==='/api/elements/grants'||pathname.startsWith('/api/elements/grants/')){
    res.setHeader('Cache-Control','no-store');
    if(!['GET','POST'].includes(req.method))return reply(res,405,{error:'Methode nicht erlaubt.'});
    const suffix=pathname.slice('/api/elements/grants'.length);
    if(!(req.method==='GET'?['','/view','/stream']:['/offer','/accept','/close','/state','/db','/favorite']).includes(suffix))return reply(res,404,{error:'Nicht gefunden.'});
    const dbCall=suffix==='/db';
    if(!rate((dbCall?'db:':'element-grants:')+user.id,dbCall?DB_RATE:60,60000)){
      res.setHeader('Retry-After','5');return reply(res,429,{error:'Bitte kurz warten.'});
    }
    let d;
    if(req.method==='POST'){
      try{d=JSON.parse(await readBody(req,dbCall?40000:10000));if(!d||typeof d!=='object'||Array.isArray(d))throw Error();}
      catch{return reply(res,400,{error:'Ungültige Anfrage.'});}
      // Body streaming is an await boundary: logout/disable may have occurred.
      let fresh;
      try { fresh=store.getSession(cookieToken(req)); }
      catch { res.setHeader('Retry-After','1');return reply(res,503,{error:'Dienst beschäftigt. Bitte neu laden.'}); }
      if(!fresh||fresh.user.id!==user.id||fresh.csrf!==sess.csrf)return reply(res,401,{error:'Anmeldung erforderlich.'});
    }
    try{
      if(req.method==='GET'&&suffix==='/stream'){
        if(req.headers.origin!==undefined&&!ORIGINS.includes(req.headers.origin))return reply(res,403,{error:'Ungültiger Ursprung.'});
        const id=url.searchParams.get('id');
        elementSharing.view(user.id,id); // generic404 before opening an unauthorized stream
        const opened=elementStreams.open({uid:user.id,id,res,sessionValid:()=>{
          const current=store.getSession(cookieToken(req));
          return current?.user.id===user.id&&current.csrf===sess.csrf;
        }});
        if(!opened){res.setHeader('Retry-After','5');return reply(res,429,{error:'Zu viele offene Freigaben-Streams.'});}
        return;
      }
      if(req.method==='GET')return reply(res,200,suffix==='/view'
        ?elementSharing.view(user.id,url.searchParams.get('id'))
        :elementSharing.list(user.id,{after:url.searchParams.get('after')||'',limit:Number(url.searchParams.get('limit')||20)}));
      if(suffix==='/favorite')return reply(res,200,elementSharing.favorite(user.id,d.id,d.favorite));
      if(suffix==='/offer')return reply(res,200,elementSharing.offer(user.id,d));
      if(suffix==='/accept')return reply(res,200,elementSharing.accept(user.id,d.id));
      if(suffix==='/close'){elementSharing.close(user.id,d.id);return reply(res,200,{ok:true});}
      // Never confuse the grant token with an ElementDB row id.
      const result=suffix==='/state'?elementSharing.state(user.id,d.id,d)
        :elementSharing.data(user.id,d.id,{...d,id:d.rowId});
      return reply(res,result.status,result.result);
    }catch(e){
      if([5,6].includes(e.errcode)){
        res.setHeader('Retry-After','1');return reply(res,503,{error:'Freigabe beschäftigt. Bitte neu laden.'});
      }
      // No SQL/schema/source or account-existence details in failures.
      return reply(res,404,{error:'Freigabe nicht verfügbar.'});
    }
  }

  if(pathname==='/api/element-settings'||pathname.startsWith('/api/element-settings/')){
    try{
      if(req.method==='GET'&&pathname==='/api/element-settings')return reply(res,200,elementConnections.get(user.id,url.searchParams.get('messageId')));
      if(req.method!=='POST')return reply(res,405,{error:'Methode nicht erlaubt.'});
      if(!rate('connections:'+user.id,30,60000))return reply(res,429,{error:'Bitte warten.'});
      const d=JSON.parse(await readBody(req,24000));const fresh=store.getSession(cookieToken(req));if(!fresh||fresh.user.id!==user.id||fresh.csrf!==sess.csrf)return reply(res,401,{error:'Anmeldung erforderlich.'});elementConnections.context(user.id,d.messageId);
      const action=pathname.slice('/api/element-settings'.length);
      if(action==='/save'){elementConnections.save(user.id,d.messageId,d);return reply(res,200,{ok:true});}
      if(action==='/create')return reply(res,200,{id:privateConnections.create(user.id,d)});
      if(action==='/secret'){privateConnections.replaceSecret(user.id,d.id,d.revision,d.token);return reply(res,200,{ok:true});}
      if(action==='/remove'){privateConnections.remove(user.id,d.id,d.revision);return reply(res,200,{ok:true});}
      if(action==='/test')return reply(res,200,await elementConnections.discover(user.id,d.id));
      if(action==='/call')return reply(res,200,await elementConnections.call(user.id,d.messageId,d));
      return reply(res,404,{error:'Nicht gefunden.'});
    }catch{return reply(res,400,{error:'Verbindung nicht verfügbar. Einstellungen, Freigabe und Ergebnis prüfen; Schreibaktionen nicht blind wiederholen.'});}
  }
  if(pathname==='/api/http'||pathname.startsWith('/api/http/')){
    if(user.role!=='owner')return reply(res,403,{error:'Nur Owner.'});
    try{
      if(req.method==='GET')return reply(res,200,{connections:httpConnections.publicList()});
      if(req.method==='POST'){
        if(!rate('http-config:'+user.id,30,60000))return reply(res,429,{error:'Bitte warten.'});
        const d=JSON.parse(await readBody(req,14000));
        if(pathname==='/api/http')return reply(res,200,{id:httpConnections.add(d)});
        if(pathname==='/api/http/configure')httpConnections.configure(d.id,d.enabled);
        else if(pathname==='/api/http/remove')httpConnections.remove(d.id);
        else return reply(res,404,{error:'Nicht gefunden.'});
        return reply(res,200,{ok:true});
      }
    }catch{return reply(res,400,{error:'HTTP-Konfiguration ungültig.'});}
  }
  if(pathname.startsWith('/api/element-actions')){
    if(user.role!=='owner')return reply(res,403,{error:'Nur Owner.'});
    try{
      if(req.method==='GET')return reply(res,200,{actions:elementActions.list(user.id,url.searchParams.get('messageId')),tools:actionRegistry.catalog().filter(t=>!t.elementId).map(t=>({name:t.name,label:t.connectionName+' / '+t.toolName}))});
      if(req.method==='POST'){
        if(!rate('element-action:'+user.id,20,60000))return reply(res,429,{error:'Bitte warten.'});
        const d=JSON.parse(await readBody(req,20000));
        if(pathname==='/api/element-actions/auto-run'){
          elementActions.check(user.id,d.messageId);
          const render=store.getRender(d.messageId);
          const spec=render?.actions?.find(a=>a.name===d.name);
          if(!spec)throw Error('Keine API-Deklaration.');
          const tool=httpConnections.registerElement(d.messageId,spec);
          const existing=elementActions.list(user.id,d.messageId).find(a=>a.label===spec.name&&a.tool===tool);
          const id=existing?.id||elementActions.add(user.id,{messageId:d.messageId,label:spec.name,tool,args:spec.args});
          return reply(res,200,{id,jobId:elementActions.run(user.id,id,d.inputs)});
        }
        if(pathname==='/api/element-actions/add')return reply(res,200,{id:elementActions.add(user.id,d)});
        if(pathname==='/api/element-actions/run')return reply(res,200,{jobId:elementActions.run(user.id,d.id,d.inputs)});
        if(pathname==='/api/element-actions/remove'){elementActions.remove(user.id,d.id);return reply(res,200,{ok:true});}
      }
      return reply(res,404,{error:'Nicht gefunden.'});
    }catch{return reply(res,400,{error:'Element-Aktion nicht verfügbar. Freigaben und Konfiguration prüfen.'});}
  }
  if(pathname==='/api/memory'||pathname.startsWith('/api/memory/')){
    try{
      if(req.method==='GET'&&pathname==='/api/memory')return reply(res,200,{enabled:memory.enabled(user.id),memories:memory.search(user.id,{limit:50})});
      if(req.method==='POST'){
        const d=JSON.parse(await readBody(req,6000));
        if(pathname==='/api/memory/enabled'){if(typeof d.enabled!=='boolean')throw Error();memory.setEnabled(user.id,d.enabled);return reply(res,200,{ok:true});}
        if(pathname==='/api/memory/save')return reply(res,200,{id:memory.save(user.id,d)});
        if(pathname==='/api/memory/delete'){memory.remove(user.id,d.id);return reply(res,200,{ok:true});}
        if(pathname==='/api/memory/search')return reply(res,200,{memories:memory.search(user.id,d)});
      }
      return reply(res,404,{error:'Nicht gefunden.'});
    }catch{return reply(res,400,{error:'Erinnerung konnte nicht verarbeitet werden.'});}
  }
  if(pathname==='/api/mcp'||pathname.startsWith('/api/mcp/')){
    if(user.role!=='owner')return reply(res,403,{error:'Nur Owner.'});
    try{
      if(req.method==='GET'&&pathname==='/api/mcp')return reply(res,200,{connections:mcp.publicList()});
      if(req.method==='GET'&&pathname==='/api/mcp/calls')return reply(res,200,{calls:toolExecution.list(user.id)});
      if(req.method==='POST'){
        if(!rate('mcp:'+user.id,30,60000))return reply(res,429,{error:'Bitte kurz warten.'});
        const d=JSON.parse(await readBody(req,20000));
        if(pathname==='/api/mcp'){const id=mcp.add(d);return reply(res,200,{id});}
        if(pathname==='/api/mcp/discover'){await mcp.discover(d.id);return reply(res,200,{ok:true});}
        if(pathname==='/api/mcp/configure'){mcp.configure(d.id,d);return reply(res,200,{ok:true});}
        if(pathname==='/api/mcp/decide'){if(typeof d.approve!=='boolean')throw Error('Ungültige Freigabe');toolExecution.decide(user.id,d.id,d.approve);return reply(res,200,{ok:true});}
        if(pathname==='/api/mcp/remove'){mcp.remove(d.id);return reply(res,200,{ok:true});}
      }
      return reply(res,404,{error:'Nicht gefunden.'});
    }catch{return reply(res,400,{error:'MCP-Anfrage fehlgeschlagen. Verbindung, Berechtigung und Eingaben prüfen.'});}
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    const token = cookieToken(req);
    if (token) store.deleteSession(token);
    console.log(`[auth] logout user=${user.username}`);
    return reply(res, 200, { ok: true }, sessionCookie(req, '', 0));
  }

  if (req.method === 'GET' && pathname === '/api/bootstrap') {
    const models = publicModels(storeModels.models,user);
    return reply(res, 200, { version: 3, user, csrf: sess.csrf, registration: registrationAllowed(), models });
  }
  if (req.method === 'GET' && pathname === '/api/models') {
    const models = publicModels(storeModels.models,user);
    return reply(res, 200, { models });
  }
  if (req.method === 'GET' && pathname === '/api/conversations') {
    return reply(res, 200, store.listConversations(user.id));
  }

  // --- background element jobs: snapshot + gapless event stream + cancel/retry ---
  if (req.method === 'GET' && pathname === '/api/jobs') {
    return reply(res, 200, runner.snapshot(user.id));
  }
  if (req.method === 'GET' && pathname === '/api/jobs/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive' });
    res.write(':form3-jobs\n\n');
    sse(res, 'snapshot', runner.snapshot(user.id)); // reconcile first, then live events
    const unsub = runner.subscribe(user.id, msg => {
      if (res.destroyed || !store.getSession(cookieToken(req))) { unsub();res.end(); return; }
      if (msg.kind === 'job') sse(res, 'job', msg.job);
      if(msg.kind==='stream'&&msg.event.type==='prose-chunk'){
        const job=store.getJob(msg.jobId);
        if(job&&job.userId===user.id&&['chat','plan'].includes(job.kind))sse(res,'prose',{jobId:job.id,prose:(job.prose||'').slice(0,8000)});
      } // absolute snapshots avoid duplicate chunks after reconnect
    });
    const hb = setInterval(() => { if(!store.getSession(cookieToken(req))){res.end();return;}if (!res.destroyed) res.write(':hb\n\n'); }, 15000);
    res.on('close', () => { clearInterval(hb); unsub(); });
    return;
  }
  if (req.method === 'POST' && (pathname === '/api/jobs/cancel' || pathname === '/api/jobs/retry')) {
    let d;
    try { d = JSON.parse(await readBody(req, 2000)); } catch { return reply(res, 400, { error: 'Ungültige Anfrage' }); }
    if (!UUID.test(d.jobId || '')) return reply(res, 400, { error: 'Ungültige Anfrage' });
    const job = store.getJob(d.jobId);
    if (!job || job.userId !== user.id) return reply(res, 404, { error: 'Job nicht gefunden' });
    const r = pathname === '/api/jobs/cancel' ? runner.cancel(d.jobId) : runner.retry(d.jobId);
    if (!r.ok) return reply(res, r.status, { error: r.error });
    return reply(res, 200, { ok: true, job: runner.publicJob(r.job) });
  }

  if (req.method === 'POST' && pathname === '/api/conversations') {
    let d = {};
    try { d = JSON.parse(await readBody(req, 2000)); } catch {}
    try {
      const c = store.createConversation(user.id, typeof d.title === 'string' ? d.title : undefined);
      return reply(res, 200, { conversation: c });
    } catch (e) { return reply(res, 400, { error: String(e.message || e).slice(0, 160) }); }
  }
  if (req.method === 'DELETE' && pathname.startsWith('/api/conversations/')) {
    const id = pathname.slice('/api/conversations/'.length);
    if (!UUID.test(id)) return reply(res, 400, { error: 'Ungültige ID' });
    if(store.conversationOwner(id)!==user.id)return reply(res,404,{error:'Chat nicht gefunden.'});
    for(const j of store.activeJobsForConversation(user.id,id))runner.cancel(j.id);
    const deleted = store.deleteConversation(user.id, id, elementIds => {
      for (const mid of elementIds) { try { elementDB.purge(id, mid); } catch (e) { console.error('[db] purge failed:', e.message); } }
    });
    return reply(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: 'Gedankengang nicht gefunden' });
  }

  if(pathname==='/api/bugs'||pathname==='/api/bugs/status'){
    try{
      if(req.method==='GET'&&pathname==='/api/bugs')return reply(res,200,{reports:bugs.list(user),canManage:['owner','admin'].includes(user.role)});
      if(req.method==='POST'){
        if(!rate('bugs:'+user.id,20,60000))return reply(res,429,{error:'Bitte kurz warten.'});
        if(pathname==='/api/bugs/status'&&!['owner','admin'].includes(user.role))return reply(res,403,{error:'Nur Verwaltung.'});
        const d=JSON.parse(await readBody(req,12000));
        if(pathname==='/api/bugs')return reply(res,201,{id:bugs.create(user,d)});
        bugs.update(user,d);return reply(res,200,{ok:true});
      }
      return reply(res,405,{error:'Methode nicht erlaubt.'});
    }catch(e){return reply(res,400,{error:e.message});}
  }
  if(pathname==='/api/forms'||pathname.startsWith('/api/forms/')){
    try{
      forms.seed(user.id);
      if(req.method==='GET'&&pathname==='/api/forms/copies')return reply(res,200,{offers:formSharing.list(user.id)});
      if(req.method==='GET')return reply(res,200,pathname==='/api/forms'?{forms:forms.list(user.id)}:{versions:forms.versions(user.id,url.searchParams.get('id'))});
      if(req.method==='POST'){
        if(!rate('forms:'+user.id,30,60000))return reply(res,429,{error:'Bitte kurz warten.'});
        const d=JSON.parse(await readBody(req,10000));
        if(pathname==='/api/forms/copies/element')return reply(res,200,formSharing.offerElement(user.id,d));
        if(pathname==='/api/forms/copies/offer')return reply(res,200,formSharing.offer(user.id,d));
        if(pathname==='/api/forms/copies/accept')return reply(res,200,formSharing.accept(user.id,d.id));
        if(pathname==='/api/forms/copies/close'){formSharing.close(user.id,d.id);return reply(res,200,{ok:true});}
        if(pathname==='/api/forms/accept'){
          if(store.messageOwner(d.messageId)?.userId!==user.id||!Number.isInteger(d.index)||d.index<0||d.index>1)throw Error('Vorschlag nicht gefunden.');
          const accepted=store.db.prepare('SELECT form_id FROM form_acceptances WHERE message_id=? AND proposal_index=?').get(d.messageId,d.index);if(accepted)return reply(res,200,{ok:true,formId:accepted.form_id});
          const row=store.db.prepare('SELECT forms FROM messages WHERE id=?').get(d.messageId);const proposal=JSON.parse(row.forms||'{}').edits?.[d.index];if(!proposal)throw Error('Vorschlag nicht gefunden.');
          store.db.exec('BEGIN');try{const f=forms.save(user.id,proposal,'assistant-confirmed');store.db.prepare('INSERT INTO form_acceptances VALUES (?,?,?)').run(d.messageId,d.index,f.id);store.db.exec('COMMIT');return reply(res,200,{ok:true,formId:f.id});}catch(e){store.db.exec('ROLLBACK');throw e;}
        }
        if(pathname==='/api/forms/state'){
          forms.updateCardState(user.id,d.messageId,d.index,d.state);return reply(res,200,{ok:true});
        }
        if(pathname==='/api/forms/save')return reply(res,200,{form:forms.save(user.id,d)});
        if(pathname==='/api/forms/restore')return reply(res,200,{form:forms.restore(user.id,d.id,d.revision)});
        if(pathname==='/api/forms/remove'){forms.remove(user.id,d.id);return reply(res,200,{ok:true});}
      }
      return reply(res,404,{error:'Nicht gefunden.'});
    }catch(e){return reply(res,400,{error:String(e.message).slice(0,160)});}
  }
  if(req.method==='POST'&&pathname==='/api/admin/users/action'){
    if(!isAdmin(user))return reply(res,403,{error:'Nur Owner/Admin.'});
    try{
      const d=JSON.parse(await readBody(req,4000));const target=store.getUser(d.id);
      if(!target)return reply(res,404,{error:'Benutzer nicht gefunden.'});
      if(target.id===user.id||target.role==='owner'||user.role==='admin'&&target.role!=='user')return reply(res,403,{error:'Dieses Konto ist geschützt.'});
      if(!rate('user-action:'+user.id,20,60000))return reply(res,429,{error:'Bitte kurz warten.'});
      if(d.action==='reset'){store.resetPassword(target.username,d.password);}
      else if(d.action==='role'){
        if(user.role!=='owner'||!['admin','user'].includes(d.role))return reply(res,403,{error:'Rollenänderung nicht erlaubt.'});
        store.db.prepare('UPDATE users SET role=? WHERE id=?').run(d.role,target.id);store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      }else if(d.action==='disable'){
        if(typeof d.disabled!=='boolean')throw Error('Ungültiger Status.');
        store.db.prepare('UPDATE users SET disabled=? WHERE id=?').run(d.disabled?1:0,target.id);
        if(d.disabled){store.db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);for(const c of store.listConversations(target.id).conversations)for(const j of store.activeJobsForConversation(target.id,c.id))runner.cancel(j.id);}
      }else if(d.action==='delete'){
        if(d.confirm!==target.username)throw Error('Benutzernamen zur Bestätigung eingeben.');
        for(const c of store.listConversations(target.id).conversations){for(const j of store.activeJobsForConversation(target.id,c.id))runner.cancel(j.id);store.deleteConversation(target.id,c.id,ids=>{for(const mid of ids)elementDB.purge(c.id,mid);});}
        const next={...storeModels,models:storeModels.models.filter(m=>m.ownerId!==target.id)};saveModels(MODELS_FILE,next);storeModels=next;
        store.db.prepare('DELETE FROM users WHERE id=?').run(target.id);
      }else throw Error('Unbekannte Aktion.');
      return reply(res,200,{ok:true});
    }catch(e){return reply(res,400,{error:String(e.message).slice(0,160)});}
  }
  if(pathname==='/api/admin/users'){
    if(!isAdmin(user))return reply(res,403,{error:'Nur Owner/Admin.'});
    if(req.method==='GET')return reply(res,200,{users:store.db.prepare('SELECT id,username,role,disabled,created_at FROM users ORDER BY created_at').all()});
    if(req.method==='POST'){
      if(!rate('user-create:'+user.id,20,60000))return reply(res,429,{error:'Bitte kurz warten.'});
      try{
        const d=JSON.parse(await readBody(req,4000));const role=d.role??'user';
        if(!['user','admin'].includes(role)||role==='admin'&&user.role!=='owner')return reply(res,403,{error:'Diese Rolle darfst du nicht vergeben.'});
        if(store.userCount()>=200)return reply(res,400,{error:'Maximal 200 Benutzer.'});
        const created=store.createUser(String(d.username||'').trim(),d.password,role);
        return reply(res,200,{user:created});
      }catch(e){return reply(res,400,{error:String(e.message||'Benutzer nicht erstellt.').slice(0,160)});}
    }
  }
  if (req.method === 'POST' && pathname === '/api/models') {
    if(!rate('model-config:'+user.id,30,60000))return reply(res,429,{error:'Bitte kurz warten.'});
    try {
      const d = JSON.parse(await readBody(req, 10000));
      const v = validateModelInput(d);
      if(storeModels.models.filter(m=>m.ownerId===user.id).length>=20)throw Error('Maximal 20 eigene Modelle.');
      if(d.shared===true&&!isAdmin(user))return reply(res,403,{error:'Nur Owner/Admin können Modelle teilen.'});
      const publicOnly=!isAdmin(user)&&process.env.FORM3_ALLOW_LOCAL_MODELS!=='1';
      if(publicOnly){const u=new URL(v.baseUrl);if(u.protocol!=='https:'||u.port&&u.port!=='443')throw Error('Öffentliche HTTPS-Provider erforderlich.');}
      const entry = { id: crypto.randomUUID(), ...v, ownerId:user.id, shared:isAdmin(user)&&d.shared===true, publicOnly, added: new Date().toISOString() };
      storeModels.models.push(entry);
      saveModels(MODELS_FILE, storeModels);
      return reply(res, 200, { models: publicModels(storeModels.models,user) });
    } catch (e) { return reply(res, 400, { error: 'Modell nicht gespeichert: ' + String(e.message || e).slice(0, 160) }); }
  }
  if(req.method==='POST'&&pathname==='/api/models/share'){
    if(!isAdmin(user))return reply(res,403,{error:'Nur Owner/Admin können Modelle teilen.'});
    try{
      const d=JSON.parse(await readBody(req,2000));if(typeof d.shared!=='boolean')throw Error('Ungültige Freigabe.');
      const m=storeModels.models.find(m=>m.id===d.id&&m.ownerId===user.id);if(!m)return reply(res,404,{error:'Eigenes Modell nicht gefunden.'});
      m.shared=d.shared;saveModels(MODELS_FILE,storeModels);return reply(res,200,{models:publicModels(storeModels.models,user)});
    }catch(e){return reply(res,400,{error:String(e.message||e).slice(0,120)});}
  }
  if (req.method === 'DELETE' && pathname.startsWith('/api/models/')) {
    const id = pathname.slice('/api/models/'.length);
    if (!UUID.test(id)) return reply(res, 400, { error: 'Ungültige ID' });
    const m=storeModels.models.find(m=>m.id===id);
    if(!m||m.ownerId!==user.id)return reply(res,404,{error:'Eigenes Modell nicht gefunden.'});
    storeModels.models=storeModels.models.filter(m=>m.id!==id);
    saveModels(MODELS_FILE, storeModels);
    return reply(res, 200, { models: publicModels(storeModels.models,user) });
  }

  // element state persistence (ui.persist) and full-render replacement
  // (code editor / version restore) — only for the owning user's element
  if (req.method === 'POST' && pathname === '/api/state') {
    let d;
    try { d = JSON.parse(await readBody(req, 100000)); } catch { return reply(res, 400, { error: 'Ungültige Anfrage' }); }
    if (!d || typeof d!=='object' || Array.isArray(d) || !UUID.test(d.messageId || '')) return reply(res,400,{error:'Ungültige Anfrage'});
    res.setHeader('Cache-Control','no-store');
    // The upload may outlive logout/disable. Recheck before touching an Element.
    let fresh;
    try { fresh=store.getSession(cookieToken(req)); }
    catch { res.setHeader('Retry-After','1');return reply(res,503,{error:'Dienst beschäftigt. Bitte neu laden.'}); }
    if(!fresh||fresh.user.id!==user.id||fresh.csrf!==sess.csrf)return reply(res,401,{error:'Anmeldung erforderlich.'});
    try {
      const result=saveOwnedElement(store,user.id,d.messageId,d);
      return reply(res,result.status,result.result);
    } catch(e) {
      if([5,6].includes(e.errcode)){res.setHeader('Retry-After','1');return reply(res,503,{error:'Dienst beschäftigt. Bitte neu laden.'});}
      return reply(res,403,{error:'Element nicht verfügbar oder Zustand ungültig.'});
    }
  }

  if (req.method === 'POST' && pathname === '/api/pin') {
    let d;
    try { d = JSON.parse(await readBody(req, 4000)); } catch { return reply(res, 400, { error: 'Ungültige Anfrage' }); }
    if (!UUID.test(d.messageId || '') || typeof d.pinned !== 'boolean') return reply(res, 400, { error: 'Ungültige Anfrage' });
    try { store.setPinned(user.id, d.messageId, d.pinned); return reply(res, 200, { ok: true }); }
    catch (e) { return reply(res, 400, { error: String(e.message || e).slice(0, 120) }); }
  }

  // import of previously exported/local archives — ids are regenerated server-side
  if (req.method === 'POST' && pathname === '/api/import') {
    let d;
    try { d = JSON.parse(await readBody(req, 2000000)); } catch { return reply(res, 400, { error: 'Ungültiges Archiv' }); }
    try {
      const created = store.importSessions(user.id, d);
      console.log(`[import] user=${user.username} conversations=${created.length}`);
      return reply(res, 200, { created: created.length, conversations: store.listConversations(user.id) });
    } catch (e) { return reply(res, 400, { error: 'Import fehlgeschlagen: ' + String(e.message || e).slice(0, 160) }); }
  }

  // --- element app databases (ui.db): structured ops only, user-scoped server-side ---
  if (req.method === 'POST' && pathname === '/api/db') {
    let d;
    try { d = JSON.parse(await readBody(req, 40000)); } catch { return reply(res, 400, { error: 'Ungültige Anfrage' }); }
    if (!UUID.test(d.sessionId || '') || !UUID.test(d.elementId || ''))
      return reply(res, 400, { error: 'Ungültige DB-Anfrage' });
    // element must be an assistant message with render in THIS conversation of THIS user
    const owner = store.messageOwner(d.elementId);
    if (!owner || owner.userId !== user.id || owner.conversationId !== d.sessionId || !owner.hasRender) {
      console.log(`[db] denied user=${user.username} element=${String(d.elementId).slice(0, 8)}…`);
      return reply(res, 403, { error: 'Element nicht gefunden.' });
    }
    if (!rate('db:' + user.id, DB_RATE, 60000)) { res.setHeader('Retry-After', '5'); return reply(res, 429, { error: 'DB-Limit erreicht.' }); }
    const r = elementDB.op({ sessionId: d.sessionId, elementId: d.elementId, op: d.op, table: d.table, columns: d.columns, row: d.row, query: d.query, id: d.id, patch: d.patch });
    if (r.status !== 200) console.log(`[db] user=${user.username} element=${d.elementId.slice(0, 8)}… op=${d.op} table=${d.table} -> ${r.status} ${String(r.result?.error || '').slice(0, 60)}`);
    return reply(res, r.status, {...r.result,...(r.writeRevision?{ownerDbWrite:r.writeRevision}:{})});
  }

  if (req.method === 'POST' && pathname === '/api/ping') {
    let d;
    try { d = JSON.parse(await readBody(req, 2000)); } catch { return reply(res, 400, { ok: false, error: 'Ungültige Anfrage' }); }
    const host = typeof d.host === 'string' ? d.host.slice(0, 253) : '';
    if (!UUID.test(d.sessionId || '') || !validHost(host)) return reply(res, 400, { ok: false, error: 'Ungültiger Host.' });
    if (!rate('ping:' + user.id, 10, 60000)) { res.setHeader('Retry-After', '5'); return reply(res, 429, { ok: false, error: 'Ping-Limit erreicht (10/Minute).' }); }
    const { status, result } = await runPing({ host, sessionId: d.sessionId });
    return reply(res, status, result);
  }

  if(req.method==='POST'&&pathname==='/api/blueprints/execute'){
    try{
      const b=JSON.parse(await readBody(req,3000));
      if(!UUID.test(b.sessionId||'')||!UUID.test(b.blueprintId||'')||!Number.isInteger(b.revision))return reply(res,400,{error:'Ungültiger Blueprint.'});
      if(store.conversationOwner(b.sessionId)!==user.id)return reply(res,404,{error:'Blueprint nicht gefunden.'});
      const bp=store.latestBlueprint(b.sessionId);
      if(!bp||bp.id!==b.blueprintId||bp.revision!==b.revision)return reply(res,409,{error:'Der Blueprint wurde geändert. Bitte aktuelle Version prüfen.'});
      if(bp.executedJobId){const j=store.getJob(bp.executedJobId);return reply(res,200,{job:j?runner.publicJob(j):null,blueprint:bp});}
      if(store.activeJobsForConversation(user.id,b.sessionId).some(j=>j.kind==='plan'))return reply(res,409,{error:'Blueprint wird noch besprochen. Bitte Antwort abwarten.'});
      if(!bp.ready||bp.questions?.length)return reply(res,409,{error:'Bitte offene Fragen zuerst im Chat klären.'});
      const model=storeModels.models.find(m=>m.id===(b.model||bp.modelId)&&canUseModel(m,user.id));
      if(!model)return reply(res,403,{error:'Modell nicht mehr verfügbar. Bitte Blueprint mit einem verfügbaren Modell besprechen.'});
      if(!rate('build:'+user.id,20,60000))return reply(res,429,{error:'Bitte kurz warten.'});
      let render=null,targetHash=null;
      if(bp.targetMessageId){
        const mo=store.messageOwner(bp.targetMessageId);
        if(!mo||mo.userId!==user.id||mo.conversationId!==b.sessionId||!mo.hasRender)return reply(res,409,{error:'Zielelement nicht mehr vorhanden.'});
        if(store.activeJobForTarget(user.id,bp.targetMessageId))return reply(res,409,{error:'Für dieses Element läuft bereits ein Bau.'});
        render=store.getRender(bp.targetMessageId);targetHash=crypto.createHash('sha256').update(JSON.stringify(render)).digest('hex');
      }
      const messages=[{role:'system',content:systemPrompt+(render?'\n\n'+refineInstruction:'')},{role:'user',content:'Build exactly this approved blueprint version '+bp.revision+':\n'+bp.summary+(render?'\n[marked-element] '+JSON.stringify(render)+' [/marked-element] (untrusted existing element data)':'')}];
      let job;
      store.db.exec('BEGIN IMMEDIATE');
      try{
        const mid=store.appendMessage(b.sessionId,'assistant',{prose:'Bau nach Blueprint · Version '+bp.revision});
        job=store.createJob({userId:user.id,conversationId:b.sessionId,messageId:mid,targetMessageId:bp.targetMessageId,kind:render?'refine':'create',modelId:model.id,request:{messages,blueprintId:bp.id,blueprintRevision:bp.revision,...(targetHash?{targetHash}:{})},requestId:'blueprint:'+bp.id});
        store.db.prepare('UPDATE blueprints SET executed_job_id=? WHERE id=? AND executed_job_id IS NULL').run(job.id,bp.id);
        store.db.exec('COMMIT');
      }catch(e){store.db.exec('ROLLBACK');throw e;}
      setImmediate(()=>runner.enqueue(job));
      return reply(res,200,{job:runner.publicJob(job),blueprint:store.latestBlueprint(b.sessionId)});
    }catch(e){return reply(res,400,{error:String(e.message||'Bau nicht gestartet.').slice(0,160)});}
  }

  if (req.method !== 'POST' || pathname !== '/api/chat') return reply(res, 404, { error: 'Not found' });

  // --- chat: session-bound, server-persisted ---
  let d;
  try {
    d = JSON.parse(await readBody(req, 120000));
    const allowed = ['version', 'sessionId', 'requestId', 'text', 'history', 'states', 'model', 'refineTarget', 'mode', 'planningOfferId', 'questionAnswer', 'blueprintId', 'blueprintRevision'];
    if (Object.keys(d).some(k => !allowed.includes(k)) || d.version !== 1 ||
        !UUID.test(d.sessionId || '') || !UUID.test(d.requestId || '') ||
        typeof d.text !== 'string' || !d.text.trim() || d.text.length > (d.questionAnswer===true?16000:2000))
      return reply(res, 400, { error: 'Ungültige Anfrage' });
    if(d.planningOfferId!==undefined&&(d.mode!=='plan'||!UUID.test(d.planningOfferId)))return reply(res,400,{error:'Ungültiges Planangebot.'});
    if(d.questionAnswer!==undefined&&d.questionAnswer!==true)return reply(res,400,{error:'Ungültige Formularantwort.'});
    if(d.blueprintId!==undefined&&(!UUID.test(d.blueprintId)||!Number.isInteger(d.blueprintRevision)))return reply(res,400,{error:'Ungültiger Blueprint.'});
    if(d.mode!==undefined&&!['chat','plan'].includes(d.mode))return reply(res,400,{error:'Ungültiger Modus.'});
    if (d.history != null && (!Array.isArray(d.history) || d.history.length > 12 ||
        d.history.some(m => !m || typeof m !== 'object' || Array.isArray(m) ||
          !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content || m.content.length > 4000)))
      return reply(res, 400, { error: 'Ungültiger Verlauf' });
    if (d.states != null && (!Array.isArray(d.states) || d.states.length > 3 || JSON.stringify(d.states).length > 12500 ||
        d.states.some(s => !s || typeof s.id !== 'string' || s.id.length > 64 || !s.state || typeof s.state !== 'object' || Array.isArray(s.state))))
      return reply(res, 400, { error: 'Ungültige Zustände' });
    if ('refineTarget' in d) {
      const t = d.refineTarget;
      if (!t || typeof t !== 'object' || Array.isArray(t) || !UUID.test(t.id || '') ||
          typeof t.html !== 'string' || t.html.length > 32000 ||
          typeof t.css !== 'string' || t.css.length > 12000 ||
          typeof t.js !== 'string' || t.js.length > 32000 ||
          JSON.stringify(t.state ?? null) === 'null' || typeof t.state !== 'object' || Array.isArray(t.state) ||
          JSON.stringify(t.state).length > 4096)
        return reply(res, 400, { error: 'Ungültiges Verfeinerungsziel' });
    }
  } catch { return reply(res, 400, { error: 'Ungültige Anfrage' }); }

  // conversation and refine target must belong to this user
  if (store.conversationOwner(d.sessionId) !== user.id) return reply(res, 403, { error: 'Ungültige Sitzung.' });
  if (d.refineTarget) {
    const mo = store.messageOwner(d.refineTarget.id);
    if (!mo || mo.userId !== user.id || mo.conversationId !== d.sessionId || !mo.hasRender)
      return reply(res, 403, { error: 'Ungültiges Verfeinerungsziel' });
  }

  const availableModels=storeModels.models.filter(m=>canUseModel(m,user.id));
  if ('model' in d && !availableModels.some(m => m.id === d.model)) return reply(res, 400, { error: 'Unbekanntes oder nicht freigegebenes Modell' });
  const model = availableModels.find(m => m.id === d.model) || availableModels[0];
  if (!model) return reply(res, 400, { error: 'Noch kein Modell konfiguriert. Öffne die Einstellungen (⚙) und füge ein Modell hinzu.' });

  // NOTE: no per-user "one running chat" lock anymore — generation runs in
  // server-owned jobs with bounded concurrency; a second message is answered
  // while the first turn's provider call is still streaming.
  if (!rate('chat:' + user.id, 30, 60000)) { res.setHeader('Retry-After', '5'); return reply(res, 429, { error: 'Zu viele Nachrichten — kurz warten.' }); }

  // idempotency: (userId, requestId) uniquely identifies a job — a resubmit
  // (retrying browser, double click, reconnect) REPLAYS the existing job
  // instead of duplicating the expensive provider generation
  const existing = store.findJobByRequest(user.id, d.requestId);
  if (existing && existing.conversationId !== d.sessionId) return reply(res, 409, { error: 'Anfrage-ID gehört bereits zu einem anderen Gespräch.' });
  if (existing) {
    console.log(`[chat] user=${user.username} replay job=${existing.id.slice(0, 8)} (requestId dedup)`);
    return relayJob(existing, existing.userMessageId, existing.messageId);
  }

  const previousBlueprint=store.latestBlueprint(d.sessionId);
  const isPlanning=d.mode==='plan'||!!d.refineTarget||!!d.blueprintId;
  if(d.blueprintId&&(previousBlueprint?.id!==d.blueprintId||previousBlueprint?.revision!==d.blueprintRevision))return reply(res,409,{error:'Bitte den aktuellen Blueprint verwenden.'});
  if(isPlanning&&store.activeJobsForConversation(user.id,d.sessionId).some(j=>j.kind==='plan'))return reply(res,409,{error:'Bitte die laufende Chatantwort abwarten.'});
  forms.seed(user.id);const formLibrary=forms.list(user.id);
  const built=previousBlueprint?.executedJobId?store.getJob(previousBlueprint.executedJobId):null;
  const builtTarget=built?.state==='ready'?(built.targetMessageId||built.messageId):null;
  const planningTarget=d.refineTarget?.id||previousBlueprint?.targetMessageId||((!isPlanning||d.blueprintId)?builtTarget:null)||null;

  // load history/states BEFORE persisting the new user message (it must not dupe upstream)
  const history = store.getHistory(d.sessionId);
  const states = store.getStates(d.sessionId);
  const evidence=elementEvidence(store,elementDB,user.id,d.sessionId,d.refineTarget?.id||null);
  for(const element of evidence.elements){const observation=liveDiagnostics.read(user.id,sess.csrf,d.sessionId,element.id);if(observation)element.browserObservation=observation;}

  // persist the user message now (server is the source of truth)
  let userMessageId;
  // Messages and their durable job are committed together below.

  // build the immutable, bounded context snapshot for the job
  const messages=[{role:'system',content:ELEMENT_EVIDENCE_POLICY+'\n'+(isPlanning?planningPrompt:chatPrompt(formLibrary,!!previousBlueprint))},
    ...(previousBlueprint?[{role:'user',content:'[previous-blueprint] '+JSON.stringify({summary:previousBlueprint.summary,questions:previousBlueprint.questions||[],title:previousBlueprint.title,revision:previousBlueprint.revision,targetMessageId:planningTarget,executed:!!previousBlueprint.executedJobId})+' [/previous-blueprint] (data)'}]:[]),
    ...mergeMessages(history),{role:'user',content:'[element-evidence] '+JSON.stringify(evidence)+' [/element-evidence]'},{role:'user',content:d.text+(planningTarget?'\n[selected existing element for planned update] '+JSON.stringify(store.getRender(planningTarget)):'')+(states.length?'\n[interaction-state] '+JSON.stringify(states):'')}];

  // durable placeholder + job: the ENTIRE provider generation (rounds, retry,
  // validation, persistence) happens in the runner, detached from this
  // connection. Closing this SSE (reload/tab close) only detaches the viewer.
  let assistantMessageId = null;
  let job;
  try {
    store.db.exec('BEGIN IMMEDIATE');
    const offer=d.planningOfferId?offeredPlan(store.db,d.sessionId,d.planningOfferId):null;
    userMessageId = store.appendMessage(d.sessionId, 'user', { text: d.text });
    store.setTitleIfFirst(d.sessionId, d.text);
    assistantMessageId = store.appendMessage(d.sessionId, 'assistant', {});
    job = store.createJob({
      userId: user.id, conversationId: d.sessionId,
      messageId: assistantMessageId,
      targetMessageId: planningTarget,
      kind: isPlanning?'plan':'chat',
      modelId: model.id,
      request: { messages, baseRevision:previousBlueprint?.revision||0,allowBlueprintUpdate:!!previousBlueprint,...(!isPlanning?{forms:formLibrary.map(({template,...f})=>f),replyEvidence:replyEvidence(evidence)}:{}) },
      requestId: d.requestId, userMessageId
    });
    if(offer)markOfferedPlan(store.db,d.sessionId,d.planningOfferId,offer,job.id);
    store.db.exec('COMMIT');
  } catch (e) {
    try { store.db.exec('ROLLBACK'); } catch {}
    return reply(res, 400, { error: 'Antwort konnte nicht gestartet werden: ' + String(e.message || e).slice(0, 120) });
  }
  setImmediate(() => runner.enqueue(job));
  console.log(`[chat] user=${user.username} conv=${d.sessionId.slice(0, 8)} job=${job.id.slice(0, 8)} kind=${job.kind}`);
  return relayJob(job, userMessageId, assistantMessageId);

  // shared relay: streams a job's live events to THIS connection while open;
  // the job itself keeps running (and persists) with zero subscribers.
  function relayJob(job, userMessageId, assistantMessageId) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'Connection': 'keep-alive' });
  res.write(':form3\n\n');
  sse(res, 'element-job', { job: runner.publicJob(job) });

  let finished = false;
  const finish = extra => {
    if (finished) return;
    finished = true;
    try {
      if (extra) sse(res, extra.event, extra.data);
      sse(res, 'done', { requestId: d.requestId, userMessageId, assistantMessageId, jobId: job.id });
    } catch {}
    try { res.end(); } catch {}
    unsub();
    clearInterval(hb);
  };
  const unsub = runner.subscribe(user.id, msg => {
    if (finished || res.destroyed) { unsub(); return; }
    if(!store.getSession(cookieToken(req))){finish();return;}
    if (msg.kind === 'stream' && msg.jobId === job.id) {
      sse(res, msg.event.type, msg.event.type === 'prose-chunk' ? { text: msg.event.text } :
        msg.event.type === 'retry' ? { code: msg.event.code, reason: msg.event.reason } : {});
    } else if (msg.kind === 'job' && msg.job.id === job.id) {
      const j = msg.job;
      if (j.state === 'ready') {
        if (j.render) sse(res, 'render', { render: j.render });
        if (j.error) sse(res, 'error', { message: j.error });
        finish();
      } else if (j.state === 'failed') {
        sse(res, 'error', { message: j.error || 'Antwort fehlgeschlagen.', code: 'job' });
        finish();
      } else if (j.state === 'cancelled') {
        sse(res, 'error', { message: 'Abgebrochen.', code: 'cancelled' });
        finish();
      }
    }
  });
  const hb = setInterval(() => { if (!res.destroyed) res.write(':hb\n\n'); else finish(); }, 15000);
  res.on('close', () => finish()); // viewer detach only — the job continues
  // job may have reached a terminal state before this subscriber attached
  // (render/prose travel via the emitted events, never via the job row)
  const cur2 = store.getJob(job.id);
  if (cur2 && !['queued', 'building', 'validating'].includes(cur2.state)) {
    if (cur2.state === 'ready') finish();
    else if (cur2.state === 'failed') { sse(res, 'error', { message: cur2.error || 'Antwort fehlgeschlagen.', code: 'job' }); finish(); }
    else if (cur2.state === 'cancelled') { sse(res, 'error', { message: 'Abgebrochen.', code: 'cancelled' }); finish(); }
  }
  }
});

server.requestTimeout = 300000;
server.headersTimeout = 10000;
server.listen(PORT, HOST, () => console.log(`Form v3.3 ready on http://${HOST}:${PORT} (data: ${DATA_DIR}, models: ${MODELS_FILE}, ${storeModels.models.length} model(s), ${store.userCount()} user(s), registration: ${registrationAllowed() ? 'on' : 'off'})`));

// Optional private proxy ingress; retain loopback for Tailscale Serve.
if(process.env.FORM3_EXTRA_HOST){
  const host=process.env.FORM3_EXTRA_HOST;
  if(host==='0.0.0.0'||host==='::')throw Error('Wildcard proxy binding is not allowed');
  const proxyServer=http.createServer(server.listeners('request')[0]);
  proxyServer.requestTimeout=server.requestTimeout;
  proxyServer.headersTimeout=server.headersTimeout;
  proxyServer.listen(PORT,host,()=>console.log('Form private proxy ingress ready on '+host+':'+PORT));
}
