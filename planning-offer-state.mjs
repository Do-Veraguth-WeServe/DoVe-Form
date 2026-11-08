// Called inside the same transaction as job creation. No user-supplied history marker.
export function offeredPlan(db,conversationId,messageId){
 const row=db.prepare("SELECT forms FROM messages WHERE id=? AND conversation_id=? AND role='assistant'").get(messageId,conversationId);
 const forms=row?.forms?JSON.parse(row.forms):null;
 if(forms?.planningOffer?.version!==1)throw Error('Planangebot nicht verfügbar.');
 if(forms.planningStarted)throw Error('Planung wurde bereits gestartet. Bitte neu laden.');
 return forms;
}
export function markOfferedPlan(db,conversationId,messageId,forms,jobId){db.prepare('UPDATE messages SET forms=? WHERE id=? AND conversation_id=?').run(JSON.stringify({...forms,planningStarted:{jobId}}),messageId,conversationId);}
