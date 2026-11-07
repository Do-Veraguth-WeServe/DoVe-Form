// One queue per mounted message snapshot. Never replay uncertain/failed writes.
export function elementPersistence({messageId,state,request,onFailure}) {
  let confirmed=JSON.stringify(state),tail=Promise.resolve(),blocked=false,queued=0,overflow=false;
  const revision=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  function save(payload){
    if(blocked)return Promise.resolve(false);
    if(queued>=32){overflow=true;return Promise.resolve(false);}
    queued++;
    const snapshot=JSON.parse(JSON.stringify(payload));
    const task=tail.then(async()=>{
      if(blocked)return false;
      try{
        if(overflow)throw Error('Zu viele ausstehende Änderungen. Bitte neu laden.');
        const expectedRevision=await revision(confirmed);
        if(blocked)return false;
        const response=await request({messageId,...snapshot,expectedRevision});
        if(blocked)return false;
        if(!response.ok)throw Error(response.status===409?'Das Element wurde inzwischen geändert. Neu geladen; deine Änderung wurde nicht übernommen.':'Speichern nicht bestätigt. Neu laden, bevor du weiterarbeitest.');
        const result=await response.json();
        if(result.ok!==true||!result.state||typeof result.state!=='object')throw Error('Speichern nicht bestätigt. Bitte neu laden.');
        confirmed=JSON.stringify(result.state);
        return true;
      }catch(error){blocked=true;await onFailure(error);return false;}
    });
    tail=task.catch(()=>{blocked=true;return false;}).finally(()=>{queued--;});
    return task;
  }
  return {save,stop(){blocked=true;}};
}
