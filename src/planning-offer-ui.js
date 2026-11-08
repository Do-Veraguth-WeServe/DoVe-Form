const pending=new Set(),failed=new Set();
export function planningOfferUI({message,latest,hasBlueprint,busy,start,changed}){
 const offer=message.forms?.planningOffer;if(offer?.version!==1)return null;
 const key=message.id,started=message.forms.planningStarted;const box=document.createElement('section');
 if(started||pending.has(key)){box.className='planning-offer-marker';box.setAttribute('role','status');box.textContent=(started?'Planung gestartet':'Planung wird gestartet …')+' · '+offer.title;return box;}
 if(!latest&&!failed.has(key))return null;
 box.className='planning-offer chat-form';const title=document.createElement('p');title.textContent=offer.title;const button=document.createElement('button');button.type='button';button.className='planning-offer-start';button.textContent=failed.has(key)?'Planung erneut starten':hasBlueprint?'Plan weiterentwickeln':'Element planen';button.disabled=busy;
 button.onclick=async()=>{if(button.disabled||pending.has(key))return;button.disabled=true;pending.add(key);let accepted=false;changed();try{await start(job=>{accepted=true;failed.delete(key);message.forms.planningStarted={jobId:job.id};pending.delete(key);changed();});}finally{if(!accepted)failed.add(key);pending.delete(key);changed();}};
 const hint=document.createElement('p');hint.className='small';hint.textContent='Zuerst besprechen wir den Plan. Gebaut wird erst nach deiner separaten Freigabe.';box.append(title,button,hint);return box;
}
