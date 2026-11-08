import {ownerCodeText} from '../owner-code.mjs';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
export function diagnosticButton({message,conversationId,view,request,note}){
 const button=document.createElement('button');button.type='button';button.textContent='Darstellung prüfen';
 button.onclick=async()=>{
  if(button.disabled)return;button.disabled=true;
  try{
   const snapshot=JSON.parse(JSON.stringify(message.render));
   const [codeRevision,renderRevision]=await Promise.all([hash(ownerCodeText(snapshot)),hash(ownerCodeText({payload:snapshot}))]);
   const lease=await request('/api/elements/diagnostics/start',{conversationId,messageId:message.id,codeRevision,renderRevision});
   const observation=await view.inspect();
   if(!button.isConnected)throw Error('Darstellung geschlossen.');
   await request('/api/elements/diagnostics/record',{token:lease.token,observation});
   note.className='notice';note.textContent='Browser-Momentaufnahme erfasst: '+observation.layout.width+' px breit; '+(observation.runtimeError?'Laufzeitfehler beobachtet':'kein Laufzeitfehler beobachtet')+(observation.htmlWarning?'; HTML eingeschränkt':'')+'. Für diesen Chat 2 Minuten verfügbar. Keine Bestätigung korrekter Darstellung oder Interaktion.';
  }catch(e){note.className='notice error';note.textContent=e.message;}
  finally{button.disabled=false;}
 };
 return button;
}
