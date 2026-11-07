// Deliberately not wired to HTTP yet. Identity must come from authenticated session.
// No copied messages, namespace aliases, provider credentials or tool grants.
import crypto from 'node:crypto';
import {validateRender} from './contract.mjs';
const unavailable = () => { throw Error('Freigabe nicht verfügbar.'); };
export function elementCodeRevision(render) {
  const {state, actions, ...code} = validateRender(render);
  return crypto.createHash('sha256').update(JSON.stringify(code)).digest('hex');
}
export class ElementSharing {
  constructor(store, elementDB) {
    this.store=store; this.db=store.db; this.elementDB=elementDB;
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS element_grants(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, code_revision TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','active','revoked','declined')), created_at TEXT NOT NULL)"
    );
    this.db.exec('CREATE INDEX IF NOT EXISTS element_grants_parties ON element_grants(owner_id,recipient_id,status)');
  }
  activeUser(uid) { const u=this.store.getUser(uid); if(!u||u.disabled)unavailable(); return u; }
  source(grant) {
    this.activeUser(grant.owner_id); this.activeUser(grant.recipient_id);
    const owner=this.store.messageOwner(grant.message_id);
    if(!owner||owner.userId!==grant.owner_id||!owner.hasRender)unavailable();
    const render=this.store.getRender(grant.message_id);
    if(!render||elementCodeRevision(render)!==grant.code_revision)unavailable();
    return {owner,render};
  }
  offer(uid, {messageId, revision, recipient}) {
    this.activeUser(uid);
    const owner=this.store.messageOwner(messageId);
    if(!owner||owner.userId!==uid||!owner.hasRender)unavailable();
    const target=typeof recipient==='string'?this.store.getUserByName(recipient.trim()):null;
    if(!target||target.disabled||target.id===uid)unavailable();
    const render=this.store.getRender(messageId);
    if(elementCodeRevision(render)!==revision)unavailable();
    const existing=this.db.prepare("SELECT id FROM element_grants WHERE owner_id=? AND recipient_id=? AND message_id=? AND code_revision=? AND status IN ('pending','active')").get(uid,target.id,messageId,revision);
    if(existing)return {id:existing.id};
    const count=this.db.prepare("SELECT count(*) n FROM element_grants WHERE (owner_id=? OR recipient_id=?) AND status IN ('pending','active')").get(uid,target.id).n;
    if(count>=40)throw Error('Zu viele offene Freigaben.');
    const id=crypto.randomUUID();
    this.db.prepare("INSERT INTO element_grants VALUES(?,?,?,?,?,'pending',?)").run(id,uid,target.id,messageId,revision,new Date().toISOString());
    return {id};
  }
  accept(uid,id) {
    this.activeUser(uid);
    const g=this.db.prepare('SELECT * FROM element_grants WHERE id=? AND recipient_id=?').get(id,uid);
    if(!g||!['pending','active'].includes(g.status))unavailable();
    this.source(g);
    this.db.prepare("UPDATE element_grants SET status='active' WHERE id=?").run(id);
    return {id};
  }
  close(uid,id) {
    this.activeUser(uid);
    const g=this.db.prepare('SELECT * FROM element_grants WHERE id=? AND (owner_id=? OR recipient_id=?)').get(id,uid,uid);
    if(!g)unavailable();
    if(['pending','active'].includes(g.status))this.db.prepare('UPDATE element_grants SET status=? WHERE id=?').run(g.owner_id===uid?'revoked':'declined',id);
  }
  authorize(uid,id) {
    this.activeUser(uid);
    const g=this.db.prepare("SELECT * FROM element_grants WHERE id=? AND (owner_id=? OR recipient_id=?) AND status='active'").get(id,uid,uid);
    if(!g)unavailable();
    return {grant:g,...this.source(g)};
  }
  view(uid,id) {
    const {render}=this.authorize(uid,id);
    const {actions,...safe}=validateRender(render);
    // Explicit projection: no history, conversation ids, DB names or linked actions.
    return {id,render:safe,codeRevision:elementCodeRevision(render),canEdit:false};
  }
  data(uid,id,input) {
    // Recheck every operation, not only the initial connection or subscription.
    const {grant,owner}=this.authorize(uid,id);
    const {op,table,columns,row,query,id:rowId,patch}=input;
    if(uid!==grant.owner_id&&!['select','insert','update','delete'].includes(op))unavailable();
    return this.elementDB.op({sessionId:owner.conversationId,elementId:grant.message_id,op,table,columns,row,query,id:rowId,patch});
  }
}
