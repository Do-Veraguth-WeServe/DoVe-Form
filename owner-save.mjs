import crypto from 'node:crypto';import {ownerCodeText} from './owner-code.mjs';import {validateRender} from './contract.mjs';
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
export function saveOwnedElement(store,uid,messageId,{state,render:replacement,expectedRevision,expectedCodeRevision}={}){
 store.db.exec('BEGIN IMMEDIATE');try{
 const user=store.getUser(uid),owner=store.messageOwner(messageId);if(!user||user.disabled||!owner||owner.userId!==uid||!owner.hasRender)throw Error('Element nicht verfügbar.');
 const render=store.getRender(messageId),stateRevision=hash(JSON.stringify(render.state)),ownerCodeRevision=hash(ownerCodeText(render));
 const history=store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='element_grant_history'").get();const protectedElement=history&&store.db.prepare('SELECT 1 FROM element_grant_history WHERE message_id=?').get(messageId);
 let result;
 if((protectedElement||expectedCodeRevision!==undefined)&&expectedCodeRevision!==ownerCodeRevision)result={status:409,result:{ok:false,error:'Element wurde geändert. Neu laden.'}};
 else if((protectedElement||expectedRevision!==undefined)&&expectedRevision!==stateRevision)result={status:409,result:{ok:false,error:'Zustand wurde geändert. Neu laden.',state:render.state,stateRevision}};
 else{if(replacement==null&&(!state||typeof state!=='object'||Array.isArray(state)||Buffer.byteLength(JSON.stringify(state))>4096))throw Error('Ungültiger Zustand.');const next=validateRender(replacement??{...render,state});if(replacement!=null)store.replaceRender(owner.conversationId,messageId,next);else store.updateMessageRender(uid,messageId,next);result={status:200,result:{ok:true,state:next.state,stateRevision:hash(JSON.stringify(next.state)),ownerCodeRevision:hash(ownerCodeText(next))}};}
 store.db.exec('COMMIT');return result;
 }catch(e){try{store.db.exec('ROLLBACK');}catch{}throw e;}
}
