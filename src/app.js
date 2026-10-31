import {renderUI} from './renderer.js';
import {safeHTML,safeCSS} from './sanitize.js';
import {validateRender,deriveName,sanitizeName} from '../contract.mjs';
const $=s=>document.querySelector(s),uid=()=>crypto.randomUUID(),KEY='form.v3';
let db,csrf='',models=[],modelId=localStorage.getItem('form3.model')||'',pending=null,views=[],marked=null;
let overlayMsg=null,overlayMode='view',overlayView=null;
const current=()=>db.sessions.find(s=>s.id===db.current);
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
function save(){try{trimVersions();localStorage.setItem(KEY,JSON.stringify(db))}catch{toast('Speicher voll — bitte exportieren.')}}

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
try{db=normalize(JSON.parse(localStorage.getItem(KEY)))}catch{db={version:4,sessions:[],elements:{pins:[],versions:{}}}}

// --- element helpers ---
const elementName=m=>m.render.name||deriveName(m.render,m.prose);
const isPinned=m=>db.elements.pins.includes(m.id);
function pushVersion(m,render){
  const list=db.elements.versions[m.id]||(db.elements.versions[m.id]=[]);
  list.push({at:new Date().toISOString(),render:JSON.parse(JSON.stringify(render))});
  while(list.length>5)list.shift();
}
function togglePin(m){
  const i=db.elements.pins.indexOf(m.id);
  if(i===-1)db.elements.pins.push(m.id);else db.elements.pins.splice(i,1);
  save();
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

function history(s){return s.messages.slice(-12).map(m=>m.role==='user'?{role:'user',content:m.text}:{role:'assistant',content:(m.prose?m.prose.slice(0,1500):'')+(m.render?(m.prose?' ':'')+'[enthielt ein interaktives Artefakt]':(m.error?'[Fehler]':''))||'[leer]'})}
function states(s){return s.messages.filter(m=>m.render).slice(-3).map(m=>({id:m.id,state:m.render.state}))}
function sketchEl(){const d=document.createElement('div');d.className='sketch';d.setAttribute('aria-hidden','true');d.innerHTML='<svg viewBox="0 0 130 72"><path d="M6 60 L28 12 L50 44 L72 8 L94 52 L116 20"/><circle cx="104" cy="46" r="16"/><line x1="6" y1="66" x2="124" y2="66"/><polygon points="16,8 34,8 25,22"/></svg>';return d}
function busy(on){$('#stop').classList.toggle('hidden',!on);$('#send').classList.toggle('hidden',on)}
function stop(){if(!pending)return;pending.controller.abort();pending=null;busy(false);toast('Antwort gestoppt.');render()}
function newSession(){stop();closeOverlay();if(db.sessions.length>=40)return toast('Maximal 40 Sitzungen');const s={id:uid(),title:'Neuer Gedankengang',messages:[]};db.sessions.unshift(s);db.current=s.id;marked=null;save();render();$('#sidebar').classList.remove('open')}
function updateComposer(){const has=models.length>0;$('#send').disabled=!has;$('#statuslabel').textContent=has?'LOKAL · BEREIT':'KEIN MODELL';$('#prompt').placeholder=has?'Was möchtest du durchdenken?':'Zuerst ein Modell hinzufügen (⚙ oben rechts)'}

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

function render(){  views.forEach(v=>v.destroy());views=[];
  $('#sessions').replaceChildren();
  for(const s of db.sessions){const b=document.createElement('button');b.textContent=s.title;b.setAttribute('aria-current',s.id===db.current);b.onclick=()=>{stop();closeOverlay();db.current=s.id;marked=null;save();render();$('#sidebar').classList.remove('open')};$('#sessions').append(b)}
  const feed=$('#feed');
  feed.innerHTML='<section class="intro"><div class="eyebrow">Ein Gespräch. Unendlich viele Formen.</div><h1>Antworten, die<br><em>denken und zeigen.</em></h1><p>Form antwortet zuerst in klarem Text — und baut daraus, wenn es wirklich hilft, ein kleines interaktives Werkzeug. Läuft komplett lokal auf deinem Rechner.</p><div class="starters"><button data-p="Zeig mir einen Spar-Rechner mit Slider">↗ Sparziel erkunden</button><button data-p="Vergleiche drei Ideen als interaktive Grafik">◇ Ideen vergleichen</button><button data-p="Erkläre mir kurz, was ein VPN macht — prose only">◇ Nur Text gefragt</button></div></section>';
  if(!models.length)feed.insertAdjacentHTML('beforeend','<section class="empty" id="emptystate"><div class="eyebrow">Schritt 1 · Noch kein Modell</div><h2>Verbinde dein erstes Modell.</h2><p>Form läuft komplett lokal. Füge ein OpenAI-kompatibles Modell hinzu (z. B. z.ai, OpenRouter oder Ollama) — Base-URL, Modell-ID und API-Key. Der Key bleibt in <code>form.models.json</code> auf deinem Rechner und wird nie angezeigt oder exportiert.</p><button id="emptyadd">⚙ Modell hinzufügen</button></section>');
  const s=current();
  if(s.messages.length>12){const h=document.createElement('p');h.className='notice';h.textContent='Die letzten 12 Nachrichten sind geöffnet. Das vollständige Gespräch bleibt im Export erhalten.';feed.append(h)}
  for(const m of s.messages.slice(-12)){
    const article=document.createElement('article');article.className='message '+(m.role==='user'?'user':'assistant');article.dataset.mid=m.id;
    if(m.role==='user'){const b=document.createElement('div');b.className='bubble';b.textContent=m.text;article.append(b)}
    else{
      article.innerHTML='<div class="byline"><span>⌑</span> FORM <small>/ KI · ISOLIERT</small></div>';
      if(m.error){const n=document.createElement('div');n.className='notice error';n.textContent=m.error;article.append(n)}
      else{
        if(m.prose){const p=document.createElement('p');p.className='prose';p.textContent=m.prose;article.append(p)}
        if(m.render){
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
          head.append(nm,pinB,exp);
          const note=document.createElement('div');note.className='small';
          const view=renderUI(m.render,{
            onState:state=>{m.render.state=state;save()},
            onSuggest:text=>{$('#prompt').value=text;toast('Vorschlag eingefügt — nur du sendest ihn.')},
            onError:text=>{note.textContent=text;note.className='notice error'},
            onPing:doPing
          });
          views.push(view);
          wrap.append(head,view.element);
          article.append(wrap,note);
          const b=document.createElement('button');b.textContent='Mit diesen Werten weiterdenken ↗';b.onclick=()=>{$('#prompt').value='Denke mit meinen aktuellen Einstellungen weiter.';$('#prompt').focus();toast('Werte werden erst mit deiner Nachricht gesendet.')};article.append(b);
        }
      }
    }
    feed.append(article);
  }
  feed.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>send(b.dataset.p));
  const add=$('#emptyadd');if(add)add.onclick=openSettings;
  renderQuickbar();
  renderChip();
  updateComposer();
}

