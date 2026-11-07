// Presentation only: keep original element state, ownership and DB identity.
export function elementTimeline(messages,jobs=[]){
  const byId=new Map(messages.map(m=>[m.id,m])),positions=new Map();
  for(const m of messages)if(m.render)positions.set(m.id,byId.has(m.renderPositionId)?m.renderPositionId:m.id);
  for(const j of jobs)if(j.kind==='refine'&&['queued','building','validating'].includes(j.state)&&positions.has(j.targetMessageId)&&byId.has(j.messageId))positions.set(j.targetMessageId,j.messageId);
  const elements=new Map([...positions].map(([id,anchor])=>[anchor,byId.get(id)]));
  return messages.map(message=>({message,element:elements.get(message.id)||null}));
}
