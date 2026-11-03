import crypto from 'node:crypto';
export class MemoryStore{
 enabled(userId){return this.db.prepare("SELECT enabled FROM memory_settings WHERE user_id=?").get(userId)?.enabled===1;}
 setEnabled(userId,enabled){this.db.prepare("INSERT INTO memory_settings(user_id,enabled) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled").run(userId,enabled?1:0);}
 constructor(store){this.db=store.db;this.db.exec("CREATE TABLE IF NOT EXISTS memory_settings(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,enabled INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,project TEXT NOT NULL DEFAULT '',content TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS memories_user ON memories(user_id,project);");}
 save(userId,{id,content,project=''}){
 if(typeof content!=='string'||!content.trim()||content.length>4000||typeof project!=='string'||project.length>100)throw Error('Erinnerung: maximal 4000 Zeichen, Projekt maximal 100.');
 const now=new Date().toISOString();
 if(id){const r=this.db.prepare('UPDATE memories SET content=?,project=?,updated_at=? WHERE id=? AND user_id=?').run(content.trim(),project,now,id,userId);if(!r.changes)throw Error('Erinnerung nicht gefunden.');return id;}
 const count=this.db.prepare('SELECT count(*) n FROM memories WHERE user_id=?').get(userId).n;if(count>=500)throw Error('Maximal 500 Erinnerungen.');
 id=crypto.randomUUID();this.db.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?)').run(id,userId,project,content.trim(),now,now);return id;
 }
 search(userId,{query='',project,limit=20}={}){
 if(typeof query!=='string'||query.length>200||project!==undefined&&(typeof project!=='string'||project.length>100))throw Error('Ungültige Suche.');
 limit=Math.max(1,Math.min(50,Number(limit)||20));
 // Parameterized literal search: no SQL or wildcard interpretation from model input.
 return project===undefined?this.db.prepare('SELECT id,project,content,created_at,updated_at FROM memories WHERE user_id=? AND instr(lower(content),lower(?))>0 ORDER BY updated_at DESC LIMIT ?').all(userId,query,limit):this.db.prepare('SELECT id,project,content,created_at,updated_at FROM memories WHERE user_id=? AND project=? AND instr(lower(content),lower(?))>0 ORDER BY updated_at DESC LIMIT ?').all(userId,project,query,limit);
 }
 remove(userId,id){const r=this.db.prepare('DELETE FROM memories WHERE user_id=? AND id=?').run(userId,id);if(!r.changes)throw Error('Erinnerung nicht gefunden.');}
}
