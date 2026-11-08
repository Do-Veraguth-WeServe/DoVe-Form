// Isolated persisted assistant offer for tests focused on downstream planning.
// Real provider-envelope -> offer behavior is covered by guided-planning.test.mjs.
import {DatabaseSync} from 'node:sqlite';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';
export async function offeredPlan(page,dir){
 if(!path.resolve(dir).startsWith(os.tmpdir()+path.sep+'form-'))throw Error('isolated fixture required');
 const prompt=await page.locator('#prompt').inputValue();
 const id=await page.locator('.session-open[aria-current=true]').locator('..').getAttribute('data-sid');
 const db=new DatabaseSync(path.join(dir,'form.db'));
 try{const seq=db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM messages WHERE conversation_id=?').get(id).n;
 db.prepare('INSERT INTO messages(id,conversation_id,seq,role,prose,forms,created_at) VALUES (?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,seq,'assistant','Wir können das besprochene Element planen.',JSON.stringify({planningOffer:{version:1,title:'Testelement'}}),new Date().toISOString());}finally{db.close()}
 await page.reload();await page.locator('.planning-offer-start').waitFor();await page.locator('#prompt').fill(prompt);await page.locator('.planning-offer-start').click();
}
