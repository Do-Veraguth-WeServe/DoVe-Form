import {safeHTML,safeCSS,safeFragment} from './sanitize.js';

const HOST_OK=/^[a-z0-9.-]{1,253}$/i;

export function bridge(){
  const channel=document.currentScript.dataset.channel;
  const send=(type,data={})=>parent.postMessage({channel,type,...data},'*');
  let port,scrollParent=false,touch=null;
  // Only app-owned bootstrap sees real touch events; guest JS has no scrolling API.
  addEventListener('touchstart',e=>{
    if(!scrollParent||!e.isTrusted||e.touches.length!==1){touch=null;return;}
    const t=e.touches[0];touch={x:t.screenX,y:t.screenY,lastY:t.screenY,vertical:false};
  },{passive:true});
  addEventListener('touchmove',e=>{
    if(!touch||!e.isTrusted||e.touches.length!==1)return;
    const t=e.touches[0],dy=touch.lastY-t.screenY;
    if(!touch.vertical){
      if(Math.abs(t.screenY-touch.y)<8)return;
      if(Math.abs(t.screenX-touch.x)>Math.abs(t.screenY-touch.y)){touch=null;return;}
      touch.vertical=true;
    }
    e.preventDefault();touch.lastY=t.screenY;
    port?.postMessage({type:'scroll-parent',delta:Math.max(-160,Math.min(160,dy))});
  },{passive:false});
  for(const type of ['touchend','touchcancel'])addEventListener(type,()=>{touch=null;},{passive:true});
  addEventListener('message',e=>{
    if(e.source!==parent||e.data?.channel!==channel||!e.ports[0]||port)return;
    port=e.ports[0];scrollParent=e.data.scrollParent===true;
    port.onmessage=({data:ops})=>{
      if(!Array.isArray(ops)||ops.length>250)return;
      for(const o of ops){
        if(!o||typeof o.id!=='string'||o.id.length>100)continue;
        const el=document.getElementById(o.id);
        if(!el)continue;
        if(o.op==='text'&&typeof o.value==='string')el.textContent=o.value.slice(0,8000);
        if(o.op==='value'&&typeof o.value==='string'){
          if(['INPUT','SELECT'].includes(el.tagName))el.value=o.value.slice(0,1000);
          else port.postMessage({type:'misuse',id:o.id});
        }
        if(o.op==='html'&&typeof o.html==='string'&&o.html.length<=24000&&!['INPUT','SELECT','TEXTAREA'].includes(el.tagName))
          el.innerHTML=el.namespaceURI==='http://www.w3.org/2000/svg'&&typeof o.svg==='string'?o.svg:
            el.tagName==='TABLE'&&typeof o.table==='string'?o.table:
            ['TBODY','THEAD','TFOOT'].includes(el.tagName)&&typeof o.section==='string'?o.section:
            el.tagName==='TR'&&typeof o.row==='string'?o.row:o.html;
        if(o.op==='attr'&&['d','points','aria-pressed','aria-label'].includes(o.name)&&typeof o.value==='string'&&o.value.length<8000)
          el.setAttribute(o.name,o.value);
        if(o.op==='on'&&['click','input','change','keydown'].includes(o.event)){
          if(o.event==='keydown')el.setAttribute('tabindex','0');
          el['on'+o.event]=e=>{if(o.event==='keydown'&&['Space','ArrowUp'].includes(e.code))e.preventDefault();port.postMessage({type:'event',id:o.id,event:o.event,value:{value:String(el.value??'').slice(0,1000),checked:!!el.checked,key:String(e.key||'').slice(0,30),code:String(e.code||'').slice(0,30),repeat:!!e.repeat}});};
        }
      }
      port.postMessage({type:'applied'});
    };
    port.start();
  });
  let last=0;
  new ResizeObserver(()=>{
    const h=Math.min(2400,Math.max(120,document.body.scrollHeight));
    if(h!==last){last=h;send('resize',{height:h});}
  }).observe(document.body);
  send('ready');
}