function liveMessage(mode){
  const feed=$('#feed');
  const a=document.createElement('article');a.className='message assistant live';
  a.innerHTML='<div class="byline"><span>⌑</span> FORM <small>/ '+(mode==='refine'?'AKTUALISIERT':'STREAMT')+'</small></div>';
  const p=document.createElement('p');p.className='prose';p.setAttribute('aria-live','polite');
  const slot=document.createElement('div');slot.className='artslot';
  const note=document.createElement('div');note.className='small';
  slot.append(sketchEl());
  a.append(p,slot,note);feed.append(a);a.scrollIntoView({block:'end'});
  return {
    prose:t=>{p.textContent=t;a.scrollIntoView({block:'nearest'})},
    sketch:()=>{slot.replaceChildren(sketchEl())},
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

async function send(text){
  text=text.trim().slice(0,2000);
  if(!text||pending)return;
  if(!models.length){openSettings();return toast('Bitte zuerst ein Modell hinzufügen.')}
  const s=current();
  if(s.messages.length>=98)return toast('Bitte einen neuen Gedankengang starten.');
  const target=markInfo();
  s.messages.push({role:'user',id:uid(),text});
  if(s.messages.length===1)s.title=text.slice(0,45);
  $('#prompt').value='';save();render();
  const live=liveMessage(target?'refine':'new');
  const request={id:uid(),controller:new AbortController()};
  pending=request;busy(true);
  let prose='',artifact=null,errorMsg=null;
  try{
    if(!csrf){const r=await fetch('/api/bootstrap');if(r.ok)csrf=(await r.json()).csrf;}
    if(!csrf)throw Error('Server nicht erreichbar.');
    const body={version:1,sessionId:s.id,requestId:request.id,text,history:history(s),states:states(s),model:modelId||undefined};
    if(target)body.refineTarget={id:target.id,name:sanitizeName(elementName(target)),html:target.render.html,css:target.render.css,js:target.render.js,state:target.render.state};
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},signal:request.controller.signal,body:JSON.stringify(body)});
    if(!r.ok){const t=await r.json().catch(()=>({}));throw Error(t.error||('Serverfehler '+r.status))}
    await readSSE(r,(event,data)=>{
      if(pending!==request)return;
      if(event==='prose-chunk'&&typeof data.text==='string'){prose+=data.text.slice(0,4000);live.prose(prose)}
      else if(event==='artifact-start')live.sketch();
      else if(event==='retry')live.note('Ungültiges Artefakt — ein Korrekturversuch läuft …');
      else if(event==='render'){try{artifact=validateRender(data.render)}catch{errorMsg='Ungültige Antwort der Gegenseite.'}}
      else if(event==='error')errorMsg=String(data.message||'Antwort fehlgeschlagen.');
    });
  }catch(e){if(pending===request&&e.name!=='AbortError')errorMsg=e.message}
  if(pending!==request)return;
  pending=null;busy(false);
  if(target){
    // In-place refinement: replace the marked element, never append below it.
    if(artifact){
      pushVersion(target,target.render);
      target.render=artifact;
      if(prose)target.prose=prose.slice(0,8000);
      marked=null;
      save();render();
      document.querySelector('[data-mid="'+target.id+'"]')?.classList.add('updated');
      toast('Element aktualisiert — frühere Version im Verlauf des Elements.');
    }else{
      save();render();
      toast(errorMsg?('Nicht aktualisiert: '+errorMsg):'Kein aktualisiertes Element erhalten.');
    }
    document.querySelector('[data-mid="'+target.id+'"]')?.scrollIntoView({block:'center'});
    return;
  }
  if(artifact)s.messages.push({role:'assistant',id:uid(),prose,render:artifact});
  else if(errorMsg){if(prose)live.error(errorMsg);s.messages.push({role:'assistant',id:uid(),prose,error:errorMsg})}
  else if(prose)s.messages.push({role:'assistant',id:uid(),prose});
  save();render();
  $('#feed').lastElementChild?.scrollIntoView({block:'start'});
}

