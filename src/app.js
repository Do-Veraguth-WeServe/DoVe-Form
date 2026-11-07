import {elementTimeline} from './element-timeline.js';
import {planFold} from './plan-fold.js';
import {renderMarkdown} from './markdown.js';
import {formCard,initFormsUI} from './forms-ui.js';
import {renderUI} from './renderer.js';
import {safeHTML,safeCSS} from './sanitize.js';
import {validateRender,deriveName,sanitizeName} from '../contract.mjs';
const $=s=>document.querySelector(s),uid=()=>crypto.randomUUID(),KEY='form.v3';
let db={version:4,sessions:[],elements:{pins:[],versions:{}},current:null},csrf='',me=null,registrationOpen=false,models=[],modelId=localStorage.getItem('form3.model')||'',pending=new Set(),views=[],marked=null;
let legacyDb=null;          // pre-login local archive — offered for import on first login
const stateSync=new Map();  // messageId -> debounce timer for /api/state
let jobs=new Map();         // jobId -> job (server-owned element builds; transient client mirror)
let jobStream=null;        // EventSource for /api/jobs/stream
let sendFinishing=false;   // send() completing its turn — suppress duplicate renders
const liveTurns=new Map(); // request -> live <article>: detached turns may stream for a long
// time (server-owned generation); other renders (a second message, background
// job events) must not destroy a still-streaming live view
const current=()=>db.sessions.find(s=>s.id===db.current);

// --- scroll preservation: submitting or a background element must never
// jump the viewport to the top (or force it to the end). We anchor on the
// topmost visible message and restore its position after re-renders.
function scrollState(){
  // exact anchor: the topmost visible message and its pixel offset — submits,
  // stream growth and element completion must not move the viewport AT ALL
  // (including at the bottom: content grows below, the view stays put).
  const f=$('#feed');if(!f)return null;
  const fr=f.getBoundingClientRect();
  const frac=f.scrollHeight>f.clientHeight?f.scrollTop/(f.scrollHeight-f.clientHeight):0;
  for(const el of f.querySelectorAll('.message[data-mid]')){
    const r=el.getBoundingClientRect();
    if(r.bottom>fr.top+2)
      return {anchor:el.dataset.mid,offset:r.top-fr.top,frac,top:f.scrollTop};
  }
  return {anchor:null,frac,top:f.scrollTop};
}
function restoreScroll(st){
  const f=$('#feed');if(!f||!st)return;
  const go=top=>{try{f.scrollTo({top,behavior:'instant'})}catch{f.scrollTop=top}};
  if(st.anchor){
    const el=f.querySelector('.message[data-mid="'+st.anchor+'"]');
    if(el){const fr=f.getBoundingClientRect();go(el.getBoundingClientRect().top-fr.top+f.scrollTop-st.offset);return}
  }
  // anchor fell out of the rendered window (last-12): restore by fraction
  if(st.frac!=null&&f.scrollHeight>f.clientHeight){go(st.frac*(f.scrollHeight-f.clientHeight));return}
  go(st.top!=null?st.top:f.scrollTop);
}
function renderPreservingScroll(){const st=scrollState();render();restoreScroll(st)}
function toast(t){$('#live').textContent=t;const n=document.createElement('div');n.className='toast';n.textContent=t;document.body.append(n);setTimeout(()=>n.remove(),4000)}
function trimVersions(){
  try{
    const vkeys=Object.keys(db.elements?.versions||{});
    if(!vkeys.length)return;
    while(JSON.stringify(db).length>3000000){
      if(!vkeys.length)break;
      const k=vkeys[0],list=db.elements.versions[k];
      list.shift();
      if(!list.length){delete db.elements.versions[k];vkeys.shift()}
    }
  }catch{}
}
// localStorage is a CACHE now — the server (SQLite) is the source of truth.
function save(){try{trimVersions();localStorage.setItem(KEY,JSON.stringify(db))}catch{}}

// --- schema: version 4 adds elements {pins, versions}; version 3 archives migrate lazily ---
function normalize(x){
  if(!x||![3,4].includes(x.version)||!Array.isArray(x.sessions)||x.sessions.length>40)throw Error('Ungültiges Archiv');
  const sessions=x.sessions.map(s=>{
    if(typeof s.id!=='string'||!/^[0-9a-f-]{36}$/.test(s.id)||typeof s.title!=='string'||!Array.isArray(s.messages)||s.messages.length>100)throw Error('Ungültige Sitzung');
    return {id:s.id,title:s.title.slice(0,80),messages:s.messages.map(m=>{
      const mid=(typeof m.id==='string'&&/^[0-9a-f-]{36}$/.test(m.id))?m.id:uid(); // stable ids: pins/versions hang off them
      if(m.role==='user'&&typeof m.text==='string')return {role:'user',id:mid,text:m.text.slice(0,2000)};
      if(m.role==='assistant'){
        if(typeof m.error==='string')return {role:'assistant',id:mid,error:m.error.slice(0,300)};
        const prose=typeof m.prose==='string'?m.prose.slice(0,8000):'';
        if(m.render)return {role:'assistant',id:mid,prose,render:validateRender(m.render)};
        if(prose)return {role:'assistant',id:mid,prose};
      }
      throw Error('Ungültige Nachricht');
    })};
  });
  const ids=new Set();
  for(const s of sessions)for(const m of s.messages)if(m.render)ids.add(m.id);
  let pins=[],versions={};
  if(x.version===4&&x.elements&&typeof x.elements==='object'&&!Array.isArray(x.elements)){
    if(Array.isArray(x.elements.pins))pins=[...new Set(x.elements.pins.filter(p=>typeof p==='string'&&p.length<64))].slice(0,40);
    const v=x.elements.versions;
    if(v&&typeof v==='object'&&!Array.isArray(v))for(const[k,list]of Object.entries(v)){
      if(typeof k!=='string'||k.length>64||!Array.isArray(list))continue;
      const clean=list.filter(e=>e&&typeof e==='object'&&e.render)
        .map(e=>{try{return {at:typeof e.at==='string'?e.at.slice(0,30):'',render:validateRender(e.render)}}catch{return null}})
        .filter(Boolean).slice(-5);
      if(clean.length)versions[k]=clean;
    }
  }
  pins=pins.filter(p=>ids.has(p));
  for(const k of Object.keys(versions))if(!ids.has(k))delete versions[k];
  return {version:4,current:x.current,sessions,elements:{pins,versions}};
}
try{legacyDb=normalize(JSON.parse(localStorage.getItem(KEY)))}catch{legacyDb=null}

// --- boot: session check, then login screen or app ---
async function boot(){
  let st={authenticated:false,registration:false};
  try{const r=await fetch('/api/auth/status');if(r.ok)st=await r.json();}catch{}
  registrationOpen=st.registration===true;
  if(st.authenticated){me=st.user;await enter();}
  else showLogin();
}
function showLogin(err){
  const dlg=$('#login');if(!dlg)return;
  $('#regform').classList.add('hidden');
  $('#loginform').classList.remove('hidden');
  $('#switchreg').classList.toggle('hidden',!registrationOpen);
  const le=$('#loginerr');le.textContent=err||'';le.classList.toggle('hidden',!err);
  dlg.showModal?.();
  $('#loginform [name=username]')?.focus();
}
async function authPost(path,body){
  const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const t=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(t.error||('HTTP '+r.status));
  return t;
}
$('#loginform').onsubmit=async e=>{
  e.preventDefault();
  const f=e.target;
  $('#loginerr').classList.add('hidden');
  try{const t=await authPost('/api/auth/login',{username:f.username.value.trim(),password:f.password.value});me=t.user;csrf=t.csrf;$('#login').close();f.reset();await enter();}
  catch(err){$('#loginerr').textContent=err.message;$('#loginerr').classList.remove('hidden')}
};
$('#regform').onsubmit=async e=>{
  e.preventDefault();
  const f=e.target;
  $('#loginerr').classList.add('hidden');
  if(f.password.value!==f.password2.value){$('#loginerr').textContent='Passwörter stimmen nicht überein.';$('#loginerr').classList.remove('hidden');return}
  try{const t=await authPost('/api/auth/register',{username:f.username.value.trim(),password:f.password.value});me=t.user;csrf=t.csrf;$('#login').close();f.reset();await enter();}
  catch(err){$('#loginerr').textContent=err.message;$('#loginerr').classList.remove('hidden')}
};
$('#switchreg').onclick=e=>{e.preventDefault();$('#loginform').classList.toggle('hidden');$('#regform').classList.toggle('hidden');};
$('#logout').onclick=async()=>{
  try{await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:'{}'})}catch{}
  me=null;csrf='';models=[];
  disconnectJobs();
  try{localStorage.removeItem(KEY)}catch{}
  location.reload();
};

