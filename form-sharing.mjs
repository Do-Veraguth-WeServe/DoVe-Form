// Independent, opt-in snapshots. Never grants access to source conversations or tools.
import crypto from 'node:crypto';
import {layouts} from './forms.mjs';
import {validateRender} from './contract.mjs';
export class FormSharing {
 constructor(store,forms){this.store=store;this.forms=forms;this.db=store.db;this.db.exec(
  "CREATE TABLE IF NOT EXISTS form_copy_offers(id TEXT PRIMARY KEY,sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,snapshot TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',copy_id TEXT,created_at TEXT NOT NULL)");}
 list(uid){return this.db.prepare('SELECT o.id,o.sender_id,o.recipient_id,o.snapshot,o.status,o.copy_id,o.created_at,s.username sender,r.username recipient FROM form_copy_offers o JOIN users s ON s.id=o.sender_id JOIN users r ON r.id=o.recipient_id WHERE (o.sender_id=? OR o.recipient_id=?) ORDER BY o.created_at DESC LIMIT 100').all(uid,uid).map(o=>({id:o.id,name:JSON.parse(o.snapshot).name,kind:JSON.parse(o.snapshot).kind||'form',status:o.status,copyId:o.copy_id,createdAt:o.created_at,sender:o.sender,recipient:o.recipient,direction:o.sender_id===uid?'sent':'received'}));}
 offer(uid,d){
  if(typeof d.recipient!=='string')throw Error('Empfänger erforderlich.');
  const recipient=this.store.getUserByName(d.recipient.trim());
  if(!recipient||recipient.disabled||recipient.id===uid)throw Error('Empfänger nicht verfügbar.');
  let source=this.forms.get(uid,d.id);
  if(!source)throw Error('Form nicht gefunden.');
  if(d.revision!==source.revision)throw Error('Form wurde inzwischen geändert. Bitte neu laden.');
  let card=null;
  // Only selected, owned persisted content may be copied.
  if(d.messageId!==undefined){
   if(this.store.messageOwner(d.messageId)?.userId!==uid||!Number.isInteger(d.index)||d.index<0||d.index>2)throw Error('Form-Zustand nicht gefunden.');
   const row=this.db.prepare('SELECT forms FROM messages WHERE id=?').get(d.messageId);
   const item=JSON.parse(row.forms||'{}').items?.[d.index];
   if(!item||item.formId!==source.id||!layouts.includes(item.layout))throw Error('Form-Zustand nicht gefunden.');
   if(item.layout==='custom'){
    if(!item.template)throw Error('Form-Zustand nicht gefunden.');
    source={...source,layout:'custom',template:{...item.template,state:{...item.template.state,...item.data}}};
   }else{
    const items=(Array.isArray(item.items)?item.items:[]).slice(0,8).map(i=>({label:String(i?.label||'').slice(0,160),detail:String(i?.detail||'').slice(0,500)}));
    card={layout:item.layout,title:String(item.title||source.name).slice(0,100),text:String(item.text||'').slice(0,1500),items};
    if(item.layout==='list')card.data={checked:items.map((_,i)=>item.data?.checked?.[i]===true)};
    source={...source,layout:item.layout,template:null};
   }
  }
  const snapshot={name:source.name,layout:source.layout,instructions:source.instructions,enabled:false};
  if(card)snapshot.card=card;
  if(source.template){const {actions,...template}=validateRender(source.template);snapshot.template=template;}
  if(this.db.prepare("SELECT count(*) n FROM form_copy_offers WHERE (sender_id=? OR recipient_id=?) AND status='pending'").get(uid,recipient.id).n>=40)throw Error('Zu viele offene Kopie-Angebote.');
  const id=crypto.randomUUID();this.db.prepare('INSERT INTO form_copy_offers(id,sender_id,recipient_id,snapshot,created_at) VALUES (?,?,?,?,?)').run(id,uid,recipient.id,JSON.stringify(snapshot),new Date().toISOString());return {id};
 }
 offerElement(uid,d){
  if(typeof d.recipient!=='string')throw Error('Empfänger erforderlich.');
  const recipient=this.store.getUserByName(d.recipient.trim());
  if(!recipient||recipient.disabled||recipient.id===uid)throw Error('Empfänger nicht verfügbar.');
  if(this.store.messageOwner(d.messageId)?.userId!==uid)throw Error('Element nicht gefunden.');
  const render=this.store.getRender(d.messageId);
  if(!render)throw Error('Element nicht gefunden.');
  const revision=crypto.createHash('sha256').update(JSON.stringify(validateRender(render))).digest('hex');
  if(d.revision!==revision)throw Error('Element wurde inzwischen geändert. Bitte neu laden.');
  const {actions,...element}=validateRender(render);
  const snapshot={kind:'element',name:element.name||'Element',element};
  if(this.db.prepare("SELECT count(*) n FROM form_copy_offers WHERE (sender_id=? OR recipient_id=?) AND status='pending'").get(uid,recipient.id).n>=40)throw Error('Zu viele offene Kopie-Angebote.');
  const id=crypto.randomUUID();this.db.prepare('INSERT INTO form_copy_offers(id,sender_id,recipient_id,snapshot,created_at) VALUES (?,?,?,?,?)').run(id,uid,recipient.id,JSON.stringify(snapshot),new Date().toISOString());return {id};
 }
 accept(uid,id){
  const offer=this.db.prepare('SELECT * FROM form_copy_offers WHERE id=? AND recipient_id=?').get(id,uid);
  if(!offer)throw Error('Angebot nicht verfügbar.');
  if(offer.status==='accepted'){const snapshot=JSON.parse(offer.snapshot);return {id:offer.copy_id,...(snapshot.kind==='element'?{conversationId:this.store.messageOwner(offer.copy_id)?.conversationId}: {})};}
  if(offer.status!=='pending'||this.store.getUser(offer.sender_id)?.disabled)throw Error('Angebot nicht verfügbar.');
  const snapshot=JSON.parse(offer.snapshot);
  this.db.exec('SAVEPOINT accept_form_copy');try{
   if(snapshot.kind==='element'){
    const conversation=this.store.createConversation(uid,'Kopie: '+snapshot.name);
    const messageId=this.store.appendMessage(conversation.id,'assistant',{prose:'Unabhängige Element-Vorlage. Eigene leere Datenbank; keine Tool-Freigaben.',render:validateRender(snapshot.element)});
    this.db.prepare("UPDATE form_copy_offers SET status='accepted',copy_id=? WHERE id=?").run(messageId,id);
    this.db.exec('RELEASE accept_form_copy');return {id:messageId,conversationId:conversation.id};
   }
   const copy=this.forms.save(uid,snapshot,'accepted-copy',snapshot.template||null);
   let conversationId;
   if(snapshot.card){
    const conversation=this.store.createConversation(uid,'Kopie: '+snapshot.card.title);conversationId=conversation.id;
    const messageId=this.store.appendMessage(conversationId,'assistant',{prose:'Unabhängige Form-Kopie. Änderungen bleiben in diesem Chat.'});
    this.db.prepare('UPDATE messages SET forms=? WHERE id=?').run(JSON.stringify({items:[{...snapshot.card,formId:copy.id,revision:copy.revision}]}),messageId);
   }
   this.db.prepare("UPDATE form_copy_offers SET status='accepted',copy_id=? WHERE id=?").run(copy.id,id);
   this.db.exec('RELEASE accept_form_copy');return {id:copy.id,...(conversationId?{conversationId}:{})};
  }catch(e){this.db.exec('ROLLBACK TO accept_form_copy; RELEASE accept_form_copy');throw e;}
 }
 close(uid,id){const o=this.db.prepare('SELECT * FROM form_copy_offers WHERE id=? AND (sender_id=? OR recipient_id=?)').get(id,uid,uid);if(!o)throw Error('Angebot nicht verfügbar.');if(o.status!=='pending')return;this.db.prepare('UPDATE form_copy_offers SET status=? WHERE id=?').run(o.sender_id===uid?'revoked':'declined',id);}
}
