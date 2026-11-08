import {createHash,randomUUID} from 'node:crypto';
import {ownerCodeText} from './owner-code.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
export const observationRevisions=render=>({codeRevision:hash(ownerCodeText(render)),renderRevision:hash(ownerCodeText({payload:render}))});
const fail=(status)=>{throw Object.assign(Error(status===404?'Nicht gefunden.':status===409?'Elementstand veraltet.':'Ungültige Beobachtung.'),{status});};
const keys=(o,allowed)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>allowed.includes(k));
export function boundedObservation(x){
 if(!keys(x,['runtimeError','htmlWarning','layout'])||typeof x.runtimeError!=='boolean'||typeof x.htmlWarning!=='boolean')fail(400);
 const l=x.layout;if(!keys(l,['nodes','width','height','overflowX'])||typeof l.overflowX!=='boolean')fail(400);
 for(const [k,max] of [['nodes',600],['width',10000],['height',100000]])if(!Number.isInteger(l[k])||l[k]<0||l[k]>max)fail(400);
 return {runtimeError:x.runtimeError,htmlWarning:x.htmlWarning,layout:{nodes:l.nodes,width:l.width,height:l.height,overflowX:l.overflowX}};
}
// Ephemeral, bounded, owner/session scoped. Authenticated client claims are NOT
// attested browser truth. Never stores error strings, DOM text, source or IDs.
export class LiveDiagnostics {
 constructor(store,{now=Date.now}={}){this.store=store;this.now=now;this.leases=new Map();this.samples=new Map();}
 context(userId,conversationId,messageId){
  const o=this.store.messageOwner(messageId);
  if(!o?.hasRender||o.userId!==userId||o.conversationId!==conversationId)fail(404);
  return observationRevisions(this.store.getRender(messageId));
 }
 prune(){const now=this.now();for(const map of [this.leases,this.samples])for(const [k,v] of map)if(v.expiresAt<=now)map.delete(k);}
 start(userId,sessionId,d){
  if(!keys(d,['conversationId','messageId','codeRevision','renderRevision']))fail(400);
  const rev=this.context(userId,d.conversationId,d.messageId);
  if(d.codeRevision!==rev.codeRevision||d.renderRevision!==rev.renderRevision)fail(409);
  this.prune();if(this.leases.size>=256||[...this.leases.values()].filter(l=>l.userId===userId).length>=16)fail(429);
  const token=randomUUID(),expiresAt=this.now()+30000;
  this.leases.set(token,{userId,sessionId,conversationId:d.conversationId,messageId:d.messageId,...rev,expiresAt});
  return {token,expiresAt,...rev};
 }
 record(userId,sessionId,d){
  if(!keys(d,['token','observation']))fail(400);this.prune();const lease=this.leases.get(d.token);
  if(!lease||lease.userId!==userId||lease.sessionId!==sessionId)fail(404);
  const rev=this.context(userId,lease.conversationId,lease.messageId);
  if(rev.codeRevision!==lease.codeRevision||rev.renderRevision!==lease.renderRevision){this.leases.delete(d.token);fail(409);}
  const observation=boundedObservation(d.observation);this.leases.delete(d.token);
  const receivedAt=this.now(),key=JSON.stringify([sessionId,lease.messageId]);
  this.samples.delete(key);if(this.samples.size>=256)this.samples.delete(this.samples.keys().next().value);
  this.samples.set(key,{...lease,...observation,receivedAt,expiresAt:receivedAt+120000});return {receivedAt};
 }
 read(userId,sessionId,conversationId,messageId){
  const rev=this.context(userId,conversationId,messageId);this.prune();
  const s=this.samples.get(JSON.stringify([sessionId,messageId]));
  if(!s||s.userId!==userId||s.conversationId!==conversationId||s.codeRevision!==rev.codeRevision||s.renderRevision!==rev.renderRevision)return null;
  return {version:1,kind:'authenticated-client-observation',...rev,receivedAt:s.receivedAt,expiresAt:s.expiresAt,
   runtimeError:s.runtimeError,htmlWarning:s.htmlWarning,layout:{...s.layout},serverVerified:false,visualVerified:false,repairVerified:false,
   coverage:'single owner viewport snapshot; no text, target geometry, computed styles or database revision; not proof of visual intent'};
 }
}