// --- server data -> local cache shape ---
function fromServer(data){
  const pins=[];const versions=data.versions||{};
  // reconcile background jobs (snapshot is the server's truth)
  jobs=new Map((data.jobs||[]).map(j=>[j.id,j]));
  const sessions=(data.conversations||[]).map(c=>({
    id:c.id,title:String(c.title||'').slice(0,80),blueprint:c.blueprint||null,
    messages:(c.messages||[]).map(m=>{
      const o={id:m.id,role:m.role};
      if(typeof m.text==='string')o.text=m.text;
      if(typeof m.prose==='string')o.prose=m.prose;
      if(typeof m.error==='string')o.error=m.error;
      if(m.forms)o.forms=m.forms;
      if(m.renderPositionId)o.renderPositionId=m.renderPositionId;
      if(m.render)o.render=validateRender(m.render);
      if(m.pinned&&m.render)pins.push(m.id);
      return o;
    })
  }));
  return {version:4,current:sessions.length?sessions[0].id:null,sessions,elements:{pins,versions}};
}
async function loadFromServer(){
  try{
    const r=await fetch('/api/conversations');
    if(r.status===401){me=null;csrf='';showLogin('Sitzung abgelaufen — bitte erneut anmelden.');return false}
    if(!r.ok)return false;
    db=fromServer(await r.json());
    if(!current()&&db.sessions.length)db.current=db.sessions[0].id;
    save();
    return true;
  }catch{return false}
}
async function enter(){
  await refreshModels();
  const ok=await loadFromServer();
  if(!ok)return;
  connectJobs();
  if(!db.sessions.length){
    await newSession();
  } else render();
}
// --- element helpers ---
const elementName=m=>m.render.name||deriveName(m.render,m.prose);
const isPinned=m=>db.elements.pins.includes(m.id);
function pushVersion(m,render){
  const list=db.elements.versions[m.id]||(db.elements.versions[m.id]=[]);
  list.push({at:new Date().toISOString(),render:JSON.parse(JSON.stringify(render))});
  while(list.length>5)list.shift();
}
function scheduleStateSync(id,state){
  clearTimeout(stateSync.get(id));
  stateSync.set(id,setTimeout(()=>{
    stateSync.delete(id);
    if(!csrf)return;
    fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify({messageId:id,state})}).catch(()=>{});
  },600));
}
function syncRender(m){ // full render replaced locally (code editor / version restore) -> server
  fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify({messageId:m.id,render:m.render})}).catch(()=>toast('Speichern auf dem Server fehlgeschlagen.'));
}
function togglePin(m){
  const i=db.elements.pins.indexOf(m.id);
  const pin=i===-1;
  if(pin)db.elements.pins.push(m.id);else db.elements.pins.splice(i,1);
  save();
  fetch('/api/pin',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify({messageId:m.id,pinned:pin})})
    .then(r=>{if(!r.ok)throw 0})
    .catch(()=>{if(pin)db.elements.pins.splice(db.elements.pins.indexOf(m.id),1);else db.elements.pins.push(m.id);save();render();toast('Anpinnen fehlgeschlagen.')});
}
function markInfo(){
  if(!marked||marked.sessionId!==db.current)return null;
  const m=current()?.messages.find(x=>x.id===marked.msgId);
  return m&&m.render?m:null;
}
function toggleMark(id){
  const m=current()?.messages.find(x=>x.id===id);
  if(!m||!m.render)return;
  marked=(marked&&marked.msgId===id)?null:{sessionId:db.current,msgId:id};
  render();
  if(marked)$('#prompt').focus();
}
function clearMark(){if(marked){marked=null;render()}}

