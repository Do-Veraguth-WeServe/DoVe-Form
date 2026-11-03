import crypto from 'node:crypto';
export class ToolExecution{
 constructor(store,mcp){this.store=store;this.mcp=mcp;this.waiters=new Map();
 store.db.exec("CREATE TABLE IF NOT EXISTS tool_calls(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,args TEXT NOT NULL,state TEXT NOT NULL,result TEXT,created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS tool_calls_user ON tool_calls(user_id,state);");
 store.db.exec("UPDATE tool_calls SET state='unknown' WHERE state='running'; UPDATE tool_calls SET state='expired' WHERE state IN ('pending','approved');");
 }
 list(userId){return this.store.db.prepare('SELECT id,job_id,name,args,state,created_at FROM tool_calls WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(userId).map(r=>({...r,args:JSON.parse(r.args),label:(()=>{const t=this.mcp.catalog().find(t=>t.name===r.name);return t?(t.connectionName+" / "+t.toolName):r.name})()}));}
 decide(userId,id,approve){
 const r=this.store.db.prepare("UPDATE tool_calls SET state=? WHERE id=? AND user_id=? AND state='pending'").run(approve?'approved':'denied',id,userId);
 if(!r.changes)throw Error('Freigabe nicht mehr verfügbar.');this.waiters.get(id)?.(approve);return true;
 }
 hasCalls(jobId){return !!this.store.db.prepare('SELECT id FROM tool_calls WHERE job_id=? LIMIT 1').get(jobId);}
 async execute(job,call,args,{signal}){
 if(this.store.getUser(job.userId)?.role!=='owner')throw Error('Tools sind nur für den Owner freigegeben.');
 const tool=this.mcp.catalog().find(t=>t.name===call.function.name);if(!tool)throw Error('Tool nicht freigegeben.');
 const id=crypto.randomUUID();
 this.store.db.prepare('INSERT INTO tool_calls(id,job_id,user_id,name,args,state,created_at) VALUES(?,?,?,?,?,?,?)').run(id,job.id,job.userId,tool.name,JSON.stringify(args),'pending',new Date().toISOString());
 const approved=await new Promise((resolve,reject)=>{
  let timer;
  const cleanup=()=>{clearTimeout(timer);this.waiters.delete(id);signal?.removeEventListener('abort',abort)};
  const abort=()=>{cleanup();this.store.db.prepare("UPDATE tool_calls SET state='expired' WHERE id=? AND state='pending'").run(id);reject(Error('Tool-Freigabe abgebrochen.'))};
  this.waiters.set(id,value=>{cleanup();resolve(value)});
  timer=setTimeout(abort,120000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
 if(!approved)throw Error('Tool-Aufruf abgelehnt.');
 if(signal?.aborted)throw Error('Abgebrochen.');
 if(this.store.getUser(job.userId)?.role!=='owner'||!this.mcp.catalog().some(t=>t.name===tool.name&&t.fingerprint===tool.fingerprint))throw Error('Berechtigung wurde entzogen.');
 this.store.db.prepare("UPDATE tool_calls SET state='running' WHERE id=? AND state='approved'").run(id);
 try{
 const result=await this.mcp.call(tool.name,args,{signal});
 this.store.db.prepare("UPDATE tool_calls SET state='completed',result=? WHERE id=?").run(JSON.stringify(result),id);return result;
 }catch(e){this.store.db.prepare("UPDATE tool_calls SET state='unknown' WHERE id=?").run(id);throw Error('Tool-Ergebnis unklar. Nicht automatisch wiederholen.');}
 }
}
