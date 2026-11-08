import {createHash} from 'node:crypto';
import {inspectCSS,CSS_POLICY_VERSION} from './css-policy.mjs';
import {ownerCodeText} from './owner-code.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
// Read-only static analysis of an already authorized canonical render. Never executes guest code.
export function staticElementDiagnostics(render){
 const base={version:1,kind:'static-css-policy',codeRevision:hash(ownerCodeText(render)),visualVerified:false,runtimeObserved:false};
 const source=render.css??'';
 if(typeof source!=='string'||source.length>100000)return {...base,assessment:'unavailable',reason:'css-size-limit'};
 const inspected=inspectCSS(source);
 return {...base,assessment:inspected.removedCount?'inspected-removals':'no-css-removals',css:{
 policyVersion:CSS_POLICY_VERSION,sourceHash:hash(source),effectiveHash:hash(inspected.css),
 removedCount:inspected.removedCount,truncated:inspected.removedCount>16,
 removals:inspected.diagnostics.slice(0,16).map(({reason,property,offset})=>({reason,property,offset}))
 }};
}