// --- background element jobs: construction site + event stream ---
const CRANE='<rect x="6" y="88" width="208" height="5" rx="2" fill="#495153"/><g class="scaffold"><rect x="141" y="46" width="4" height="42" fill="#687374"/><rect x="195" y="46" width="4" height="42" fill="#687374"/><rect x="138" y="60" width="64" height="4" fill="#687374"/></g><rect class="block b1" x="148" y="74" width="43" height="13" rx="2"/><rect class="block b2" x="148" y="59" width="43" height="13" rx="2"/><rect class="block b3" x="148" y="44" width="43" height="13" rx="2"/><g class="craneg"><rect x="36" y="19" width="12" height="69" rx="2" fill="#d4ad54"/><rect x="24" y="83" width="36" height="6" rx="2" fill="#b58a36"/><rect x="17" y="13" width="176" height="9" rx="2" fill="#e4be63"/><rect x="12" y="21" width="22" height="16" rx="2" fill="#778385"/><rect x="48" y="23" width="18" height="16" rx="3" fill="#d4ad54"/><rect x="51" y="26" width="12" height="8" rx="1" fill="#344b57"/><g class="trolley"><rect x="113" y="22" width="10" height="6" rx="2" fill="#8c6c2e"/><path class="cable" d="M118 28V50" stroke="#bbc4c3" stroke-width="2"/><rect class="load" x="103" y="50" width="30" height="13" rx="2"/></g></g>';
const SITE_PHASE={queued:'in Warteschlange …',building:'baut …',validating:'prüft das Ergebnis …'};
function activityEl(writing=false,jobId){
  const d=document.createElement('div');d.className='activity planning';d.dataset.phase=writing?'writing':'thinking';if(jobId)d.dataset.jobid=jobId;d.setAttribute('role','status');
  const dots=document.createElement('span');dots.className='activity-dots';dots.setAttribute('aria-hidden','true');
  for(let i=0;i<3;i++){const dot=document.createElement('i');dot.className='activity-dot';dots.append(dot)}
  const label=document.createElement('span');label.className='activity-label';label.textContent=writing?'Form antwortet …':'Form denkt mit …';d.append(dots,label);return d;
}
function setActivityWriting(d){if(!d||d.dataset.phase==='writing')return;d.dataset.phase='writing';d.querySelector('.activity-label').textContent='Form antwortet …';}
function siteEl(job){
  if(['plan','chat'].includes(job?.kind)&&['queued','building','validating'].includes(job.state))return activityEl(!!job.prose,job.id);
  if(['plan','chat'].includes(job?.kind)){const p=document.createElement('p');p.className='notice planning';p.textContent=job.state==='failed'?(job.error||'Planung fehlgeschlagen.'):'Form denkt mit …';if(job.state==='failed'){const b=document.createElement('button');b.textContent='Erneut besprechen';b.onclick=()=>jobAction('retry',job.id);p.append(b)}return p;}
  const d=document.createElement('div');d.className='site'+(job&&job.state==='failed'?' failed':job&&job.state==='cancelled'?' cancelled':'');
  if(job)d.dataset.jobid=job.id;
  d.setAttribute('role','status');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 220 96');svg.setAttribute('class','crane');svg.setAttribute('aria-hidden','true');
  svg.innerHTML=CRANE;
  const meta=document.createElement('div');meta.className='sitemeta';
  const l1=document.createElement('span');l1.className='sitelabel';l1.textContent=(job&&job.kind==='refine'?'Wird aktualisiert':'Wird gebaut')+(job?.blueprintRevision?' · Planversion '+job.blueprintRevision:'');
  const l2=document.createElement('span');l2.className='sitephase';
  meta.append(l1,l2);
  if(job&&['queued','building','validating'].includes(job.state)){
    l2.textContent=SITE_PHASE[job.state]||'…';
    const c=document.createElement('button');c.type='button';c.textContent='Abbrechen';
    c.setAttribute('aria-label','Elementbau abbrechen');c.onclick=()=>jobAction('cancel',job.id);
    meta.append(c);
  }else if(job&&job.state==='failed'){
    l2.textContent=job.error||'Fehlgeschlagen.';
    const r=document.createElement('button');r.type='button';r.textContent='Erneut versuchen';
    r.onclick=()=>jobAction('retry',job.id);
    meta.append(r);
  }else if(job&&job.state==='cancelled'){
    l2.textContent='Abgebrochen.';
  }else l2.textContent='baut …';
  d.append(svg,meta);
  return d;
}
function pendingJobFor(msgId){
  const candidates=[...jobs.values()].filter(j=>j.state!=='ready').sort((a,b)=>Number(b.rev)-Number(a.rev));
  return candidates.find(j=>j.messageId===msgId)||candidates.find(j=>j.kind==='refine'&&j.targetMessageId===msgId&&(!j.messageId||ACTIVE_JOB.includes(j.state)))||null;
}
const ACTIVE_JOB=['queued','building','validating'];
function applyJob(job,opts){
  if(job?.blueprint){const s=db.sessions.find(s=>s.id===job.conversationId);if(s&&(!s.blueprint||s.blueprint.revision<=job.blueprint.revision))s.blueprint=job.blueprint;}
  if(!job||!job.id)return;
  if(job.kind==='action')return;
  if(job.kind==='plan'&&ACTIVE_JOB.includes(job.state)){const b=document.querySelector('.blueprint-execute');if(b)b.disabled=true;}
  const rerender=opts?opts.rerender!==false:true;
  const prev=jobs.get(job.id);
  if(prev&&Number(prev.rev)===Number(job.rev)&&typeof job.prose==='string')prev.prose=job.prose; // prose checkpoints do not increment the state revision
  if(prev&&Number(prev.rev)>=Number(job.rev)&&prev.state!=='queued'&&job.state!=='ready')return; // stale event
  const wasActive=prev&&ACTIVE_JOB.includes(prev.state);
  jobs.set(job.id,job);
  if(job.state!=='ready'){
    if(!prev){
      // first sighting mid-turn: bind the live view in place — no re-render
      // (re-rendering would tear down every sandbox worker)
      const liveSite=document.querySelector('.message.live .site:not([data-jobid])');
      if(liveSite){liveSite.replaceWith(siteEl(job));return}
      if(document.querySelector('.message.live'))return; // prose phase: nothing to show yet
    }else if(wasActive&&ACTIVE_JOB.includes(job.state)&&(prev.phase||'prose')===(job.phase||'prose')){
      // cosmetic state change (queued→building→validating): patch text only
      const ph=document.querySelector('.site[data-jobid="'+job.id+'"] .sitephase');
      if(ph)ph.textContent=SITE_PHASE[job.state]||'…';
      return;
    }else if(wasActive&&ACTIVE_JOB.includes(job.state)&&(prev.phase||'prose')!==(job.phase||'prose')){
      // phase flip prose→artifact during a live turn: bind the site in place.
      // The job event may race ahead of the SSE artifact-start — NEVER
      // re-render here (it would destroy the live message mid-stream).
      const liveSite=document.querySelector('.message.live .site:not([data-jobid])');
      if(liveSite){liveSite.replaceWith(siteEl(job));return}
      if(document.querySelector('.message.live'))return;
    }
    if(job.state==='cancelled'){
      const c=current();
      if(c&&c.id===job.conversationId){
        const m=c.messages.find(x=>x.id===job.messageId);
        if(m){m.error='Abgebrochen.';if(job.prose)m.prose=String(job.prose).slice(0,8000)}
      }
      jobs.delete(job.id);save();
    }
  }
  if(job.state==='ready'){
    const s=current();
    if(s&&s.id===job.conversationId&&attachReadyJob(s,job)){jobs.delete(job.id);save()}
    else jobs.set(job.id,job); // ready before its message exists locally — reconcile() applies it
  }
  if(rerender&&!sendFinishing)renderPreservingScroll(); // send()'s single closing render covers it
}
function attachReadyJob(s,job){
  const target=s.messages.find(m=>m.id===(job.kind==='refine'?job.targetMessageId:job.messageId));
  if(!target)return false;
  if(job.forms)target.forms=job.forms;
  if(!job.render){ // prose-only turn: finish the placeholder message
    target.prose=String(job.prose||'');
    if(job.error)target.error=job.error;
    return true;
  }
  try{
    const render=validateRender(job.render);
    if(job.kind==='refine'){pushVersion(target,target.render);target.render=render;if(job.messageId){target.renderPositionId=job.messageId;const anchor=s.messages.find(m=>m.id===job.messageId);if(anchor){anchor.prose=String(job.prose||'');delete anchor.error;}}marked=null;toast('Element aktualisiert.')}
    else{target.render=render;if(job.prose)target.prose=String(job.prose).slice(0,8000);if(target.error)delete target.error}
    return true;
  }catch{return false}
}
function reconcileReadyJobs(){
  const s=current();if(!s)return;
  let changed=false;
  for(const j of [...jobs.values()]){
    if(j.state!=='ready')continue;
    if(attachReadyJob(s,j)){jobs.delete(j.id);changed=true}
  }
  if(changed)save();
}
async function jobAction(kind,id){
  try{
    const r=await fetch('/api/jobs/'+kind,{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify({jobId:id})});
    const t=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(t.error||('HTTP '+r.status));
    applyJob(t.job);
  }catch(e){toast((kind==='cancel'?'Abbrechen':'Erneut versuchen')+' fehlgeschlagen: '+e.message)}
}
let recoveryInFlight=null;
function recoverCompletedTurns(ids){
  for(const r of [...pending])if(ids.has(r.jobId)){
    pending.delete(r);liveTurns.delete(r);r.controller.abort();
  }
  busy(pending.size>0);
  if(!recoveryInFlight)recoveryInFlight=syncFromServer().finally(()=>{recoveryInFlight=null});
  return recoveryInFlight;
}
function connectJobs(){
  if(!me||jobStream)return;
  try{
    jobStream=new EventSource('/api/jobs/stream');
    jobStream.addEventListener('snapshot',e=>{try{
      const list=(JSON.parse(e.data).jobs||[]).filter(j=>j.kind!=='action');
      const present=new Set(list.map(j=>j.id));
      const missing=new Set([...jobs.values()].filter(j=>ACTIVE_JOB.includes(j.state)&&!present.has(j.id)).map(j=>j.id));
      for(const r of pending)if(r.jobId&&!present.has(r.jobId))missing.add(r.jobId);
      if(missing.size){void recoverCompletedTurns(missing);return}
      let touched=false;
      for(const j of list){const known=jobs.has(j.id);applyJob(j,{rerender:false});if(!known||j.state==='ready'||j.state==='failed'||j.state==='cancelled')touched=true}
      if(touched||list.length)renderPreservingScroll();
    }catch{}});
    jobStream.addEventListener('job',e=>{try{
      const j=JSON.parse(e.data);
      if(!ACTIVE_JOB.includes(j.state)&&[...pending].some(r=>r.jobId===j.id)){
        void recoverCompletedTurns(new Set([j.id]));
      }else applyJob(j);
    }catch{}});
    jobStream.addEventListener('prose',e=>{try{
      const data=JSON.parse(e.data),job=jobs.get(data.jobId);
      if(!job||!['chat','plan'].includes(job.kind)||!ACTIVE_JOB.includes(job.state)||typeof data.prose!=='string')return;
      job.prose=data.prose.slice(0,8000);
      if([...pending].some(r=>r.jobId===job.id))return; // live POST relay owns this turn
      const indicator=document.querySelector('.activity[data-jobid="'+job.id+'"]');if(!indicator)return;
      const article=indicator.closest('.message'),st=scrollState();let p=article.querySelector('.prose');
      if(!p){p=document.createElement('div');article.insertBefore(p,indicator)}p.className='prose writing';renderMarkdown(p,job.prose);if(job.prose)setActivityWriting(indicator);restoreScroll(st);
    }catch{}});
    jobStream.onerror=()=>{ // auth lost or stream failed: reconnect with fresh snapshot
      try{jobStream.close()}catch{}
      jobStream=null;
      if(me)setTimeout(connectJobs,3000);
    };
  }catch{}
}
function disconnectJobs(){try{jobStream&&jobStream.close()}catch{}jobStream=null;jobs=new Map()}
// (sketchEl removed: live phases are the growing ⌑ wireframe + construction site)
function busy(on){$('#stop').classList.toggle('hidden',!on)}
// NOTE: the send button stays visible while turns run — detached generation
// allows further messages before an earlier answer finishes.
async function stopAll(){await stop()}
async function stop(){
  if(!pending.size)return;
  const jobs=[...pending].map(r=>r.jobId).filter(Boolean);
  for(const r of pending)r.controller.abort(); // detach viewers only
  pending=new Set();busy(false);
  if(jobs.length){for(const id of jobs)await jobAction('cancel',id)} // the real stop: cancels the server jobs + provider calls
  else toast('Antwort gestoppt.');
  await syncFromServer();
}
async function syncFromServer(){if(await loadFromServer())renderPreservingScroll()}
async function deleteChat(s){
  if(!confirm('Chat „'+s.title+'“ mit allen Nachrichten und Elementen endgültig löschen?'))return;
  try{
    const r=await fetch('/api/conversations/'+s.id,{method:'DELETE',headers:{'X-Form-CSRF':csrf}});
    if(!r.ok)throw Error((await r.json()).error||'Löschen fehlgeschlagen.');
    for(const req of [...pending])if(req.conversationId===s.id){pending.delete(req);req.controller.abort();liveTurns.delete(req);}
    for(const [id,j]of jobs)if(j.conversationId===s.id)jobs.delete(id);
    if(db.current===s.id){closeOverlay();db.current=null;marked=null;}
    db.sessions=db.sessions.filter(c=>c.id!==s.id);busy(pending.size>0);
    if(!db.current)db.current=db.sessions[0]?.id||null;
    if(!db.current)await newSession();else {await loadFromServer();save();render();}
    toast('Chat gelöscht.');
  }catch(e){toast(e.message||'Chat konnte nicht gelöscht werden.');}
}
async function newSession(){
  if(pending.size)await stopAll();
  closeOverlay();
  if(db.sessions.length>=40)return toast('Maximal 40 Gedankengänge');
  try{
    const r=await fetch('/api/conversations',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:'{}'});
    const t=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(t.error||('HTTP '+r.status));
    const s={id:t.conversation.id,title:t.conversation.title||'Neuer Gedankengang',messages:[]};
    db.sessions.unshift(s);db.current=s.id;marked=null;save();render();
    $('#sidebar').classList.remove('open');
  }catch(e){toast('Neuer Gedankengang fehlgeschlagen: '+e.message)}
}
function updateComposer(){
  const has=models.length>0;
  $('#send').disabled=!has;
  const who=me?String(me.username).slice(0,12):'';
  $('#statuslabel').textContent=!me?'NICHT ANGEMELDET':(has?('ANGEMELDET · '+who.toUpperCase()):'KEIN MODELL');
  $('#prompt').placeholder=has?'Nachricht …':'Zuerst ein Modell hinzufügen (⚙ oben rechts)';
  $('#mcpbtn').classList.toggle('hidden',me?.role!=='owner');
  $('#usersbtn').classList.toggle('hidden',!['owner','admin'].includes(me?.role));
  $('#whoami').textContent=me?(me.username+(me.role==='owner'?' · Owner':'')):'';
}

let sidebarTab='chats';
function renderElementList(){
  const list=$('#elements-list');list.replaceChildren();
  for(const s of db.sessions)for(const m of s.messages){
    if(!m.render||!isPinned(m))continue;
    const b=document.createElement('button');b.textContent=elementName(m);b.title=s.title;b.dataset.mid=m.id;
    b.onclick=()=>{db.current=s.id;marked=null;save();renderPreservingScroll();$('#sidebar').classList.remove('open');openOverlay(m)};
    list.append(b);
  }
  if(!list.children.length){const n=document.createElement('small');n.textContent='Mit ★ gespeicherte Elemente';list.append(n)}
  list.classList.toggle('hidden',sidebarTab!=='elements');
  $('#sessions').classList.toggle('hidden',sidebarTab!=='chats');
  $('#elements-tab').setAttribute('aria-selected',String(sidebarTab==='elements'));
  $('#chats-tab').setAttribute('aria-selected',String(sidebarTab==='chats'));
}
$('#elements-tab').onclick=()=>{sidebarTab='elements';renderElementList()};
$('#chats-tab').onclick=()=>{sidebarTab='chats';renderElementList()};

function renderQuickbar(){
  const bar=$('#quickbar');if(!bar)return;
  bar.replaceChildren();
  const s=current();
  const els=s?s.messages.filter(m=>m.render&&isPinned(m)):[];
  if(!els.length){bar.classList.add('hidden');return}
  bar.classList.remove('hidden');
  for(const m of els){
    const c=document.createElement('button');c.type='button';c.className='qchip';
    c.textContent='⌑ '+elementName(m);
    c.setAttribute('aria-label','Element öffnen: '+elementName(m));
    c.onclick=()=>openOverlay(m);
    bar.append(c);
  }
}
function renderChip(){
  const chip=$('#refchip');if(!chip)return;
  const m=markInfo();
  chip.replaceChildren();
  if(!m){chip.classList.add('hidden');return}
  chip.classList.remove('hidden');
  const l=document.createElement('span');l.textContent='✎ Bearbeite: '+elementName(m);
  const x=document.createElement('button');x.type='button';x.textContent='✕';x.setAttribute('aria-label','Markierung aufheben');x.onclick=clearMark;
  chip.append(l,x);
}

