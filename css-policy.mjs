import * as css from 'css-tree';

// Shared by generation guidance and browser sanitization; no DOM or user data.
export const CSS_POLICY_VERSION = 1;
export const CSS_FUNCTIONS = Object.freeze(['rgb','rgba','hsl','hsla','calc','min','max','clamp','repeat','minmax']);
export const CSS_BLOCKED_PROPERTIES = Object.freeze(['position','z-index','behavior','content','cursor','filter','backdrop-filter']);
export const cssCapabilityPrompt = `CSS policy v${CSS_POLICY_VERSION}: ordinary rules only, no @rules, URLs, custom properties or var(). Removed properties: ${CSS_BLOCKED_PROPERTIES.join(', ')} (ALL positioning, not only fixed). Only these CSS functions survive: ${CSS_FUNCTIONS.join(', ')}. Gradients, rotate()/translate()/scale() and other transform functions are removed. Pseudo-elements cannot generate content: use real HTML spans or permitted SVG shapes for icons, flex/grid for layout, plain colors for backgrounds. Sanitized code is not proof of rendered appearance or successful interaction.`;

export function inspectCSS(source){
 const diagnostics=[];let removedCount=0;
 const note=(reason,n)=>{removedCount++;if(diagnostics.length<64)diagnostics.push({reason,property:n.type==='Declaration'?n.property.slice(0,80):null,offset:n.loc?.start.offset??null});};
 try{
  const ast=css.parse(source,{positions:true});
  css.walk(ast,{enter(n,item,list){
   if(n.type==='Atrule'||n.type==='Raw'){note(n.type==='Atrule'?'at-rule':'unparsed-syntax',n);if(list)list.remove(item);return css.walk.skip;}
   if(n.type!=='Declaration')return;
   let reason=null;
   css.walk(n.value,k=>{
    if(k.type==='Url')reason='url';
    else if(k.type==='Raw'&&!reason)reason='unparsed-value';
    else if(k.type==='Function'&&!CSS_FUNCTIONS.includes(k.name.toLowerCase())&&!reason)reason='unsupported-function';
   });
   if(n.property.startsWith('--'))reason='custom-property';
   else if(CSS_BLOCKED_PROPERTIES.includes(n.property.toLowerCase()))reason='blocked-property';
   if(reason){note(reason,n);list.remove(item);return css.walk.skip;}
  }});
  return {policyVersion:CSS_POLICY_VERSION,css:css.generate(ast).replace(/</g,''),diagnostics,removedCount,truncated:removedCount>diagnostics.length};
 }catch{note('parse-error',{type:'Error'});return {policyVersion:CSS_POLICY_VERSION,css:'',diagnostics,removedCount,truncated:removedCount>diagnostics.length};}
}
export function safeCSS(source){return inspectCSS(source).css;}