export function renderUI(data,{onState,onSuggest,onError,onPing,onDb,onAction}={}){
  const f=document.createElement('iframe');
  f.className='render';
  f.style.visibility='hidden';f.setAttribute('aria-busy','true');
  f.title='Form · interaktive Antwort';
  f.sandbox='allow-scripts';
  f.referrerPolicy='no-referrer';
  f.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'");
  const channel=crypto.randomUUID(),nonce=crypto.randomUUID();
  let worker,port,timer,clock,inflight=false,stopped=false;
  const asyncQ=[]; // pending synthetic-event deliveries (ping/db results)
  const html=safeHTML(data.html),css=safeCSS(data.css);
  const listener=e=>{
    if(e.source!==f.contentWindow||e.origin!=='null'||e.data?.channel!==channel)return;
    if(e.data.type==='resize')f.style.height=Math.min(2400,Math.max(120,Number(e.data.height)||120))+'px';
    if(e.data.type!=='ready'||worker)return;
    const ch=new MessageChannel();
    port=ch.port1;
    f.contentWindow.postMessage({channel,scrollParent:!!f.closest('#feed')},'*',[ch.port2]);
    worker=new Worker('/worker.js',{type:'module'});
    const dispatch=d=>{
      if(!worker||stopped)return;
      if(inflight){if(d.type==='event'&&asyncQ.length<32)asyncQ.push({id:d.id,event:d.event,value:d.value});return;}
      inflight=true;
      clearTimeout(timer);
      timer=setTimeout(()=>{stopped=true;clearInterval(clock);worker.terminate();onError(d.type==='init'?'Interaktions-Engine konnte nicht rechtzeitig geladen werden. Bitte erneut öffnen.':'Interaktion angehalten (Zeitlimit).');},d.type==='init'?30000:3000);
      worker.postMessage(d);
    };
    const deliver=(id,event,value)=>{
      asyncQ.push({id,event,value});
      pumpAsync();
    };
    const pumpAsync=()=>{
      while(worker&&!stopped&&!inflight&&asyncQ.length){
        const j=asyncQ.shift();
        inflight=true;
        clearTimeout(timer);
        timer=setTimeout(()=>{stopped=true;clearInterval(clock);worker.terminate();onError('Interaktion angehalten (Zeitlimit).');},3000);
        worker.postMessage({type:'event',id:j.id,event:j.event,value:j.value});
      }
    };
    port.onmessage=({data:d})=>{
      if(d?.type==='applied'){f.style.visibility='';f.removeAttribute('aria-busy');f.dataset.ready='true';}
      if(d?.type==='scroll-parent'&&Number.isFinite(d.delta)&&Math.abs(d.delta)<=160){
        const feed=f.closest('#feed');if(feed&&f.isConnected)feed.scrollTop+=d.delta;
      }
      if(d?.type==='event')dispatch(d);
      if(d?.type==='misuse')onError('Hinweis: ui.value gilt nur für Eingabefelder — dynamische Inhalte gehören in ui.html.');
    };
    worker.onmessage=({data:d})=>{
      if(d.type==='engine-ready'){
        clearTimeout(timer);
        timer=setTimeout(()=>{stopped=true;clearInterval(clock);worker.terminate();onError('Interaktion angehalten (Zeitlimit).');},3000);
        return;
      }
      inflight=false;clearTimeout(timer);
      if(d.type==='error'){stopped=true;clearInterval(clock);return onError(d.message);}
      if(d.type!=='ops'||!Array.isArray(d.ops)||d.ops.length>250){pumpAsync();return;}
      const dom=[];
      for(const o of d.ops){
        if(o.op==='clock'){
          clearInterval(clock);if(Number.isFinite(o.ms))clock=setInterval(()=>{if(!stopped&&f.isConnected&&!document.hidden&&!inflight&&!asyncQ.length)dispatch({type:'event',id:'__clock',event:'tick',value:{dt:Math.max(50,Math.min(1000,o.ms))}});},Math.max(50,Math.min(1000,o.ms)));
        }else if(o.op==='state'){
          if(o.state&&typeof o.state==='object'&&!Array.isArray(o.state)&&JSON.stringify(o.state).length<=4096)onState(o.state);
        }else if(o.op==='suggest'){
          if(typeof o.text==='string')onSuggest(o.text.slice(0,500));
        }else if(o.op==='html'){
          if(typeof o.id==='string'&&typeof o.html==='string'&&o.html.length<=24000){
            try{const fr=safeFragment(o.html);dom.push({op:'html',id:o.id,html:fr.html,svg:fr.svg,table:fr.table,section:fr.section,row:fr.row})}catch{}
          }
        }else if(o.op==='ping'){
          const ref=typeof o.ref==='string'?o.ref.slice(0,32):'';
          const host=typeof o.host==='string'?o.host.slice(0,253):'';
          if(!ref||!HOST_OK.test(host)||!host.includes('.'))deliver('__ping:'+ref,'ping',{host,ok:false,error:'Ungültiger Host.'});
          else if(asyncQ.length>=8)deliver('__ping:'+ref,'ping',{host,ok:false,error:'Zu viele offene Pings.'});
          else Promise.resolve(typeof onPing==='function'?onPing(host):undefined)
            .then(v=>(v&&typeof v==='object')?v:{ok:false,error:'Ping nicht verfügbar.'})
            .catch(()=>({ok:false,error:'Ping fehlgeschlagen.'}))
            .then(v=>deliver('__ping:'+ref,'ping',{
              host,
              ok:v.ok===true,
              ip:typeof v.ip==='string'?v.ip.slice(0,64):undefined,
              ms:typeof v.ms==='number'&&isFinite(v.ms)?Math.round(v.ms):undefined,
              error:typeof v.error==='string'?v.error.slice(0,120):undefined
            }));
        }else if(o.op==='action'){
          const ref=String(o.ref||'');
          if(!/^a[0-9]{1,8}$/.test(ref)||typeof o.name!=='string'||o.name.length>60||!o.inputs||typeof o.inputs!=='object'||JSON.stringify(o.inputs).length>6000||asyncQ.length>=8){
            deliver('__action:'+ref,'action',{ok:false,error:'Ungültige Aktion.'});
          }else Promise.resolve(typeof onAction==='function'?onAction(o.name,o.inputs):Promise.reject(Error('Aktion nicht verknüpft.')))
            .then(result=>deliver('__action:'+ref,'action',{ok:true,result}))
            .catch(()=>deliver('__action:'+ref,'action',{ok:false,error:'Aktion nicht abgeschlossen. Freigabe und Ergebnis prüfen.'}));
        }else if(o.op==='db'){
          const ref=typeof o.ref==='string'?o.ref.slice(0,32):'';
          const dbop=typeof o.dbop==='string'?o.dbop:'';
          const table=typeof o.table==='string'?o.table.slice(0,64):'';
          const args=Array.isArray(o.args)?o.args.slice(0,3):null;
          if(!ref||!['create','drop','insert','select','update','delete'].includes(dbop)||!/^[a-z0-9_]{1,32}$/.test(table)||!args)
            deliver('__db:'+ref,'db',{ok:false,error:'Ungültige Datenbank-Anfrage.'});
          else if(asyncQ.length>=8)deliver('__db:'+ref,'db',{ok:false,error:'Zu viele offene Anfragen.'});
          else Promise.resolve(typeof onDb==='function'?onDb({dbop,table,args}):undefined)
            .then(v=>(v&&typeof v==='object')?v:{ok:false,error:'Datenbank nicht verfügbar.'})
            .catch(()=>({ok:false,error:'Datenbankfehler.'}))
            .then(v=>deliver('__db:'+ref,'db',{
              ok:v.ok===true,
              id:typeof v.id==='number'&&Number.isFinite(v.id)?v.id:undefined,
              rows:Array.isArray(v.rows)?v.rows.slice(0,500):undefined,
              truncated:v.truncated===true||undefined,
              error:typeof v.error==='string'?v.error.slice(0,160):undefined
            }));
        }else dom.push(o);
      }
      port.postMessage(dom);
      pumpAsync();
    };
    worker.onerror=()=>{stopped=true;clearInterval(clock);clearTimeout(timer);onError('Interaktion konnte nicht gestartet werden.');};
    dispatch({type:'init',js:data.js,state:data.state});
  };
  addEventListener('message',listener);
  f.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;nonce-'+nonce+'&apos;; style-src &apos;unsafe-inline&apos;; connect-src &apos;none&apos;; img-src &apos;none&apos;; form-action &apos;none&apos;; base-uri &apos;none&apos;; frame-src &apos;none&apos;; object-src &apos;none&apos;"><style>*{box-sizing:border-box}html,body{margin:0;background:#141718;color:#e9e9de;font:15px/1.5 system-ui;overflow-x:hidden}body{padding:4px 0 20px}button,input,select{font:inherit;accent-color:#d4ef8b}button{cursor:pointer}svg{max-width:100%}'+css+'</style></head><body>'+html+'<script nonce="'+nonce+'" data-channel="'+channel+'">('+bridge.toString()+')();</scr'+'ipt></body></html>';
  return {
    element:f,
    destroy(){
      removeEventListener('message',listener);
      clearTimeout(timer);
      stopped=true;clearInterval(clock);
      worker?.terminate();
      port?.close();
      asyncQ.length=0;
    }
  };
}