// Keep the visible history start stable while a conversation is open.
// Rotating a last-12 window on submit removes content above the viewport.
const visibleStarts=new Map();
function render(){  views.forEach(v=>v.destroy());views=[];
  $('#sessions').replaceChildren();
  for(const s of db.sessions){
    const row=document.createElement('div');row.className='session-row';row.dataset.sid=s.id;
    const b=document.createElement('button');b.className='session-open';b.textContent=s.title;b.setAttribute('aria-current',s.id===db.current);b.onclick=async()=>{await stop();closeOverlay();db.current=s.id;marked=null;save();render();$('#sidebar').classList.remove('open')};
    const del=document.createElement('button');del.className='session-delete';del.type='button';del.textContent='×';del.setAttribute('aria-label','Chat löschen: '+s.title);del.title='Chat löschen';del.onclick=()=>deleteChat(s);
    row.append(b,del);$('#sessions').append(row);
  }
  const feed=$('#feed');
  feed.innerHTML=current()?.messages.length?'':'<section class="intro"><h1>Was möchtest du machen?</h1></section>';
  if(!models.length)feed.insertAdjacentHTML('beforeend','<section class="empty" id="emptystate"><h2>Modell verbinden</h2><button id="emptyadd">Modell hinzufügen</button></section>');
  const s=current();
  if(s){
    if(!visibleStarts.has(s.id))visibleStarts.set(s.id,Math.max(0,s.messages.length-12));
    const visibleStart=Math.min(visibleStarts.get(s.id),s.messages.length);
    if(visibleStart>0){const h=document.createElement('p');h.className='notice';h.textContent='Ältere Nachrichten ausgeblendet.';feed.append(h)}
    for(const entry of elementTimeline(s.messages,[...jobs.values()].filter(j=>j.conversationId===s.id)).slice(visibleStart)){
      const m=entry.message;
      const article=document.createElement('article');article.className='message '+(m.role==='user'?'user':'assistant');article.dataset.mid=m.id;
      if(m.role==='user'){const b=document.createElement('div');b.className='bubble';b.textContent=m.text;article.append(b)}
      else{
        article.innerHTML='<div class="byline">Form</div>';
        if(m.error&&!['queued','building','validating'].includes(pendingJobFor(m.id)?.state)){const n=document.createElement('div');n.className='notice error';n.textContent=m.error;article.append(n);const failed=pendingJobFor(m.id);if(failed?.messageId===m.id&&failed.state==='failed')article.append(siteEl(failed));}
        else{
          const turnJob=pendingJobFor(m.id);const answering=['plan','chat'].includes(turnJob?.kind)&&ACTIVE_JOB.includes(turnJob.state);const turnProse=answering?(turnJob.prose||m.prose):m.prose;
          if(turnProse){const p=document.createElement('div');p.className='prose'+(answering?' writing':'');renderMarkdown(p,turnProse);article.append(p)}
          if(m.forms){for(const f of m.forms.items||[]){if(f.layout==='custom'&&f.template){const view=renderUI({...f.template,state:{...f.template.state,...f.data}},{onSuggest:fillSuggestion,onError:toast,onState:state=>{f.data=state;save();uiRequest('/api/forms/state',{messageId:m.id,index:m.forms.items.indexOf(f),state}).catch(e=>toast(e.message));}});views.push(view);article.append(view.element,formsUI.copyStateButton(f,m.id,m.forms.items.indexOf(f)));}else article.append(formCard(f,{suggest:fillSuggestion}));}for(const e of m.forms.edits||[])article.append(formsUI.proposal(e,m.id,m.forms.edits.indexOf(e)));}
          const job=pendingJobFor(entry.element?.id||m.id);
          if(job&&job.kind==='create'&&!m.render&&!m.error){
            // generation running on the server: partial prose (persisted by the
            // runner) survives reloads; the crane remains visible in every phase.
            const partial=m.prose||job.prose;
            if(partial){const pP=document.createElement('div');pP.className='prose writing';renderMarkdown(pP,partial);article.append(pP)}

          }
          if(entry.element){
            const m=entry.element;
            const wrap=document.createElement('div');
            wrap.className='elwrap'+((marked&&marked.msgId===m.id&&marked.sessionId===db.current)?' marked':'');
            const head=document.createElement('div');head.className='elhead';
            const nm=document.createElement('button');nm.type='button';nm.className='elname';nm.textContent=elementName(m);
            nm.title='Antippen, um dieses Element für die nächste Nachricht zu markieren';
            nm.setAttribute('aria-pressed',String(!!(marked&&marked.msgId===m.id)));
            nm.setAttribute('aria-label','Element markieren: '+elementName(m));
            nm.onclick=()=>toggleMark(m.id);
            const pinB=document.createElement('button');pinB.type='button';pinB.className='icon';
            pinB.textContent=isPinned(m)?'★':'☆';
            pinB.setAttribute('aria-pressed',String(isPinned(m)));
            pinB.setAttribute('aria-label',isPinned(m)?'Element lösen':'Element anpinnen');
            pinB.onclick=()=>{togglePin(m);render();if($('#overlay').open)fillOverlay()};
            const exp=document.createElement('button');exp.type='button';exp.className='icon';exp.textContent='↗';
            exp.setAttribute('aria-label','Element öffnen');exp.title='Element öffnen (Vollbild, Code, Versionen)';
            exp.onclick=()=>openOverlay(m);
            const reuse=document.createElement('button');reuse.type='button';reuse.textContent='Als Form';reuse.title='Dieses Element als wiederverwendbare Form speichern';reuse.onclick=()=>{formsUI.fromElement(m);};
            head.append(nm,pinB,exp,reuse);
            const note=document.createElement('div');note.className='small';
            const view=renderUI(m.render,{
              onAction:(name,inputs)=>runBoundAction(m,name,inputs),
      onState:state=>{m.render.state=state;save();scheduleStateSync(m.id,state)},
              onSuggest:text=>{$('#prompt').value=text;toast('Vorschlag eingefügt — nur du sendest ihn.')},
              onError:text=>{note.textContent=text;note.className='notice error'},
              onPing:doPing,
              onDb:p=>doDb(m.id,p)
            });
            views.push(view);
            wrap.append(head,view.element);
            article.append(wrap,note);
            const b=document.createElement('button');b.textContent='Werte übernehmen';b.onclick=()=>{$('#prompt').value='Denke mit meinen aktuellen Einstellungen weiter.';$('#prompt').focus();toast('Werte werden erst mit deiner Nachricht gesendet.')};article.append(b);
          }
          // background build: construction site stands in for the future element
          // (create, all phases) or marks an in-flight in-place refinement
          else if(job&&['create','plan','chat','refine'].includes(job.kind)&&job.messageId===m.id){article.append(siteEl(job))}
          if(job&&job.kind==='refine'&&entry.element){article.append(siteEl(job))}
        }
      }
      feed.append(article);
    }
  }
  if(s?.blueprint)feed.append(blueprintEl(s));
  for(const article of liveTurns.values())if(!article.isConnected)feed.append(article);
  feed.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>send(b.dataset.p));
  const add=$('#emptyadd');if(add)add.onclick=openSettings;
  renderElementList();
  renderQuickbar();
  renderChip();
  updateComposer();
}

function liveMessage(mode,modelLabel){
  const feed=$('#feed');
  const a=document.createElement('article');a.className='message assistant live';
  a.innerHTML='<div class="byline">Form</div>';
  // Phase 2 „Schreiben": the streamed text IS the movement; caret pulses.
  const p=document.createElement('div');p.className='prose';p.setAttribute('aria-live','polite');
  const slot=document.createElement('div');slot.className='artslot';
  const note=document.createElement('div');note.className='small';
  slot.append(activityEl());
  a.append(p,slot,note);feed.append(a);
  return {el:a,
    prose:t=>{
      if(!p.textContent&&t)p.classList.add('writing');
      renderMarkdown(p,t); // no forced viewport movement while streaming
      if(t)setActivityWriting(slot.querySelector('.activity'));
    },
    site:job=>{slot.replaceChildren(siteEl(job));if(p.textContent)setActivityWriting(slot.querySelector('.activity'))},
    note:t=>{note.textContent=t;note.className='notice'},
    error:t=>{note.textContent=t;note.className='notice error'}
  };
}

async function readSSE(response,onEvent){
  const reader=response.body.getReader(),dec=new TextDecoder();let buf='';
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    buf+=dec.decode(value,{stream:true});
    let i;
    while((i=buf.indexOf('\n\n'))!==-1){
      const block=buf.slice(0,i);buf=buf.slice(i+2);
      let event='message',data='';
      for(const line of block.split('\n')){
        if(line.startsWith('event:'))event=line.slice(6).trim();
        else if(line.startsWith('data:'))data+=line.slice(5).trim();
      }
      if(data){try{onEvent(event,JSON.parse(data))}catch{}}
    }
  }
}

