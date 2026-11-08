// Called only with the server-created, authorized elementEvidence snapshot.
// Not model metadata, confidence scoring, live telemetry or repair certification.
export function replyEvidence(snapshot) {
  if (!snapshot?.elements?.length) return null;
  const elements=snapshot.elements.slice(0,3).map(e=>({
    id:e.id, codeRevision:e.diagnostics?.codeRevision,
    assessment:['inspected-removals','no-css-removals'].includes(e.diagnostics?.assessment)?e.diagnostics.assessment:'unavailable',
    removedCount:Number.isSafeInteger(e.diagnostics?.css?.removedCount)?e.diagnostics.css.removedCount:0,
    ...(e.browserObservation?.kind==='authenticated-client-observation'?{browserObservation:{kind:'authenticated-client-observation',receivedAt:e.browserObservation.receivedAt,renderRevision:e.browserObservation.renderRevision,serverVerified:false}}:{})
  }));
  return {version:1,kind:'static-css-snapshot',capturedAt:snapshot.capturedAt,elements,
    omittedElements:snapshot.omittedElements||0,runtimeObserved:false,visualVerified:false,repairVerified:false};
}
