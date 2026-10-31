import {safeHTML,safeCSS,safeFragment} from './sanitize.js';

const HOST_OK=/^[a-z0-9.-]{1,253}$/i;

export function bridge(){
  const channel=document.currentScript.dataset.channel;
  const send=(type,data={})=>parent.postMessage({channel,type,...data},'*');
  let port;
  addEventListener('message',e=>{
    if(e.source!==parent||e.data?.channel!==channel||!e.ports[0]||port)return;
    port=e.ports[0];
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
          el.innerHTML=(el.namespaceURI==='http://www.w3.org/2000/svg'&&typeof o.svg==='string')?o.svg:o.html;
        if(o.op==='attr'&&['d','points','aria-pressed','aria-label'].includes(o.name)&&typeof o.value==='string'&&o.value.length<8000)
          el.setAttribute(o.name,o.value);
        if(o.op==='on'&&['click','input','change'].includes(o.event)){
          el['on'+o.event]=()=>port.postMessage({type:'event',id:o.id,event:o.event,value:{value:String(el.value??'').slice(0,1000),checked:!!el.checked}});
        }
      }
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


export function renderUI(data,{onState,onSuggest,onError,onPing,onDb}={}){
  const f=document.createElement('iframe');
  f.className='render';
  f.title='Form · interaktive Antwort';
  f.sandbox='allow-scripts';
  f.referrerPolicy='no-referrer';
  f.setAttribute('allow',"camera 'none'; microphone 'none'; geolocation 'none'");
  const channel=crypto.randomUUID(),nonce=crypto.randomUUID();
  let worker,port,timer,inflight=false;
  const asyncQ=[]; // pending synthetic-event deliveries (ping/db results)
  const html=safeHTML(data.html),css=safeCSS(data.css);
  const listener=e=>{
    if(e.source!==f.contentWindow||e.origin!=='null'||e.data?.channel!==channel)return;
    if(e.data.type==='resize')f.style.height=Math.min(2400,Math.max(120,Number(e.data.height)||120))+'px';
    if(e.data.type!=='ready'||worker)return;
    const ch=new MessageChannel();
    port=ch.port1;
    f.contentWindow.postMessage({channel},'*',[ch.port2]);
    worker=new Worker('/worker.js',{type:'module'});
    const dispatch=d=>{
      if(!worker||inflight)return;
      inflight=true;
      clearTimeout(timer);
      timer=setTimeout(()=>{worker.terminate();onError('Interaktion angehalten (Zeitlimit).');},3000);
      worker.postMessage(d);
    };
    const deliver=(id,event,value)=>{
      asyncQ.push({id,event,value});
      pumpAsync();
    };
    const pumpAsync=()=>{
      while(worker&&!inflight&&asyncQ.length){
        const j=asyncQ.shift();
        inflight=true;
        clearTimeout(timer);
        timer=setTimeout(()=>{worker.terminate();onError('Interaktion angehalten (Zeitlimit).');},3000);
        worker.postMessage({type:'event',id:j.id,event:j.event,value:j.value});
      }
    };
    port.onmessage=({data:d})=>{
      if(d?.type==='event')dispatch(d);
      if(d?.type==='misuse')onError('Hinweis: ui.value gilt nur für Eingabefelder — dynamische Inhalte gehören in ui.html.');
    };
    worker.onmessage=({data:d})=>{
      inflight=false;clearTimeout(timer);
      if(d.type==='error')return onError(d.message);
      if(d.type!=='ops'||!Array.isArray(d.ops)||d.ops.length>250){pumpAsync();return;}
      const dom=[];
      for(const o of d.ops){
        if(o.op==='state'){
          if(o.state&&typeof o.state==='object'&&!Array.isArray(o.state)&&JSON.stringify(o.state).length<=4096)onState(o.state);
        }else if(o.op==='suggest'){
          if(typeof o.text==='string')onSuggest(o.text.slice(0,500));
        }else if(o.op==='html'){
          if(typeof o.id==='string'&&typeof o.html==='string'&&o.html.length<=24000){
            try{const fr=safeFragment(o.html);dom.push({op:'html',id:o.id,html:fr.html,svg:fr.svg})}catch{}
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
    worker.onerror=()=>{clearTimeout(timer);onError('Interaktion konnte nicht gestartet werden.');};
    dispatch({type:'init',js:data.js,state:data.state});
  };
  addEventListener('message',listener);
  f.srcdoc='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;nonce-'+nonce+'&apos;; style-src &apos;unsafe-inline&apos;; connect-src &apos;none&apos;; img-src &apos;none&apos;; form-action &apos;none&apos;; base-uri &apos;none&apos;; frame-src &apos;none&apos;; object-src &apos;none&apos;"><style>*{box-sizing:border-box}html,body{margin:0;background:#141718;color:#e9e9de;font:15px/1.5 system-ui;overflow-x:hidden}body{padding:4px 0 20px}button,input,select{font:inherit;accent-color:#d4ef8b}button{cursor:pointer}svg{max-width:100%}'+css+'</style></head><body>'+html+'<script nonce="'+nonce+'" data-channel="'+channel+'">('+bridge.toString()+')();</scr'+'ipt></body></html>';
  return {
    element:f,
    destroy(){
      removeEventListener('message',listener);
      clearTimeout(timer);
      worker?.terminate();
      port?.close();
      asyncQ.length=0;
    }
  };
}