async function send(text,mode='chat'){
  text=text.trim().slice(0,2000);
  if(!text||pending.size>=3)return toast('Bitte kurz warten — drei Antworten laufen schon.');
  if(!me)return showLogin('Bitte zuerst anmelden.');
  if(!models.length){openSettings();return toast('Bitte zuerst ein Modell hinzufügen.')}
  const s=current();
  if(!s)return;
  if(s.messages.length>=98)return toast('Bitte einen neuen Gedankengang starten.');
  const target=markInfo();
  const um={role:'user',id:uid(),text};
  s.messages.push(um);
  if(s.messages.length===1){s.title=text.slice(0,45);const btn=$('#sessions .session-open');if(btn)btn.textContent=s.title}
  $('#prompt').value='';save();
  // scroll anchor preserved across composer reset + feed re-render: neither a
  // jump to the top nor an automatic jump to the end
  const st=scrollState();
  render();
  const live=liveMessage(target?'refine':'new',models.find(m=>m.id===modelId)?.label);
  restoreScroll(st);
  const request={id:uid(),controller:new AbortController(),jobId:null,conversationId:s.id};
  pending.add(request);busy(true);
  liveTurns.set(request,live.el);
  let prose='',artifact=null,errorMsg=null,doneUser=null,doneAssist=null,jobStarted=null,transportLost=false;
  try{
    if(!csrf)throw Error('Sitzung abgelaufen — bitte neu anmelden.');
    const body={version:1,sessionId:s.id,requestId:request.id,text,mode,model:modelId||undefined};
    if(target)body.refineTarget={id:target.id,name:sanitizeName(elementName(target)),html:target.render.html,css:target.render.css,js:target.render.js,state:target.render.state};
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},signal:request.controller.signal,body:JSON.stringify(body)});
    if(!r.ok){const t=await r.json().catch(()=>({}));throw Error(t.error||('Serverfehler '+r.status))}
    await readSSE(r,(event,data)=>{
      if(!pending.has(request))return;
      if(event==='prose-chunk'&&typeof data.text==='string'){prose+=data.text.slice(0,4000);live.prose(prose)}
      else if(event==='artifact-start'){live.site(jobStarted)} // Phase 3 beginnt mit dem Artefakt
      else if(event==='retry')live.note(data.code==='transport'?data.reason:'Ungültiges Artefakt — ein Korrekturversuch läuft …');
      else if(event==='element-job'&&data.job&&data.job.id){jobStarted=data.job;request.jobId=data.job.id;live.site(data.job);applyJob(data.job)}
      else if(event==='render'){try{artifact=validateRender(data.render)}catch{errorMsg='Ungültige Antwort der Gegenseite.'}}
      else if(event==='error'){errorMsg=String(data.message||'Antwort fehlgeschlagen.');}
      else if(event==='done'){doneUser=data.userMessageId||null;doneAssist=data.assistantMessageId||null}
    });
    if(jobStarted&&!doneAssist&&!doneUser)transportLost=true; // clean EOF without done is also a lost stream
  }catch(e){if(pending.has(request)&&e.name!=='AbortError'){errorMsg=e.message;transportLost=true}}
  if(!pending.has(request)){liveTurns.delete(request);return} // stopped: stop() cancels the server job and syncs
  pending.delete(request);liveTurns.delete(request);busy(pending.size>0);
  sendFinishing=true; // exactly ONE closing render (a concurrent ready-event render would double-render)
  try{
  const st2=scrollState();
  if(transportLost&&jobStarted){
    // A broken viewer stream is NOT a failed server-owned generation.
    // Restore canonical placeholder IDs so later job events attach correctly.
    if(await loadFromServer()){
      render();restoreScroll(st2);
      toast('Verbindung zur Live-Anzeige unterbrochen — Auftrag wird serverseitig weitergeführt.');
      return;
    }
    errorMsg='Live-Verbindung unterbrochen. Der Auftrag wurde angenommen; beim Wiederverbinden wird sein Status geladen.';
    doneAssist=jobStarted.messageId||null;
  }
  if(target&&!['plan','chat'].includes(jobStarted?.kind)){
    // In-place refinement: the marked element is replaced only when the
    // background job completes (atomic swap server-side); original stays until then.
    if(jobStarted){marked=null;reconcileReadyJobs();save();render()}
    else if(artifact){
      pushVersion(target,target.render);
      target.render=artifact;
      if(prose)target.prose=prose.slice(0,8000);
      marked=null;
      reconcileReadyJobs();save();render();
      document.querySelector('[data-mid="'+target.id+'"]')?.classList.add('updated');
      toast('Element aktualisiert.');
    }else{
      reconcileReadyJobs();save();render();
      toast(errorMsg?('Nicht aktualisiert: '+errorMsg):'Kein aktualisiertes Element erhalten.');
    }
    restoreScroll(st2);
    return;
  }
  if(jobStarted&&doneAssist){
    // durable placeholder for the detached generation; reconcile() attaches
    // render/prose/error from the (usually already finished) job
    s.messages.push({role:'assistant',id:doneAssist,prose:prose||undefined,error:errorMsg||undefined});
  }
  else if(artifact)s.messages.push({role:'assistant',id:doneAssist||uid(),prose,render:artifact});
  else if(errorMsg){if(prose)live.error(errorMsg);s.messages.push({role:'assistant',id:doneAssist||uid(),prose,error:errorMsg})}
  else if(prose)s.messages.push({role:'assistant',id:doneAssist||uid(),prose});
  else await syncFromServer(); // nothing usable arrived: server holds the truth
  if(jobStarted?.kind==='plan'){marked=null;const jr=jobs.get(jobStarted.id);if(jr?.blueprint)s.blueprint=jr.blueprint;}
  reconcileReadyJobs(); // AFTER the local push: fast jobs attach here, one single render
  save();render();
  restoreScroll(st2);
  }finally{sendFinishing=false}
}

async function doPing(host){
  try{
    if(!csrf)return {ok:false,error:'Server nicht erreichbar.'};
    const sid=current()?.id||'';
    const r=await fetch('/api/ping',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify({sessionId:sid,host:String(host).slice(0,253)})});
    const t=await r.json().catch(()=>({}));
    if(!r.ok)return {ok:false,error:t.error||('HTTP '+r.status)};
    return {ok:t.ok===true,ip:t.ip,ms:t.ms,error:t.error};
  }catch{return {ok:false,error:'Ping fehlgeschlagen.'}}
}

// Per-element persistent tables (POST /api/db) — same auth as chat/ping.
async function doDb(elementId,payload){
  try{
    if(!csrf)return {ok:false,error:'Server nicht erreichbar.'};
    const sid=current()?.id||'';
    const body={version:1,sessionId:sid,elementId,op:payload.dbop,table:payload.table};
    const a=payload.args&&payload.args[0],b=payload.args&&payload.args[1];
    if(payload.dbop==='create'&&a!=null)body.columns=a;
    if(payload.dbop==='insert')body.row=a??{};
    if(payload.dbop==='select'&&a!=null)body.query=a;
    if(payload.dbop==='update'){body.id=a;body.patch=b??{}}
    if(payload.dbop==='delete')body.id=a;
    const r=await fetch('/api/db',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify(body)});
    const t=await r.json().catch(()=>({}));
    if(!r.ok)return {ok:false,error:t.error||('HTTP '+r.status)};
    return {ok:t.ok===true,id:t.id,rows:t.rows,truncated:t.truncated,error:t.error};
  }catch{return {ok:false,error:'Datenbankfehler.'}}
}

