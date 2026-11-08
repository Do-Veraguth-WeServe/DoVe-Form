// Trusted, isolated test entrypoint; never included in the main app.
import {renderUI} from './renderer.js';
import {inspectHTML} from './sanitize.js';
// Only a fixed verdict crosses back; never source values or detached DOM nodes.
window.preflightVerificationHTML=html=>{
 try{return inspectHTML(html).removedCount===0;}catch{return false;}
};
let current;
window.mountVerification=data=>{
 current?.destroy();document.body.replaceChildren();
 const record=window.verification={errors:[],states:[],htmlWarning:false};
 current=renderUI(data,{onError:()=>record.errors.push('runtime-error'),onWarning:()=>{record.htmlWarning=true;},onState:s=>{record.states=[s];},onSuggest:()=>{},onDb:()=>({ok:false,error:'Isolated database unavailable'}),onPing:()=>({ok:false,error:'Network disabled'}),onAction:()=>Promise.reject(Error('Actions disabled'))});
 current.element.style.width='100%';document.body.append(current.element);
};
