// Trusted presentation of server-owned historical evidence; never interpret prose as proof.
export function replyEvidenceNotice(evidence) {
  if(evidence?.version!==1||evidence.kind!=='static-css-snapshot'||!Array.isArray(evidence.elements)||!evidence.elements.length)return null;
  const notice=document.createElement('details');notice.className='diagnostic-evidence small';
  const title=document.createElement('summary');title.textContent='Prüfgrundlage dieser Antwort';
  const text=document.createElement('p');
  const entries=evidence.elements.slice(0,3),removed=entries.filter(e=>e.assessment==='inspected-removals').length,unavailable=entries.filter(e=>e.assessment==='unavailable').length;
  text.textContent='Statische CSS-Prüfung zum Anfragezeitpunkt: '+entries.length+' Element(e), '+removed+' mit entfernten CSS-Regeln'+(unavailable?', '+unavailable+' nicht prüfbar':'')+'. Keine Browser-, Interaktions- oder Reparaturprüfung. Die Antwort selbst ist keine bestätigte Fehlerursache. Spätere Änderungen sind nicht enthalten.'+(evidence.omittedElements?' Weitere Elemente wurden nicht geprüft.':'');
  const revisions=document.createElement('p');revisions.textContent='Code-Stände: '+entries.map(e=>/^[a-f0-9]{64}$/.test(e.codeRevision)?e.codeRevision.slice(0,12):'unbekannt').join(', ');
  notice.append(title,text,revisions);return notice;
}