// --- element overlay: focused view, code editor, version history ---
function openOverlay(m){
  overlayMsg=m;overlayMode='view';
  fillOverlay();
  $('#overlay').showModal?.();
}
function closeOverlay(){$('#overlay')?.close()}
document.addEventListener('close',e=>{if(e.target.tagName==='DIALOG'&&e.target.contains($('#toolapprovals')))document.body.append($('#toolapprovals'))},true);
$('#overlay').addEventListener('close',()=>{
  overlayView?.destroy();overlayView=null;overlayMsg=null;overlayMode='view';
  $('#ovcontent').replaceChildren();
  render();
});
let overlayMsg=null,overlayMode='view',overlayView=null;
function fillOverlay(){
  const m=overlayMsg;if(!m)return;
  if(overlayView){overlayView.destroy();overlayView=null}
  const c=$('#ovcontent');document.body.append($('#toolapprovals'));c.replaceChildren();
  const head=document.createElement('div');head.className='ovhead';
  const t=document.createElement('strong');t.textContent=elementName(m);
  const pin=document.createElement('button');pin.type='button';pin.className='icon';pin.textContent=isPinned(m)?'★':'☆';
  pin.setAttribute('aria-pressed',String(isPinned(m)));
  pin.setAttribute('aria-label',isPinned(m)?'Element lösen':'Element anpinnen');
  pin.onclick=()=>{togglePin(m);render();fillOverlay()};
  const close=document.createElement('button');close.type='button';close.textContent='✕';close.setAttribute('aria-label','Element schliessen');close.onclick=closeOverlay;
  head.append(t,pin,close);
  const body=document.createElement('div');body.className='ovbody';
  c.append(head,body);

  if(overlayMode==='view'){
    const holder=document.createElement('div');body.append(holder);
    const note=document.createElement('div');note.className='small';body.append(note);
    overlayView=renderUI(m.render,{
      onAction:(name,inputs)=>runBoundAction(m,name,inputs),
      onState:state=>{m.render.state=state;save();scheduleStateSync(m.id,state)},
      onSuggest:text=>{$('#prompt').value=text;toast('Vorschlag eingefügt — nur du sendest ihn.')},
      onError:tx=>{note.textContent=tx;note.className='notice error'},
      onPing:doPing,
      onDb:p=>doDb(m.id,p)
    });
    holder.append(overlayView.element);
    const foot=document.createElement('div');foot.className='ovfoot';
    const b1=document.createElement('button');b1.type='button';b1.textContent='Mit KI bearbeiten';
    b1.onclick=()=>{closeOverlay();if(!(marked&&marked.msgId===m.id))marked={sessionId:db.current,msgId:m.id};render();$('#prompt').focus();toast('Element markiert — deine nächste Nachricht verfeinert es an Ort und Stelle.')};
    const b2=document.createElement('button');b2.type='button';b2.textContent='Code bearbeiten';b2.onclick=()=>{overlayMode='code';fillOverlay()};
    const b3=document.createElement('button');b3.type='button';b3.textContent='Versionen';b3.onclick=()=>{overlayMode='versions';fillOverlay()};
    foot.append(b1,b2,b3);body.append(foot);
    if(me?.role==='owner')void renderElementActions(body,m);
  }

  else if(overlayMode==='code'){
    const f=document.createElement('form');f.className='codeed';f.noValidate=true;
    const mk=(label,val,rows)=>{
      const l=document.createElement('label');
      const sp=document.createElement('span');sp.textContent=label;
      const ta=document.createElement('textarea');ta.rows=rows;ta.value=val;ta.spellcheck=false;
      l.append(sp,ta);f.append(l);return ta;
    };
    const nl=document.createElement('label');
    const nsp=document.createElement('span');nsp.textContent='Name';
    const nameIn=document.createElement('input');nameIn.type='text';nameIn.maxLength=80;nameIn.value=m.render.name||elementName(m);
    nl.append(nsp,nameIn);f.append(nl);
    const h=mk('HTML',m.render.html,8),cs=mk('CSS',m.render.css,5),j=mk('JS',m.render.js,8),st=mk('State (JSON)',JSON.stringify(m.render.state),3);
    const err=document.createElement('div');err.className='notice error';err.hidden=true;f.append(err);
    const row=document.createElement('div');row.className='ovfoot';
    const apply=document.createElement('button');apply.type='submit';apply.textContent='Anwenden';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Abbrechen';cancel.onclick=()=>{overlayMode='view';fillOverlay()};
    row.append(apply,cancel);f.append(row);body.append(f);
    f.onsubmit=e=>{
      e.preventDefault();
      err.hidden=true;
      let stateObj;
      try{stateObj=JSON.parse(st.value||'{}')}catch{err.textContent='State ist kein gültiges JSON.';err.hidden=false;return}
      let r;
      try{r=validateRender({version:1,name:sanitizeName(nameIn.value),html:h.value,css:cs.value,js:j.value,state:stateObj})}
      catch(e2){err.textContent='Abgelehnt: '+(e2.message||'Ungültiges Element');err.hidden=false;return}
      try{safeHTML(r.html);safeCSS(r.css)}catch(e3){err.textContent='Abgelehnt: '+(e3.message||'Inhalt ungültig');err.hidden=false;return}
      let cleaned=false;
      try{cleaned=safeHTML(r.html)!==r.html}catch{}
      pushVersion(m,m.render);
      m.render=r;
      save();syncRender(m);render();
      overlayMode='view';fillOverlay();
      toast(cleaned?'Angewendet — unsichere Teile wurden entfernt (wie bei KI-Antworten).':'Code-Änderung angewendet.');
    };
  }

  else{
    const list=db.elements.versions[m.id]||[];
    const wrap=document.createElement('div');wrap.className='vlist';
    if(!list.length){const p=document.createElement('p');p.className='small';p.textContent='Noch keine früheren Versionen.';wrap.append(p)}
    list.slice().reverse().forEach((v,i)=>{
      const row=document.createElement('div');row.className='verow';
      const info=document.createElement('span');
      const when=v.at?new Date(v.at).toLocaleString('de-CH'):'früher';
      info.textContent='v'+(list.length-i)+' · '+when+(v.render&&v.render.name?' · '+v.render.name:'');
      const rv=document.createElement('button');rv.type='button';rv.textContent='Wiederherstellen';
      rv.onclick=()=>{
        pushVersion(m,m.render);
        try{m.render=validateRender(JSON.parse(JSON.stringify(v.render)))}catch{toast('Version ungültig.');return}
        save();syncRender(m);render();
        overlayMode='view';fillOverlay();
        toast('Version wiederhergestellt.');
      };
      row.append(info,rv);wrap.append(row);
    });
    body.append(wrap);
    const back=document.createElement('div');back.className='ovfoot';
    const bb=document.createElement('button');bb.type='button';bb.textContent='Zurück zur Ansicht';bb.onclick=()=>{overlayMode='view';fillOverlay()};
    back.append(bb);body.append(back);
  }
}

async function refreshModels(){
  try{
    const r=await fetch('/api/bootstrap');
    if(r.status===401){me=null;csrf='';showLogin('Sitzung abgelaufen — bitte erneut anmelden.');return}
    if(!r.ok)return;
    const b=await r.json();csrf=b.csrf||csrf;me=b.user||me;models=Array.isArray(b.models)?b.models:[];
    if(!models.some(m=>m.id===modelId))modelId=models[0]?.id||'';
    localStorage.setItem('form3.model',modelId);
    const s=$('#model');s.replaceChildren();
    for(const m of models){const o=document.createElement('option');o.value=m.id;o.textContent=m.label+' · '+m.model.split('/').pop();s.append(o)}
    s.classList.toggle('hidden',!models.length);
    if(models.length)s.value=modelId;
    s.onchange=()=>{modelId=s.value;localStorage.setItem('form3.model',modelId)};
  }catch{}
  if(me)render();
  renderModelList();
}
function openSettings(){if(!me)return;$('#settings').showModal?.();renderModelList()}
function renderModelList(){
  const box=$('#modellist');if(!box)return;box.replaceChildren();
  $('#addmodel')?.classList.toggle('hidden',!me);
  if(!models.length){const p=document.createElement('p');p.className='small';p.textContent='Noch keine Modelle. Füge deinen eigenen Provider hinzu oder nutze ein freigegebenes Modell.';box.append(p);}
  for(const m of models){
    const row=document.createElement('div');row.className='mrow';row.dataset.modelid=m.id;
    const info=document.createElement('div');const strong=document.createElement('strong');strong.textContent=m.label+' · '+m.model;
    const span=document.createElement('span');span.className='small';span.textContent=m.owned?('Eigener Provider · '+(m.shared?'für alle freigegeben':'privat')+' · Key '+m.keyMasked):'Geteilter Provider · nutzbar, API-Key bleibt verborgen';
    info.append(strong,span);row.append(info);
    if(m.owned){
      const actions=document.createElement('div');actions.className='model-actions';
      if(m.canShare){const share=document.createElement('button');share.textContent=m.shared?'Freigabe beenden':'Für alle teilen';share.setAttribute('aria-label',(m.shared?'Freigabe beenden: ':'Provider teilen: ')+m.label);share.onclick=async()=>{try{const r=await fetch('/api/models/share',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify({id:m.id,shared:!m.shared})});if(!r.ok)throw Error((await r.json()).error);await refreshModels();toast(m.shared?'Freigabe beendet.':'Provider freigegeben.');}catch(e){toast(e.message||'Freigabe fehlgeschlagen.');}};actions.append(share);}
      const del=document.createElement('button');del.textContent='Löschen';del.setAttribute('aria-label','Modell '+m.label+' löschen');del.onclick=async()=>{if(!confirm('Provider „'+m.label+'“ löschen?'))return;try{const r=await fetch('/api/models/'+m.id,{method:'DELETE',headers:{'X-Form-CSRF':csrf}});if(!r.ok)throw Error((await r.json()).error);await refreshModels();toast('Modell gelöscht.');}catch(e){toast(e.message||'Löschen fehlgeschlagen.');}};actions.append(del);row.append(actions);
    }
    box.append(row);
  }
}
async function renderUsers(){
 const r=await fetch('/api/admin/users');if(!r.ok)throw Error('Benutzerverwaltung nicht erlaubt.');const data=await r.json();const list=$('#userslist');list.replaceChildren();
 for(const user of data.users){
 const row=document.createElement('section');row.className='user-row';row.dataset.userId=user.id;const p=document.createElement('p');p.textContent=user.username+' · '+user.role+(user.disabled?' · deaktiviert':'');row.append(p);
 if(user.id!==me.id&&user.role!=='owner'&&(me.role==='owner'||user.role==='user')){
 const actions=document.createElement('div');actions.className='row-actions';
 for(const [action,label]of [['reset','Passwort zurücksetzen'],['disable',user.disabled?'Aktivieren':'Deaktivieren'],['delete','Benutzer löschen']]){const b=document.createElement('button');b.textContent=label;if(action==='delete')b.className='danger';b.onclick=()=>openUserAction(user,action);actions.append(b);}
 if(me.role==='owner'){const role=document.createElement('button');role.textContent=user.role==='admin'?'Zu Benutzer ändern':'Zum Admin machen';role.onclick=()=>openUserAction(user,'role');actions.append(role);}row.append(actions);
 }list.append(row);}

 $('#useradd [value=admin]').disabled=me?.role!=='owner';
}
$('#usersbtn').onclick=async()=>{try{await renderUsers();$('#usersdialog').showModal();}catch(e){toast(e.message);}};
$('#usersclose').onclick=()=>$('#usersdialog').close();
let userActionTarget=null;
function openUserAction(user,action){
 userActionTarget={user,action};const f=$('#useractionform');f.reset();$('#useractionstatus').textContent='';$('#useractiontitle').textContent=user.username;
 $('#userpasswordlabel').classList.toggle('hidden',action!=='reset');f.elements.password.required=action==='reset';f.elements.password.disabled=action!=='reset';
 $('#userconfirmlabel').classList.toggle('hidden',action!=='delete');f.elements.confirm.required=action==='delete';f.elements.confirm.disabled=action!=='delete';
 $('#useractionhint').textContent=action==='delete'?'Konto, Chats, Elemente, Formen und eigene Provider endgültig löschen. Geteilte Provider dieses Kontos stehen danach niemandem mehr zur Verfügung.':action==='reset'?'Neues Passwort setzen. Alle bisherigen Anmeldungen dieses Benutzers werden ungültig.':action==='disable'?(user.disabled?'Konto wieder aktivieren.':'Konto sperren, Anmeldungen beenden und laufende Aufträge abbrechen.'):'Rolle ändern. Bisherige Anmeldungen werden beendet.';
 $('#useraction').showModal();
}
$('#useractionclose').onclick=()=>{$('#useractionform').reset();$('#useraction').close();};
$('#useractionform').onsubmit=async e=>{e.preventDefault();const {user,action}=userActionTarget,f=e.target;const b=$('#useractionsubmit');b.disabled=true;
 try{await uiRequest('/api/admin/users/action',{id:user.id,action,...(action==='reset'?{password:f.elements.password.value}:{}),...(action==='delete'?{confirm:f.elements.confirm.value}:{}),...(action==='disable'?{disabled:!user.disabled}:{}),...(action==='role'?{role:user.role==='admin'?'user':'admin'}:{})});f.reset();$('#useraction').close();await renderUsers();toast('Benutzer aktualisiert.');}catch(err){$('#useractionstatus').textContent=err.message;}finally{b.disabled=false;}};