async function doPing(host){
  try{
    if(!csrf){const r=await fetch('/api/bootstrap');if(r.ok)csrf=(await r.json()).csrf;}
    if(!csrf)return {ok:false,error:'Server nicht erreichbar.'};
    const sid=current()?.id||'';
    const r=await fetch('/api/ping',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},body:JSON.stringify({sessionId:sid,host:String(host).slice(0,253)})});
    const t=await r.json().catch(()=>({}));
    if(!r.ok)return {ok:false,error:t.error||('HTTP '+r.status)};
    return {ok:t.ok===true,ip:t.ip,ms:t.ms,error:t.error};
  }catch{return {ok:false,error:'Ping fehlgeschlagen.'}}
}

// --- element overlay: focused view, code editor, version history ---
function openOverlay(m){
  overlayMsg=m;overlayMode='view';
  fillOverlay();
  $('#overlay').showModal?.();
}
function closeOverlay(){$('#overlay')?.close()}
$('#overlay').addEventListener('close',()=>{
  overlayView?.destroy();overlayView=null;overlayMsg=null;overlayMode='view';
  $('#ovcontent').replaceChildren();
  render();
});
function fillOverlay(){
  const m=overlayMsg;if(!m)return;
  if(overlayView){overlayView.destroy();overlayView=null}
  const c=$('#ovcontent');c.replaceChildren();
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
      onState:state=>{m.render.state=state;save()},
      onSuggest:text=>{$('#prompt').value=text;toast('Vorschlag eingefügt — nur du sendest ihn.')},
      onError:tx=>{note.textContent=tx;note.className='notice error'},
      onPing:doPing
    });
    holder.append(overlayView.element);
    const foot=document.createElement('div');foot.className='ovfoot';
    const b1=document.createElement('button');b1.type='button';b1.textContent='Mit KI bearbeiten';
    b1.onclick=()=>{closeOverlay();if(!(marked&&marked.msgId===m.id))marked={sessionId:db.current,msgId:m.id};render();$('#prompt').focus();toast('Element markiert — deine nächste Nachricht verfeinert es an Ort und Stelle.')};
    const b2=document.createElement('button');b2.type='button';b2.textContent='Code bearbeiten';b2.onclick=()=>{overlayMode='code';fillOverlay()};
    const b3=document.createElement('button');b3.type='button';b3.textContent='Versionen';b3.onclick=()=>{overlayMode='versions';fillOverlay()};
    foot.append(b1,b2,b3);body.append(foot);
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
      save();render();
      overlayMode='view';fillOverlay();
      toast(cleaned?'Angewendet — unsichere Teile wurden entfernt (wie bei KI-Antworten).':'Code-Änderung angewendet.');
    };
  }

  else{
    const list=db.elements.versions[m.id]||[];
    const wrap=document.createElement('div');wrap.className='vlist';
    if(!list.length){const p=document.createElement('p');p.className='small';p.textContent='Noch keine früheren Versionen. Verfeinerungen und Code-Bearbeitung legen hier automatisch Versionen ab.';wrap.append(p)}
    list.slice().reverse().forEach((v,i)=>{
      const row=document.createElement('div');row.className='verow';
      const info=document.createElement('span');
      const when=v.at?new Date(v.at).toLocaleString('de-CH'):'früher';
      info.textContent='v'+(list.length-i)+' · '+when+(v.render&&v.render.name?' · '+v.render.name:'');
      const rv=document.createElement('button');rv.type='button';rv.textContent='Wiederherstellen';
      rv.onclick=()=>{
        pushVersion(m,m.render);
        try{m.render=validateRender(JSON.parse(JSON.stringify(v.render)))}catch{toast('Version ungültig.');return}
        save();render();
        overlayMode='view';fillOverlay();
        toast('Alte Version wiederhergestellt — die aktuelle liegt jetzt ebenfalls im Verlauf.');
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
    const r=await fetch('/api/bootstrap');if(!r.ok)return;
    const b=await r.json();csrf=b.csrf||csrf;models=Array.isArray(b.models)?b.models:[];
    if(!models.some(m=>m.id===modelId))modelId=models[0]?.id||'';
    localStorage.setItem('form3.model',modelId);
    const s=$('#model');s.replaceChildren();
    for(const m of models){const o=document.createElement('option');o.value=m.id;o.textContent=m.label+' · '+m.model.split('/').pop();s.append(o)}
    s.classList.toggle('hidden',!models.length);
    if(models.length)s.value=modelId;
    s.onchange=()=>{modelId=s.value;localStorage.setItem('form3.model',modelId)};
  }catch{}
  if(!pending)render();
  renderModelList();
}
function openSettings(){$('#settings').showModal?.();renderModelList()}
function renderModelList(){
  const box=$('#modellist');if(!box)return;box.replaceChildren();
  if(!models.length){const p=document.createElement('p');p.className='small';p.textContent='Noch keine Modelle. Füge unten dein erstes hinzu.';box.append(p);return}
  for(const m of models){
    const row=document.createElement('div');row.className='mrow';
    const info=document.createElement('div');
    const strong=document.createElement('strong');strong.textContent=m.label+' · '+m.model;
    const span=document.createElement('span');span.className='small';
    try{span.textContent=new URL(m.baseUrl).host+' · Key '+m.keyMasked}catch{span.textContent=m.baseUrl+' · Key '+m.keyMasked}
    info.append(strong,span);
    const del=document.createElement('button');del.textContent='Löschen';del.setAttribute('aria-label','Modell '+m.label+' löschen');
    del.onclick=async()=>{try{const r=await fetch('/api/models/'+m.id,{method:'DELETE',headers:{'X-Form-CSRF':csrf}});if(!r.ok)throw 0;await refreshModels();toast('Modell gelöscht.')}catch{toast('Löschen fehlgeschlagen.')}};
    row.append(info,del);box.append(row);
  }
}
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
$('#composer').onsubmit=e=>{e.preventDefault();send($('#prompt').value)};
$('#prompt').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send(e.target.value)}};
$('#stop').onclick=stop;$('#new').onclick=newSession;
$('#mobile').onclick=()=>{$('#sidebar').classList.toggle('open');$('#mobile').setAttribute('aria-expanded',$('#sidebar').classList.contains('open'))};
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('#sidebar').classList.remove('open');$('#mobile').setAttribute('aria-expanded','false')}});
$('#export').onclick=()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(db,null,2)],{type:'application/json'}));a.href=url;a.download='form3-gespraeche.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Archiv exportiert — ohne Modelle und Keys.')};
$('#import').onclick=()=>$('#file').click();
$('#file').onchange=async e=>{
  try{
    const f=e.target.files[0];if(!f)return;
    if(f.size>1500000)throw Error('Maximal 1,5 MB');
    const data=normalize(JSON.parse(await f.text()));
    if(data.sessions.length+db.sessions.length>40)throw Error('Maximal 40 Sitzungen');
    stop();
    for(const s of data.sessions){s.id=uid();db.sessions.unshift(s)}
    db.current=db.sessions[0].id;marked=null;save();render();toast('Archiv sicher importiert.');
  }catch(err){toast('Import fehlgeschlagen: '+err.message)}
  e.target.value='';
};
if(!db.sessions.length)newSession();else{if(!current())db.current=db.sessions[0].id;render();}
refreshModels();
