import {createHash} from 'node:crypto';
import {ownerCodeText} from './owner-code.mjs';
import {elementStateRevision} from './element-sharing.mjs';
import {validateRender} from './contract.mjs';
const unavailable=()=>{throw Error('Element nicht verfügbar.');};
const hash=text=>createHash('sha256').update(text).digest('hex');
// Revision notifications only: never stream chats, source, table rows or actions.
// The same authenticated owner check is repeated for every delivery and fetch.
export class OwnerElementStreams {
 constructor(sharing,{interval=1000,maxPerUser=2}={}){this.sharing=sharing;this.interval=interval;this.maxPerUser=maxPerUser;this.counts=new Map();}
 ids(value){if(!Array.isArray(value)||!value.length||value.length>12||value.some(id=>typeof id!=='string'||!id.length||id.length>80)||new Set(value).size!==value.length)throw Error('Ungültige Elementauswahl.');return [...value];}
 owned(uid,id){const s=this.sharing.store,u=s.getUser(uid),owner=s.messageOwner(id);if(!u||u.disabled||!owner?.hasRender||owner.userId!==uid)unavailable();const render=validateRender(s.getRender(id));return {owner,render};}
 revision(id,owner,render){return {id,stateRevision:elementStateRevision(render.state),ownerCodeRevision:hash(ownerCodeText(render)),dbRevision:this.sharing.elementDB.revision(owner.conversationId,id)};}
 snapshot(uid,id){this.ids([id]);return this.sharing.locked(()=>{const {owner,render}=this.owned(uid,id);return {...this.revision(id,owner,render),render};});}
 check(uid,ids){return this.sharing.locked(()=>this.ids(ids).map(id=>{const {owner,render}=this.owned(uid,id);return this.revision(id,owner,render);}));}
 open({uid,ids,res,sessionValid}){
  ids=this.ids(ids);if((this.counts.get(uid)||0)>=this.maxPerUser)return false;
  this.counts.set(uid,(this.counts.get(uid)||0)+1);let stopped=false,timer,last=null;
  const stop=()=>{if(stopped)return;stopped=true;clearInterval(timer);const n=this.counts.get(uid)-1;if(n)this.counts.set(uid,n);else this.counts.delete(uid);res.end();};
  const send=(event,data)=>res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
  res.on('close',stop);res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no','Connection':'keep-alive'});
  const tick=()=>{if(stopped||res.destroyed)return stop();try{this.sharing.locked(()=>{
   if(!sessionValid())unavailable();const revisions=ids.map(id=>{const {owner,render}=this.owned(uid,id);return this.revision(id,owner,render);});const key=JSON.stringify(revisions);
   const ok=key===last?send('heartbeat',{}):send('revisions',{elements:revisions});last=key;if(!ok)stop();
  });}catch{if(!res.destroyed)send('invalidated',{});stop();}};
  timer=setInterval(tick,this.interval);timer.unref?.();tick();return true;
 }
}