$('#useradd').onsubmit=async e=>{
 e.preventDefault();const f=e.target,status=$('#useraddstatus');const button=f.querySelector('button');button.disabled=true;status.textContent='';
 try{const r=await fetch('/api/admin/users',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify({username:f.username.value.trim(),password:f.password.value,role:f.role.value})});const d=await r.json();if(!r.ok)throw Error(d.error);f.reset();await renderUsers();status.textContent='Benutzer „'+d.user.username+'“ erstellt.';}
 catch(e){status.textContent=e.message||'Benutzer konnte nicht erstellt werden.';}finally{button.disabled=false;}
};
$('#settingsbtn').onclick=openSettings;$('#settingsbtn2').onclick=openSettings;
$('#closesettings').onclick=()=>$('#settings').close();
$('#addmodel').onsubmit=async e=>{
  e.preventDefault();
  const f=e.target,d={label:f.label.value,baseUrl:f.baseUrl.value,model:f.model.value,apiKey:f.apiKey.value};
  try{
    const r=await fetch('/api/models',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify(d)});
    const t=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(t.error||('HTTP '+r.status));
    f.reset();await refreshModels();toast('Modell gespeichert: '+d.label);
  }catch(err){toast('Hinzufügen fehlgeschlagen: '+err.message)}
};
$('#planbtn').onclick=()=>send($('#prompt').value.trim()||'Erstelle einen Blueprint aus unserer bisherigen Besprechung.','plan');
$('#composer').onsubmit=e=>{e.preventDefault();send($('#prompt').value)};
$('#prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send(e.target.value)}};
$('#stop').onclick=stop;$('#new').onclick=()=>newSession();
$('#mobile').onclick=()=>{$('#sidebar').classList.toggle('open');$('#mobile').setAttribute('aria-expanded',$('#sidebar').classList.contains('open'))};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('#sidebar').classList.remove('open');$('#mobile').setAttribute('aria-expanded','false')}});
// MCP credentials and execution stay on the server; confirmations are app-owned.
async function mcpRequest(route,data){
 const r=await fetch('/api/mcp'+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify(data)});
 const t=await r.json();if(!r.ok)throw Error(t.error||'MCP fehlgeschlagen');return t;
}
async function showConnections(){
 try{
 const {connections}=await mcpRequest('');const list=$('#mcplist');list.replaceChildren();
 for(const c of connections){
 const row=document.createElement('section');row.className='notice';
 const title=document.createElement('strong');title.textContent=c.name;row.append(title);
 const test=document.createElement('button');test.textContent='Tools laden';test.onclick=async()=>{try{await mcpRequest('/discover',{id:c.id});await showConnections()}catch(e){toast(e.message)}};row.append(test);
 const checks=[];
 for(const tool of c.tools){const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=tool.allowed;checks.push([tool.name,check]);label.append(check,document.createTextNode(tool.name));row.append(label)}
 const enable=document.createElement('button');enable.textContent='Auswahl aktivieren';enable.onclick=async()=>{try{await mcpRequest('/configure',{id:c.id,enabled:true,allowedTools:checks.filter(x=>x[1].checked).map(x=>x[0])});toast('Tools aktiviert.')}catch(e){toast(e.message)}};row.append(enable);
 const disable=document.createElement('button');disable.textContent='Deaktivieren';disable.onclick=async()=>{try{await mcpRequest('/configure',{id:c.id,enabled:false,allowedTools:[]});await showConnections()}catch(e){toast(e.message)}};row.append(disable);list.append(row);
 }
 $('#mcpdialog').showModal?.();
 }catch(e){toast(e.message)}
}
$('#mcpbtn').onclick=showConnections;$('#mcpclose').onclick=()=>$('#mcpdialog').close();
$('#mcpadd').onsubmit=async e=>{e.preventDefault();const f=e.target;try{await mcpRequest('',{name:f.name.value,url:f.url.value,token:f.token.value});f.reset();await showConnections()}catch(e){toast(e.message)}};
// Tool execution is automatic; the journal remains server-side.
async function refreshApprovals(){}
async function httpRequest(route,data){const r=await fetch('/api/http'+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify(data)});const t=await r.json();if(!r.ok)throw Error(t.error);return t;}
async function showHTTP(){try{const {connections}=await httpRequest('');const list=$('#httplist');list.replaceChildren();for(const c of connections){const row=document.createElement('section');row.className='notice';const title=document.createElement('p');title.textContent=c.name+' · '+c.method+' '+c.url;const toggle=document.createElement('button');toggle.textContent=c.enabled?'Deaktivieren':'Aktivieren';toggle.onclick=async()=>{try{await httpRequest('/configure',{id:c.id,enabled:!c.enabled});await showHTTP()}catch(e){toast(e.message)}};const del=document.createElement('button');del.textContent='Entfernen';del.onclick=async()=>{if(!confirm('HTTP-Verbindung entfernen?'))return;try{await httpRequest('/remove',{id:c.id});await showHTTP()}catch(e){toast(e.message)}};row.append(title,toggle,del);list.append(row)}if(!$('#httpdialog').open)$('#httpdialog').showModal()}catch(e){toast(e.message)}}
$('#httpbtn').onclick=()=>{$('#mcpdialog').close();void showHTTP()};$('#httpclose').onclick=()=>$('#httpdialog').close();
$('#httpadd').onsubmit=async e=>{e.preventDefault();const f=e.target;try{await httpRequest('',{name:f.name.value,url:f.url.value,method:f.method.value,headers:JSON.parse(f.headers.value||'{}')});f.reset();await showHTTP()}catch(err){toast(err.message)}};
async function runBoundAction(m,name,inputs){
 let id,jobId;
 if(m.render?.actions?.some(a=>a.name===name)){
   ({id,jobId}=await actionRequest('/auto-run',{messageId:m.id,name,inputs}));
 }else{
   const {actions}=await actionRequest('?messageId='+encodeURIComponent(m.id));const matches=actions.filter(a=>a.label===name);if(matches.length!==1)throw Error('Aktion nicht eindeutig verknüpft.');id=matches[0].id;
   ({jobId}=await actionRequest('/run',{id,inputs}));
 }
 void refreshApprovals();
 const end=Date.now()+155000;
 while(Date.now()<end){await new Promise(r=>setTimeout(r,1500));const {actions}=await actionRequest('?messageId='+encodeURIComponent(m.id));const action=actions.find(a=>a.id===id);if(!action||action.jobId!==jobId)throw Error('Aktion entfernt oder erneut gestartet.');if(action.state==='completed')return action.result;if(['denied','expired','unknown'].includes(action.state))throw Error('Aktion nicht abgeschlossen.');}
 throw Error('Zeitlimit. Ergebnis prüfen.');
}
async function actionRequest(route,data){const r=await fetch('/api/element-actions'+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify(data)});const t=await r.json();if(!r.ok)throw Error(t.error);return t;}
async function renderElementActions(body,m){
 const panel=document.createElement('details');panel.className='element-actions';const summary=document.createElement('summary');summary.textContent='Tool-Aktionen';panel.append(summary);body.append(panel);
 const list=document.createElement('div');panel.append(list);
 async function refresh(){const data=await actionRequest('?messageId='+encodeURIComponent(m.id));if(!panel.isConnected)return;list.replaceChildren();
 for(const action of data.actions){const row=document.createElement('div');const inputValues={};for(const key of [...new Set([...JSON.stringify(action.args).matchAll(/\{\{([a-zA-Z0-9_]{1,40})\}\}/g)].map(m=>m[1]))]){const field=document.createElement('input');field.placeholder=key;field.setAttribute('aria-label','Parameter '+key);field.oninput=()=>{inputValues[key]=field.value};row.append(field)}const run=document.createElement('button');run.textContent=action.label;run.disabled=['pending','approved','running'].includes(action.state);run.onclick=async()=>{try{await actionRequest('/run',{id:action.id,inputs:inputValues});await refresh();await refreshApprovals()}catch(e){toast(e.message)}};const remove=document.createElement('button');remove.textContent='Entfernen';remove.onclick=async()=>{try{await actionRequest('/remove',{id:action.id});await refresh()}catch(e){toast(e.message)}};row.append(run,remove);if(action.state){const status=document.createElement('small');status.textContent=' '+action.state;row.append(status)}if(action.result){const result=document.createElement('pre');result.style.whiteSpace='pre-wrap';result.textContent=JSON.stringify(action.result,null,2);row.append(result)}list.append(row);}
 return data;
 }
 try{const data=await refresh();if(!data)return;const form=document.createElement('form');const label=document.createElement('input');label.placeholder='Name der Aktion';label.required=true;label.maxLength=60;label.setAttribute('aria-label','Aktionsname');const select=document.createElement('select');select.setAttribute('aria-label','Tool für Element');for(const tool of data.tools){const o=document.createElement('option');o.value=tool.name;o.textContent=tool.label;select.append(o)}const args=document.createElement('textarea');args.value='{}';args.setAttribute('aria-label','Tool-Argumente JSON');args.title='Dynamische Werte: {{parameter}}, z. B. {"query":{"city":"{{city}}"}}';const add=document.createElement('button');add.textContent='Verknüpfen';add.disabled=!data.tools.length;form.append(label,select,args,add);panel.append(form);form.onsubmit=async e=>{e.preventDefault();try{await actionRequest('/add',{messageId:m.id,label:label.value,tool:select.value,args:JSON.parse(args.value)});await refresh()}catch(e){toast(e.message)}};
 const timer=setInterval(()=>{if(!panel.isConnected){clearInterval(timer);return}if(panel.open&&!panel.contains(document.activeElement))refresh().catch(()=>{})},2500);
 }catch(e){summary.textContent='Tool-Aktionen nicht verfügbar';}
}
async function memoryRequest(route,data){const r=await fetch('/api/memory'+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify(data)});const t=await r.json();if(!r.ok)throw Error(t.error);return t;}
async function showMemory(){try{const data=await memoryRequest('');$('#memoryenabled').checked=data.enabled;await renderMemories();$('#memorydialog').showModal?.()}catch(e){toast(e.message)}}
async function renderMemories(){try{const data=await memoryRequest('/search',{query:$('#memorysearch').value,limit:50});const list=$('#memorylist');list.replaceChildren();for(const m of data.memories){const row=document.createElement('section');row.className='notice';const text=document.createElement('textarea');text.value=m.content;text.maxLength=4000;text.setAttribute('aria-label','Erinnerung bearbeiten');const save=document.createElement('button');save.textContent='Speichern';save.onclick=async()=>{try{await memoryRequest('/save',{id:m.id,content:text.value,project:m.project});toast('Gespeichert.')}catch(e){toast(e.message)}};const del=document.createElement('button');del.textContent='Löschen';del.onclick=async()=>{if(!confirm('Erinnerung löschen?'))return;try{await memoryRequest('/delete',{id:m.id});await renderMemories()}catch(e){toast(e.message)}};row.append(text,save,del);list.append(row)}}catch(e){toast(e.message)}}
$('#memorybtn').onclick=showMemory;$('#memoryclose').onclick=()=>$('#memorydialog').close();
$('#memoryenabled').onchange=async e=>{try{await memoryRequest('/enabled',{enabled:e.target.checked})}catch(err){e.target.checked=!e.target.checked;toast(err.message)}};
$('#memorysearch').onchange=renderMemories;
$('#memoryadd').onsubmit=async e=>{e.preventDefault();const f=e.target;try{await memoryRequest('/save',{content:f.content.value,project:f.project.value});f.reset();await renderMemories()}catch(err){toast(err.message)}};
async function uiRequest(path,data){const r=await fetch(path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify(data)});const t=await r.json();if(!r.ok)throw Error(t.error||'Anfrage fehlgeschlagen.');return t;}
function fillSuggestion(text){$('#prompt').value=text;$('#prompt').focus();toast('Vorschlag eingefügt – du entscheidest, ob du ihn sendest.');}
const formsUI=initFormsUI({request:uiRequest,toast,suggest:fillSuggestion});
$('#preferencesbtn').onclick=()=>$('#preferences').showModal();$('#preferencesclose').onclick=()=>$('#preferences').close();
async function refreshBugs(){const data=await uiRequest('/api/bugs');const list=$('#buglist');list.replaceChildren();if(!data.reports.length)list.textContent='Noch keine Meldungen.';for(const b of data.reports){const row=document.createElement('section');row.className='library-row';const title=document.createElement('strong');title.textContent=b.title;const meta=document.createElement('p');meta.className='small';meta.textContent=b.username+' · '+new Date(b.created_at).toLocaleString()+' · #'+b.id.slice(0,8);const body=document.createElement('p');body.style.whiteSpace='pre-wrap';body.textContent=b.description+'\nErwartet: '+b.expected+(b.conversation_id?'\nChat-ID: '+b.conversation_id:'');const status=document.createElement('select');status.setAttribute('aria-label','Bugstatus');for(const [v,l]of [['open','Offen'],['working','In Arbeit'],['resolved','Behoben']]){const o=document.createElement('option');o.value=v;o.textContent=l;status.append(o)}status.value=b.status;status.disabled=!data.canManage;const note=document.createElement('textarea');note.setAttribute('aria-label','Bearbeitungsnotiz');note.maxLength=2000;note.value=b.resolution;note.readOnly=!data.canManage;row.append(title,meta,body,status,note);if(data.canManage){const save=document.createElement('button');save.textContent='Status speichern';save.onclick=async()=>{try{await uiRequest('/api/bugs/status',{id:b.id,status:status.value,resolution:note.value});toast('Status gespeichert.')}catch(e){toast(e.message)}};row.append(save)}list.append(row)}}
$('#bugbtn').onclick=()=>{$('#bugdialog').showModal();refreshBugs().catch(e=>toast(e.message));};$('#bugclose').onclick=()=>$('#bugdialog').close();$('#bugrefresh').onclick=()=>refreshBugs().catch(e=>toast(e.message));
$('#bugform').onsubmit=async e=>{e.preventDefault();const f=e.target;$('#bugsubmit').disabled=true;try{const out=await uiRequest('/api/bugs',{title:f.elements.title.value,description:f.elements.description.value,expected:f.elements.expected.value,conversationId:f.elements.context.checked?db.current:null});f.reset();$('#bugfeedback').textContent='Gesendet · #'+out.id.slice(0,8);await refreshBugs()}catch(err){$('#bugfeedback').textContent=err.message}finally{$('#bugsubmit').disabled=false}};
boot();

