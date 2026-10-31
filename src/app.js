import {renderUI} from './renderer.js';
import {validateRender} from '../contract.mjs';
const $=s=>document.querySelector(s),uid=()=>crypto.randomUUID(),KEY='form.v3';
let db,csrf='',models=[],modelId=localStorage.getItem('form3.model')||'',pending=null,views=[];
const current=()=>db.sessions.find(s=>s.id===db.current);
function toast(t){$('#live').textContent=t;const n=document.createElement('div');n.className='toast';n.textContent=t;document.body.append(n);setTimeout(()=>n.remove(),4000)}
function save(){try{localStorage.setItem(KEY,JSON.stringify(db))}catch{toast('Speicher voll — bitte exportieren.')}}
function normalize(x){if(x?.version!==3||!Array.isArray(x.sessions)||x.sessions.length>40)throw Error('Ungültiges Archiv');return {version:3,current:x.current,sessions:x.sessions.map(s=>{if(typeof s.id!=='string'||!/^[0-9a-f-]{36}$/.test(s.id)||typeof s.title!=='string'||!Array.isArray(s.messages)||s.messages.length>100)throw Error('Ungültige Sitzung');return {id:s.id,title:s.title.slice(0,80),messages:s.messages.map(m=>{if(m.role==='user'&&typeof m.text==='string')return {role:'user',id:uid(),text:m.text.slice(0,2000)};if(m.role==='assistant'){if(typeof m.error==='string')return {role:'assistant',id:uid(),error:m.error.slice(0,300)};const prose=typeof m.prose==='string'?m.prose.slice(0,8000):'';if(m.render)return {role:'assistant',id:uid(),prose,render:validateRender(m.render)};if(prose)return {role:'assistant',id:uid(),prose};}throw Error('Ungültige Nachricht')})}})}}
try{db=normalize(JSON.parse(localStorage.getItem(KEY)))}catch{db={version:3,sessions:[]}}
function history(s){return s.messages.slice(-12).map(m=>m.role==='user'?{role:'user',content:m.text}:{role:'assistant',content:(m.prose?m.prose.slice(0,1500):'')+(m.render?(m.prose?' ':'')+'[enthielt ein interaktives Artefakt]':(m.error?'[Fehler]':''))||'[leer]'})}
function states(s){return s.messages.filter(m=>m.render).slice(-3).map(m=>({id:m.id,state:m.render.state}))}
function sketchEl(){const d=document.createElement('div');d.className='sketch';d.setAttribute('aria-hidden','true');d.innerHTML='<svg viewBox="0 0 130 72"><path d="M6 60 L28 12 L50 44 L72 8 L94 52 L116 20"/><circle cx="104" cy="46" r="16"/><line x1="6" y1="66" x2="124" y2="66"/><polygon points="16,8 34,8 25,22"/></svg>';return d}
function busy(on){$('#stop').classList.toggle('hidden',!on);$('#send').classList.toggle('hidden',on)}
function stop(){if(!pending)return;pending.controller.abort();pending=null;busy(false);toast('Antwort gestoppt.');render()}
function newSession(){stop();if(db.sessions.length>=40)return toast('Maximal 40 Sitzungen');const s={id:uid(),title:'Neuer Gedankengang',messages:[]};db.sessions.unshift(s);db.current=s.id;save();render();$('#sidebar').classList.remove('open')}
function updateComposer(){const has=models.length>0;$('#send').disabled=!has;$('#statuslabel').textContent=has?'LOKAL · BEREIT':'KEIN MODELL';$('#prompt').placeholder=has?'Was möchtest du durchdenken?':'Zuerst ein Modell hinzufügen (⚙ oben rechts)'}
function render(){
  views.forEach(v=>v.destroy());views=[];
  $('#sessions').replaceChildren();
  for(const s of db.sessions){const b=document.createElement('button');b.textContent=s.title;b.setAttribute('aria-current',s.id===db.current);b.onclick=()=>{stop();db.current=s.id;save();render();$('#sidebar').classList.remove('open')};$('#sessions').append(b)}
  const feed=$('#feed');
  feed.innerHTML='<section class="intro"><div class="eyebrow">Ein Gespräch. Unendlich viele Formen.</div><h1>Antworten, die<br><em>denken und zeigen.</em></h1><p>Form antwortet zuerst in klarem Text — und baut daraus, wenn es wirklich hilft, ein kleines interaktives Werkzeug. Läuft komplett lokal auf deinem Rechner.</p><div class="starters"><button data-p="Zeig mir einen Spar-Rechner mit Slider">↗ Sparziel erkunden</button><button data-p="Vergleiche drei Ideen als interaktive Grafik">◇ Ideen vergleichen</button><button data-p="Erkläre mir kurz, was ein VPN macht — prose only">◇ Nur Text gefragt</button></div></section>';
  if(!models.length)feed.insertAdjacentHTML('beforeend','<section class="empty" id="emptystate"><div class="eyebrow">Schritt 1 · Noch kein Modell</div><h2>Verbinde dein erstes Modell.</h2><p>Form läuft komplett lokal. Füge ein OpenAI-kompatibles Modell hinzu (z. B. z.ai, OpenRouter oder Ollama) — Base-URL, Modell-ID und API-Key. Der Key bleibt in <code>form.models.json</code> auf deinem Rechner und wird nie angezeigt oder exportiert.</p><button id="emptyadd">⚙ Modell hinzufügen</button></section>');
  if(current().messages.length>12){const h=document.createElement('p');h.className='notice';h.textContent='Die letzten 12 Nachrichten sind geöffnet. Das vollständige Gespräch bleibt im Export erhalten.';feed.append(h)}
  for(const m of current().messages.slice(-12)){
    const article=document.createElement('article');article.className='message '+(m.role==='user'?'user':'assistant');
    if(m.role==='user'){const b=document.createElement('div');b.className='bubble';b.textContent=m.text;article.append(b)}
    else{
      article.innerHTML='<div class="byline"><span>⌑</span> FORM <small>/ KI · ISOLIERT</small></div>';
      if(m.error){const n=document.createElement('div');n.className='notice error';n.textContent=m.error;article.append(n)}
      else{
        if(m.prose){const p=document.createElement('p');p.className='prose';p.textContent=m.prose;article.append(p)}
        if(m.render){
          const note=document.createElement('div');note.className='small';
          const view=renderUI(m.render,{onState:state=>{m.render.state=state;save()},onSuggest:text=>{$('#prompt').value=text;toast('Vorschlag eingefügt — nur du sendest ihn.')},onError:text=>{note.textContent=text;note.className='notice error'}});
          views.push(view);article.append(view.element,note);
          const b=document.createElement('button');b.textContent='Mit diesen Werten weiterdenken ↗';b.onclick=()=>{$('#prompt').value='Denke mit meinen aktuellen Einstellungen weiter.';$('#prompt').focus();toast('Werte werden erst mit deiner Nachricht gesendet.')};article.append(b);
        }
      }
    }
    feed.append(article);
  }
  feed.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>send(b.dataset.p));
  const add=$('#emptyadd');if(add)add.onclick=openSettings;
  updateComposer();
}
function liveMessage(){
  const feed=$('#feed');
  const a=document.createElement('article');a.className='message assistant live';
  a.innerHTML='<div class="byline"><span>⌑</span> FORM <small>/ STREAMT</small></div>';
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
  s.messages.push({role:'user',id:uid(),text});
  if(s.messages.length===1)s.title=text.slice(0,45);
  $('#prompt').value='';save();render();
  const live=liveMessage();
  const request={id:uid(),controller:new AbortController()};
  pending=request;busy(true);
  let prose='',artifact=null,errorMsg=null;
  try{
    if(!csrf){const r=await fetch('/api/bootstrap');if(r.ok)csrf=(await r.json()).csrf;}
    if(!csrf)throw Error('Server nicht erreichbar.');
    const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Form-CSRF':csrf},signal:request.controller.signal,body:JSON.stringify({version:1,sessionId:s.id,requestId:request.id,text,history:history(s),states:states(s),model:modelId||undefined})});
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
  if(artifact)s.messages.push({role:'assistant',id:uid(),prose,render:artifact});
  else if(errorMsg){if(prose)live.error(errorMsg);s.messages.push({role:'assistant',id:uid(),prose,error:errorMsg})}
  else if(prose)s.messages.push({role:'assistant',id:uid(),prose});
  save();render();
  $('#feed').lastElementChild?.scrollIntoView({block:'start'});
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
    db.current=db.sessions[0].id;save();render();toast('Archiv sicher importiert.');
  }catch(err){toast('Import fehlgeschlagen: '+err.message)}
  e.target.value='';
};
if(!db.sessions.length)newSession();else{if(!current())db.current=db.sessions[0].id;render();}
refreshModels();
