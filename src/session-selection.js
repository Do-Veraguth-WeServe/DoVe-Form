// Store only an opaque preference, never trust it as authorization or cached content.
const key=userId=>'form3.current.'+userId;
export function rememberSelection(storage,userId,sessionId){
 if(!userId||typeof sessionId!=='string')return;
 try{storage.setItem(key(userId),sessionId);}catch{}
}
export function restoreSelection(storage,userId,sessions,current){
 let selected=current;
 if(!selected&&userId)try{selected=storage.getItem(key(userId));}catch{}
 return sessions.some(s=>s.id===selected)?selected:(sessions[0]?.id||null);
}
