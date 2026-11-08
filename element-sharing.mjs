// Source HTTP integration uses authenticated session identity. Production rollout
// remains gated on shared UI/live synchronization acceptance (see ELEMENT-GRANTS.md).
// No copied messages, namespace aliases, provider credentials or tool grants.
import crypto from 'node:crypto';
import {ownerCodeText} from './owner-code.mjs';
import {validateRender} from './contract.mjs';
const unavailable = () => { throw Error('Freigabe nicht verfügbar.'); };
export function elementCodeRevision(render) {
  const {state, actions, ...code} = validateRender(render);
  return crypto.createHash('sha256').update(JSON.stringify(code)).digest('hex');
}
// Content token, not a monotonic event cursor. Owner writes through legacy state
// persistence are also detected; clients must refresh rather than blindly retry.
export function elementStateRevision(state) {
  return crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
}
export class ElementSharing {
  constructor(store, elementDB) {
    this.store=store; this.db=store.db; this.elementDB=elementDB;
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS element_grants(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, code_revision TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','active','revoked','declined')), created_at TEXT NOT NULL)"
    );
    this.db.exec('CREATE INDEX IF NOT EXISTS element_grants_parties ON element_grants(owner_id,recipient_id,status)');
    // Minimal sticky safety marker: recipient deletion must not restore legacy
    // tokenless writes. Contains no recipient identity and dies with the source.
    this.locked(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS element_grant_history(message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE)');
      this.db.exec('INSERT OR IGNORE INTO element_grant_history SELECT DISTINCT message_id FROM element_grants');
    });
  }
  // Hold the ACL database writer lock through each synchronous operation.
  // Lock order: form.db first, then elements.sqlite. No await/network work here.
  // This serializes revocation/disable/source edits from other SQLite processes;
  // it is NOT a distributed transaction across the two database files.
  locked(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); this.db.exec('COMMIT'); return result; }
    catch(e) { try { this.db.exec('ROLLBACK'); } catch {} throw e; }
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
    return this.locked(() => {
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
      this.db.prepare("INSERT OR IGNORE INTO element_grant_history(message_id) VALUES(?)").run(messageId);
      return {id};
    });
  }
  list(uid, {after='',limit=20}={}) {
    return this.locked(() => {
      this.activeUser(uid);
      if(typeof after!=='string'||after.length>36||!Number.isInteger(limit)||limit<1||limit>40)throw Error('Ungültige Seite.');
      // Cursor pagination bounds both query and response even with long revoked history.
      const rows=this.db.prepare('SELECT * FROM element_grants WHERE (owner_id=? OR recipient_id=?) AND id>? ORDER BY id LIMIT ?').all(uid,uid,after,limit+1);
      const page=rows.slice(0,limit);
      const grants=page.map(g=>{
        const base={id:g.id,direction:g.owner_id===uid?'outgoing':'incoming',status:g.status};
        if(!['pending','active'].includes(g.status))return base;
        try {
          const {render}=this.source(g);
          // Pending offers expose only the offered title and counterparty, never code/state.
          const peer=this.activeUser(g.owner_id===uid?g.recipient_id:g.owner_id);
          return {...base,name:render.name||'Element',peer:peer.username};
        } catch {return {...base,status:'unavailable'};}
      });
      return {grants,next:rows.length>limit?page.at(-1).id:null};
    });
  }
  accept(uid,id) {
    return this.locked(() => {
      this.activeUser(uid);
      const g=this.db.prepare('SELECT * FROM element_grants WHERE id=? AND recipient_id=?').get(id,uid);
      if(!g||!['pending','active'].includes(g.status))unavailable();
      this.source(g);
      this.db.prepare("UPDATE element_grants SET status='active' WHERE id=?").run(id);
      return {id};
    });
  }
  close(uid,id) {
    return this.locked(() => {
      this.activeUser(uid);
      const g=this.db.prepare('SELECT * FROM element_grants WHERE id=? AND (owner_id=? OR recipient_id=?)').get(id,uid,uid);
      if(!g)unavailable();
      if(['pending','active'].includes(g.status))this.db.prepare('UPDATE element_grants SET status=? WHERE id=?').run(g.owner_id===uid?'revoked':'declined',id);
    });
  }
  authorize(uid,id) {
    this.activeUser(uid);
    const g=this.db.prepare("SELECT * FROM element_grants WHERE id=? AND (owner_id=? OR recipient_id=?) AND status='active'").get(id,uid,uid);
    if(!g)unavailable();
    return {grant:g,...this.source(g)};
  }
  view(uid,id) {
    return this.locked(() => {
      const {render,owner,grant}=this.authorize(uid,id);
      const {actions,...safe}=validateRender(render);
      // Explicit projection: no history, conversation ids, DB names or linked actions.
      return {id,dbRevision:this.elementDB?.revision(owner.conversationId,grant.message_id)||0,render:safe,codeRevision:elementCodeRevision(render),stateRevision:elementStateRevision(safe.state),canEdit:false};
    });
  }
  // Owner saves use the same state token as recipients. Legacy unshared saves
  // remain compatible only for never-offered Elements. Any grant history requires
  // both tokens, even after close/code invalidation: stale clients remain mounted.
  // Full code replacements also participate, so stale editor snapshots cannot
  // silently discard another participant's state. No client grant ID is trusted.
  ownerSave(uid,messageId,{state,render:replacement,expectedRevision,expectedCodeRevision}={}) {
    return this.locked(() => {
      this.activeUser(uid);
      const owner=this.store.messageOwner(messageId);
      if(!owner||owner.userId!==uid||!owner.hasRender)unavailable();
      const render=this.store.getRender(messageId);
      const grantEra=this.db.prepare("SELECT 1 FROM element_grant_history WHERE message_id=?").get(messageId);
      const revision=elementStateRevision(render.state);
      const ownerCodeRevision=r=>crypto.createHash('sha256').update(ownerCodeText(r)).digest('hex');
      if((grantEra||expectedCodeRevision!==undefined)&&expectedCodeRevision!==ownerCodeRevision(render))
        return {status:409,result:{ok:false,error:'Element wurde geändert. Neu laden.'}};
      if((grantEra||expectedRevision!==undefined)&&expectedRevision!==revision)
        return {status:409,result:{ok:false,error:'Zustand wurde geändert. Neu laden.',state:render.state,stateRevision:revision}};
      if(replacement==null&&(!state||typeof state!=='object'||Array.isArray(state)||Buffer.byteLength(JSON.stringify(state))>4096))throw Error('Ungültiger Zustand.');
      const next=validateRender(replacement??{...render,state});
      if(replacement!=null)this.store.replaceRender(owner.conversationId,messageId,next);
      else this.store.updateMessageRender(uid,messageId,next);
      return {status:200,result:{ok:true,state:next.state,stateRevision:elementStateRevision(next.state),ownerCodeRevision:ownerCodeRevision(next)}};
    });
  }
  state(uid,id,{state,expectedRevision}={}) {
    // Acquire write lock BEFORE authorization so revocation/disable/code replacement
    // from another SQLite connection cannot race the check and mutation.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const {grant,render}=this.authorize(uid,id);
      if(!state||typeof state!=='object'||Array.isArray(state)||Buffer.byteLength(JSON.stringify(state))>4096)throw Error('Ungültiger Zustand.');
      const revision=elementStateRevision(render.state);
      if(typeof expectedRevision!=='string'||expectedRevision!==revision){
        this.db.exec('COMMIT');
        return {status:409,result:{ok:false,error:'Zustand wurde geändert. Neu laden.',state:render.state,stateRevision:revision}};
      }
      // Only state is writable; never pass client render fields/identity to Store.
      const next=validateRender({...render,state});
      this.store.updateMessageRender(grant.owner_id,grant.message_id,next);
      this.db.exec('COMMIT');
      return {status:200,result:{ok:true,state:next.state,stateRevision:elementStateRevision(next.state)}};
    }catch(e){try{this.db.exec('ROLLBACK');}catch{}throw e;}
  }
  data(uid,id,input) {
    // Hold the ACL lock until the separate, bounded ElementDB operation returns.
    return this.locked(() => {
      const {grant,owner}=this.authorize(uid,id);
      const {op,table,columns,row,query,id:rowId,patch}=input;
      if(uid!==grant.owner_id&&op==='create'){
        // Existing generated startup code may call create before select. Emulate the
        // owner's existing-table response using a read only; NEVER create a table.
        const existing=this.elementDB.op({sessionId:owner.conversationId,elementId:grant.message_id,op:'select',table,query:{limit:1}});
        if(existing.status===200)return {status:409,result:{ok:false,error:'Tabelle existiert bereits.'}};
        unavailable();
      }
      if(uid!==grant.owner_id&&!['select','insert','update','delete'].includes(op))unavailable();
      return this.elementDB.op({sessionId:owner.conversationId,elementId:grant.message_id,op,table,columns,row,query,id:rowId,patch});
    });
  }
}
