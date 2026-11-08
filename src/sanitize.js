import DOMPurify from 'dompurify';
export {safeCSS} from '../css-policy.mjs';
const tags='div section main article header footer h1 h2 h3 p span strong em small label input button select option ul ol li table thead tbody tr th td details summary br hr svg path circle rect line polyline polygon text g'.split(' ');
const attrs='id class title role aria-label aria-pressed aria-hidden type value min max step checked disabled selected for viewBox d points cx cy r x y x1 x2 y1 y2 width height fill stroke stroke-width'.split(' ');
function scrub(s,removed=()=>{}){const t=document.createElement('template');t.innerHTML=s;if(t.content.querySelectorAll('*').length>600)throw Error('Zu viele Elemente');for(const e of t.content.querySelectorAll('*')){for(const a of [...e.attributes]){if(/url\s*\(|[<>\\]/i.test(a.value)){e.removeAttribute(a.name);removed('unsafe-attribute-value');}}if(e.tagName==='INPUT'&&!['range','number','text','checkbox','radio'].includes(e.type)){e.type='text';removed('input-type-normalized');}}return t.innerHTML;}
export function inspectHTML(s){
 const diagnostics=[];let removedCount=0;
 const removed=reason=>{removedCount++;if(diagnostics.length<16)diagnostics.push({reason});};
 const clean=DOMPurify.sanitize(s,{ALLOWED_TAGS:tags,ALLOWED_ATTR:attrs,ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
 // Consume immediately: DOMPurify.removed is replaced by the next sanitize call.
 // Never expose detached DOM nodes, attribute values, source text or user IDs.
 for(const entry of DOMPurify.removed||[]){
  if(entry.attribute)removed(entry.attribute.name==='id'?'id-removed':'attribute-removed');
  else if(entry.element?.nodeName!=='BODY')removed('element-removed');
 }
 const html=scrub(clean,removed);
 return {html,policyVersion:1,removedCount,truncated:removedCount>16,diagnostics};
}
export function safeHTML(s){return inspectHTML(s).html;}
// Diagnostics belong to the selected parsing context, not the plain-HTML fallback.
export function inspectFragment(s){
 const plain=inspectHTML(s),html=plain.html;let svg=html,table='',section='',row='';
 const summary=d=>({removed:d.removedCount>0,idRemoved:d.diagnostics.some(x=>x.reason==='id-removed')});
 const warnings={html:summary(plain),svg:summary(plain)};
 const collect=()=>{let removed=false,idRemoved=false;for(const e of DOMPurify.removed||[]){if(e.attribute||e.element?.nodeName!=='BODY')removed=true;if(e.attribute?.name==='id')idRemoved=true;}return {removed,idRemoved};};
 {
  // Parse in the actual target namespace, in an inert document. A string
  // '<svg>...</svg>' wrapper exits SVG parsing at HTML breakout tags and
  // incorrectly drops safe shapes that follow them. Sanitize the resulting
  // nodes in place before any serialization or insertion into the live page.
  const inert=document.implementation.createHTMLDocument('');
  const root=inert.createElementNS('http://www.w3.org/2000/svg','svg');
  root.innerHTML=s;
  DOMPurify.sanitize(root,{IN_PLACE:true,ALLOWED_TAGS:tags,ALLOWED_ATTR:attrs,ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
  const warning=collect();
  svg=scrub(root.innerHTML,()=>{warning.removed=true;});warnings.svg=warning;
 }
 try{
  const clean=DOMPurify.sanitize('<table><tbody>'+s+'</tbody></table>',{ALLOWED_TAGS:tags,ALLOWED_ATTR:attrs,ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
  const warning=collect(),t=document.createElement('template');t.innerHTML=clean;const root=t.content.querySelector('table');
  if(root){table=scrub(root.innerHTML,()=>{warning.removed=true;});section=scrub(root.querySelector('tbody')?.innerHTML||'',()=>{warning.removed=true;});row=scrub(root.querySelector('tr')?.innerHTML||'',()=>{warning.removed=true;});}
  warnings.table=warnings.section=warnings.row=warning;
 }catch{}
 return {html,svg,table,section,row,warnings};
}
export function safeFragment(s){const {warnings,...fragment}=inspectFragment(s);return fragment;}
