import {renderUI} from './renderer.js';
import {ownerCodeText} from '../owner-code.mjs';
// Every replacement keeps only an inert visual snapshot of the old iframe.
// Callers own canonical state adoption and must reset their CAS queue there.
export function ownerLiveView({id,render,getRender,adopt,subscriptions,callbacks}) {
 const element=document.createElement('div');element.style.position='relative';
 let raw=null,retained=null,subscription=null,revision=null,dead=false,failed=false,pending=0,staging=true,generation=0,timer;
 const deny=()=>({ok:false,error:'Schreiben erst nach deiner Interaktion.'});
 function invalidate(message){
  if(dead)return;failed=true;generation++;clearTimeout(timer);raw?.destroy();raw=null;retained?.remove();retained=null;element.replaceChildren();
  const note=document.createElement('p');note.className='notice error';note.textContent=message;
  const retry=document.createElement('button');retry.textContent='Erneut verbinden';retry.onclick=()=>{if(dead)return;failed=false;staging=false;revision=null;subscriptions.reconnect();};element.append(note,retry);
 }
 function mount(data,refresh=false){
  const token=++generation;let interacted=false;staging=true;clearTimeout(timer);
  const alive=()=>!dead&&!failed&&token===generation;
  const old=raw;old?.destroy();
  if(old?.element.dataset.ready==='true'&&!old.element.dataset.staging){retained?.remove();retained=old.element;retained.inert=true;retained.tabIndex=-1;retained.style.pointerEvents='none';retained.setAttribute('aria-hidden','true');retained.dataset.retained='true';}
  else old?.element.remove();
  if(!retained)element.replaceChildren();
  const operation=async fn=>{if(!alive())return deny();pending++;subscription?.changed();try{return await fn();}finally{pending--;if(alive())subscription?.changed();}};
  const guarded=fn=>(...args)=>{if(!alive()||(refresh&&!interacted))return Promise.resolve(deny());return operation(()=>fn?.(...args));};
  raw=renderUI(data,{...callbacks,
   onInteraction:()=>{if(alive())interacted=true;},
   onState:state=>{if(!alive()||(refresh&&!interacted))return;return operation(()=>callbacks.onState?.(state));},
   onAction:guarded(callbacks.onAction),onConnection:guarded(callbacks.onConnection),
   onDb:p=>{
    if(!alive())return Promise.resolve(deny());
    if(refresh&&!interacted&&p.dbop!=='select')return Promise.resolve(deny());
    // Read completion affects readiness, not the stored revision.
    if(p.dbop==='select')return callbacks.onDb?.(p);
    return operation(()=>callbacks.onDb?.(p));
   },
   onError:text=>{if(alive())invalidate(text);},
   onReady:()=>{if(!alive())return;clearTimeout(timer);retained?.remove();retained=null;raw.element.style.position='';raw.element.style.inset='';raw.element.style.opacity='';raw.element.inert=false;delete raw.element.dataset.staging;staging=false;subscription?.changed();}
  });
  if(retained){raw.element.dataset.staging='true';raw.element.inert=true;Object.assign(raw.element.style,{position:'absolute',inset:'0 auto auto 0',width:'100%',opacity:'0'});}
  element.append(raw.element);timer=setTimeout(()=>{if(alive())invalidate('Aktualisierung nicht rechtzeitig geladen. Bitte erneut verbinden.');},30000);
 }
 try{
  subscription=subscriptions.subscribe(id,{
   current:()=>revision,busy:()=>pending>0||staging,
   invalidate,
   apply:next=>{
    if(dead||failed)return;
    const current=getRender();
    const same=raw&&ownerCodeText(current)===ownerCodeText(next.render)&&JSON.stringify(current.state)===JSON.stringify(next.render.state)&&(!revision||revision.dbRevision===next.dbRevision);
    revision=next;if(same)return;
    adopt(next.render);mount(next.render,true);
   }
  });
  mount(render);
 }catch(error){invalidate(error.message);}
 return {element,inspect:()=>raw?.inspect()||Promise.reject(Error('Ansicht nicht verfügbar.')),destroy(){if(dead)return;dead=true;generation++;clearTimeout(timer);subscription?.destroy();raw?.destroy();retained?.remove();retained=null;}};
}
