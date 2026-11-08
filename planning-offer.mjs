// Presentation metadata only. Never build authority, executable code or a model URL.
export const planningGuidance = 'Guide the user proactively when an interactive Element could help. Offer to PLAN it, never claim construction started. Include planningOffer:{title:"short concrete Element name"} in the final JSON metadata when proposing a new Element or an agreed refinement. Include planningOffer:null when no construction is relevant. Do not tell the user to find a Plan button or invent clickable Markdown links. The application renders the trusted button. A planning offer only opens planning; building always requires the separate Plan starten confirmation. Ask at most one necessary question before offering; do not require a perfect specification.';
export function planningOffer(value, prose='') {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length===1 && typeof value.title==='string') {
    const title=value.title.trim();
    if(title && title.length<=100 && !/[\u0000-\u001f\u007f<>]/u.test(title)) return {version:1,title};
  }
  // Legacy provider fallback: a clearly worded offer must not leave a dead-end.
  // No user intent inference, no automatic invocation, no guest-supplied command.
  if(value===undefined && !/\b(?:nicht|kein|keine|keinen|keinem|keiner|ohne)\b/iu.test(prose) && /\b(?:ich kann|wir können|ich könnte)\b[^.!?\n]{0,100}\b(?:element|app|tool|werkzeug)\b[^.!?\n]{0,80}\b(?:bauen|planen|erstellen)\b/iu.test(prose)) return {version:1,title:'Besprochenes Element'};
  return null;
}
