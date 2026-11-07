import {runRound} from './provider.mjs';
// The app owns this loop. MCP only supplies tools, never agent orchestration.
export async function runToolLoop(model,messages,{catalog,execute,signal,deadlineMs,onTransportRetry,maxRounds=6},emit=()=>{}){
  const history=structuredClone(messages);
  const tools=catalog.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}}));
  let calls=0;
  for(let round=0;round<maxRounds;round++){
    if(signal?.aborted)throw signal.reason||Error('Abgebrochen');
    const result=await runRound(model,history,{signal,deadlineMs,tools,onTransportRetry},text=>emit({type:'prose-chunk',text}),()=>emit({type:'artifact-start'}));
    if(!result.toolCalls.length)return {result,messages:history,calls};
    if(result.finishReason==='length')throw Error('Tool-Aufruf wurde abgeschnitten.');
    if(result.render||result.hadArtifact)throw Error('Element und Tool-Aufruf dürfen nicht gleichzeitig ausgeführt werden.');
    const seen=new Set();
    for(const c of result.toolCalls){
      if(!c.id||seen.has(c.id)||!catalog.some(t=>t.name===c.function.name))throw Error('Ungültiger Tool-Aufruf des Modells.');
      seen.add(c.id);
    }
    history.push({role:'assistant',content:result.contentText||null,tool_calls:result.toolCalls});
    for(const c of result.toolCalls){
      if(++calls>12)throw Error('Tool-Limit erreicht.');
      let args;try{args=JSON.parse(c.function.arguments)}catch{throw Error('Ungültige Tool-Argumente des Modells.');}
      emit({type:'tool-status',name:c.function.name,state:'pending'});
      // execute owns durable call records, permission checks and approval.
      // A failed or ambiguous mutation is never retried by this loop.
      const value=await execute(c,args,{signal});
      const content=JSON.stringify(value);
      if(content.length>64000)throw Error('Tool-Ergebnis zu gross.');
      history.push({role:'tool',tool_call_id:c.id,content});
      emit({type:'tool-status',name:c.function.name,state:'completed'});
    }
    if(JSON.stringify(history).length>300000)throw Error('Tool-Kontext zu gross.');
  }
  throw Error('Maximale Anzahl Tool-Runden erreicht.');
}
