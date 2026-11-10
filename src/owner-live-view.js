import {renderUI} from './renderer.js';
import {acknowledgeOwnerDbWrite} from './owner-db-ack.js';
import {ownerCodeText} from '../owner-code.mjs';
// Every replacement keeps only an inert visual snapshot of the old iframe.
// Callers own canonical state adoption and must reset their CAS queue there.
export function ownerLiveView({id,render,getRender,adopt,subscriptions,callbacks}) {
 const element=document.createElement('div');element.style.position='relative';
 let raw=null,retained=null,subscription=null,revision=null,dead=false,failed=false,pending=0,staging=false,initialized=false,generation=0,timer;
 const loading=document.createElement('p');loading.className='notice';loading.setAttribute('role','status');loading.textContent='Element wird geladen …';
 const deny=()=>({ok:false,error:'Schreiben erst nach deiner Interaktion.'});
 function invalidate(message){
  if(dead)return;failed=true;staging=false;revision=null;generation++;clearTimeout(timer);raw?.destroy();raw=null;retained?.remove();retained=null;element.replaceChildren();
  const note=document.createElement('p');note.className='notice error';note.textContent=message;
  const retry=document.createElement('button');retry.textContent='Erneut verbinden';retry.onclick=()=>{if(dead)return;failed=false;staging=false;revision=null;subscriptions.reconnect();};element.append(note,retry);
 }
 function mount(data,refresh=false){
  const token=++generation;let interacted=false;staging=true;element.dataset.ownerStaging='true';clearTimeout(timer);
  const alive=()=>!dead&&!failed&&token===generation;
  const old=raw;old?.destroy();
  if(old?.element.dataset.ready==='true'&&!old.element.dataset.staging){retained?.remove();retained=old.element;retained.inert=true;retained.tabIndex=-1;retained.style.pointerEvents='none';retained.setAttribute('aria-hidden','true');retained.dataset.retained='true';}
  else old?.element.remove();
  if(!retained)element.replaceChildren(loading);
  const operation=async fn=>{if(!alive())return deny();pending++;element.dataset.ownerPending=String(pending);subscription?.changed();try{return await fn();}finally{pending--;element.dataset.ownerPending=String(pending);if(alive())subscription?.changed();}};
  const guarded=fn=>(...args)=>{if(!alive()||(refresh&&!interacted))return Promise.resolve(deny());return operation(()=>fn?.(...args));};
  raw=renderUI(data,{...callbacks,
   onInteraction:()=>{if(alive())interacted=true;},
   onState:state=>{
    if(!alive()||(refresh&&!interacted))return;
    // The guest has already changed its visible state. The old content hash no
    // longer describes that surface, even if a recipient restores that exact
    // canonical value while our acknowledgement is held. Retain the DB/code
    // baseline so an unchanged own-write echo need not restart its Worker.
    if(revision)revision={...revision,stateRevision:null};
    return operation(()=>callbacks.onState?.(state));
   },
   onAction:guarded(callbacks.onAction),onConnection:guarded(callbacks.onConnection),
   onDb:p=>{
    if(!alive())return Promise.resolve(deny());
    if(refresh&&!interacted&&p.dbop!=='select')return Promise.resolve(deny());
    // Read completion affects readiness, not the stored revision.
    if(p.dbop==='select')return callbacks.onDb?.(p);
    return operation(async()=>{
     const result=await callbacks.onDb?.(p);
     if(alive())revision=acknowledgeOwnerDbWrite(revision,result);
     return result;
    });
   },
   onError:(text,detail)=>{if(!alive())return;if(detail?.fatal===false)callbacks.onError?.(text);else invalidate(text);},
   onReady:()=>{if(!alive())return;clearTimeout(timer);loading.remove();retained?.remove();retained=null;raw.element.style.position='';raw.element.style.inset='';raw.element.style.opacity='';raw.element.inert=false;delete raw.element.dataset.staging;staging=false;element.dataset.ownerStaging='false';subscription?.ready();}
  });
  if(retained){raw.element.dataset.staging='true';raw.element.inert=true;Object.assign(raw.element.style,{position:'absolute',inset:'0 auto auto 0',width:'100%',opacity:'0'});}
  element.append(raw.element);timer=setTimeout(()=>{if(alive())invalidate('Aktualisierung nicht rechtzeitig geladen. Bitte erneut verbinden.');},30000);
 }
 try{
  subscription=subscriptions.subscribe(id,{
   current:()=>revision,busy:()=>pending>0||staging,
   invalidate,
   reconnect:()=>{if(!dead){failed=false;staging=false;revision=null;}},
   apply:next=>{
    if(dead||failed)return;
    const current=getRender();
    const same=raw&&ownerCodeText(current)===ownerCodeText(next.render)&&JSON.stringify(current.state)===JSON.stringify(next.render.state)&&revision?.dbRevision===next.dbRevision;
    revision=next;if(same)return;
    const refresh=initialized;initialized=true;adopt(next.render);mount(next.render,refresh);
   }
  });
  // Establish the canonical DB baseline before any guest reads or writes.
  // Otherwise a later first snapshot can bless stale initial DB content.
  element.append(loading);
 }catch(error){invalidate(error.message);}
 return {element,inspect:()=>raw?.inspect()||Promise.reject(Error('Ansicht nicht verfügbar.')),destroy(){if(dead)return;dead=true;generation++;clearTimeout(timer);subscription?.destroy();raw?.destroy();retained?.remove();retained=null;}};
}
