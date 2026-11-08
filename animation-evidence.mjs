import crypto from 'node:crypto';
export const animationArtifactHash=render=>crypto.createHash('sha256').update(JSON.stringify(render)).digest('hex');
export function initAnimationEvidence(db){db.exec(`CREATE TABLE IF NOT EXISTS animation_evidence(job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,source_hash TEXT NOT NULL,evidence TEXT NOT NULL,created_at TEXT NOT NULL)`);}
export function saveAnimationEvidence(db,job,render,evidence){
 if(!render?.animations)return;
 const hash=animationArtifactHash(render);
 if(evidence?.status!=='passed'||evidence.scope!=='startup-and-declared-clips'||evidence.sourceHash!==hash)throw Error('Missing or stale animation verification evidence');
 db.prepare('INSERT INTO animation_evidence VALUES(?,?,?,?,?,?,?)').run(job.id,job.userId,job.conversationId,job.targetMessageId||job.messageId,hash,JSON.stringify(evidence),new Date().toISOString());
}
export function readAnimationEvidence(db,userId,conversationId,messageId,render){return db.prepare('SELECT evidence FROM animation_evidence WHERE user_id=? AND conversation_id=? AND message_id=? AND source_hash=? ORDER BY created_at DESC LIMIT 1').get(userId,conversationId,messageId,animationArtifactHash(render))?.evidence||null;}
