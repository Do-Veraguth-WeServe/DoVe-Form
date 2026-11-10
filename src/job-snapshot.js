// Compare UI-relevant public job fields, not transport-specific metadata.
// Conversation hydration omits prose and adds modelId/updatedAt; neither is a
// new revision. Keep actual prose/results/blueprints significant.
export function sameJobSnapshot(a,b){
 if(!a||!b)return false;
 const project=j=>[j.id,j.conversationId,j.messageId??null,j.targetMessageId??null,
  j.kind,j.blueprintRevision??null,j.state,j.phase||'prose',Number(j.rev),
  j.error||null,j.createdAt??null,j.prose||null,j.render??null,j.forms??null,j.blueprint??null];
 return JSON.stringify(project(a))===JSON.stringify(project(b));
}