function blueprintEl(s){
  const bp=s.blueprint,box=document.createElement('section');let fold;box.className='blueprint';box.dataset.blueprintId=bp.id;
  const head=document.createElement('div');head.className='blueprint-head';
  const title=document.createElement('strong');title.textContent='Blueprint · '+bp.title;
  const rev=document.createElement('span');rev.textContent='Version '+bp.revision;head.append(title,rev);
  const summary=document.createElement('p');summary.className='blueprint-summary';summary.textContent=bp.summary;
  const summaryLabel=document.createElement('h3');summaryLabel.className='blueprint-section';summaryLabel.textContent='Zusammenfassung';
  const questions=Array.isArray(bp.questions)?bp.questions:[];
  const form=document.createElement('form');form.className='blueprint-questions';
  if(questions.length){
    const label=document.createElement('h3');label.className='blueprint-section';label.textContent='Zuerst klären · '+questions.length;form.append(label);
    const fields=questions.map((q,i)=>{
      const block=document.createElement('label');block.className='blueprint-question';const title=document.createElement('span');title.textContent=q;
      const input=document.createElement('textarea');input.rows=2;input.maxLength=300;input.required=true;input.placeholder='Deine Antwort …';input.dataset.question=String(i);
      const key='form-blueprint-answer:'+me.id+':'+bp.id+':'+i;
      try{input.value=sessionStorage.getItem(key)||'';}catch{}
      input.oninput=()=>{try{sessionStorage.setItem(key,input.value)}catch{}};
      block.append(title,input);form.append(block);return input;
    });
    const answer=document.createElement('button');answer.type='submit';answer.textContent='Antworten mit Form klären';form.append(answer);
    form.onsubmit=async e=>{
      e.preventDefault();
      if(db.current!==s.id||current()?.blueprint?.id!==bp.id)return toast('Bitte den aktuellen Blueprint verwenden.');
      if([...jobs.values()].some(j=>j.conversationId===s.id&&j.kind==='plan'&&ACTIVE_JOB.includes(j.state)))return toast('Bitte Form zuerst antworten lassen.');
      const text='Antworten zu Blueprint Version '+bp.revision+':\n'+questions.map((q,i)=>q+'\nAntwort: '+fields[i].value.trim()).join('\n\n');
      if(fields.some(f=>!f.value.trim()))return toast('Bitte alle offenen Fragen beantworten.');
      if(text.length>2000)return toast('Bitte die Antworten etwas kürzen (zusammen maximal 2000 Zeichen).');
      answer.disabled=true;fold.close();try{await send(text,'plan')}finally{answer.disabled=false;}
    };
  }
  const note=document.createElement('p');note.className='small';note.textContent=bp.executedJobId?'Diese Planversion wurde gestartet. Neue Wünsche kannst du weiter im Chat besprechen.':bp.ready?'Noch kein Bau gestartet. Besprich Änderungen im Chat oder bestätige genau diese Version.':'Offene Fragen zuerst im Chat klären. Es wird noch nichts gebaut.';
  const modelLabel=document.createElement('label');modelLabel.className='build-model';modelLabel.textContent='Modell für den Bau ';const buildModel=document.createElement('select');buildModel.setAttribute('aria-label','Baumodell');for(const m of models){const o=document.createElement('option');o.value=m.id;o.textContent=m.label;buildModel.append(o);}buildModel.value=models.some(m=>m.id===bp.modelId)?bp.modelId:(models[0]?.id||'');modelLabel.append(buildModel);
  const start=document.createElement('button');start.className='blueprint-execute';start.type='button';start.textContent=bp.executedJobId?'Plan gestartet':'Plan starten';
  start.disabled=!!bp.executedJobId||!bp.ready||questions.length>0||[...jobs.values()].some(j=>j.conversationId===s.id&&j.kind==='plan'&&ACTIVE_JOB.includes(j.state));
  start.onclick=async()=>{
    start.disabled=true;
    try{
      const r=await fetch('/api/blueprints/execute',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify({sessionId:s.id,blueprintId:bp.id,revision:bp.revision,model:buildModel.value})});const t=await r.json();if(!r.ok)throw Error(t.error);
      s.blueprint=t.blueprint;if(t.job)applyJob(t.job);const currentId=db.current;await loadFromServer();if(db.sessions.some(c=>c.id===currentId))db.current=currentId;renderPreservingScroll();
    }catch(e){start.disabled=false;toast(e.message)}
  };
  const update=document.createElement('button');update.type='button';update.textContent='Gespräch in Plan übernehmen';update.onclick=()=>send('Aktualisiere den Blueprint anhand unserer bisherigen Besprechung.','plan');
  const body=document.createElement('div');body.className='blueprint-body';const inner=document.createElement('div');inner.className='blueprint-inner';inner.append(update,summaryLabel,summary);if(questions.length)inner.append(form);inner.append(note,modelLabel,start);body.append(inner);fold=planFold({box,head,body,key:me.id+'-'+bp.id,revision:bp.revision,questions:questions.length});return box;
}
