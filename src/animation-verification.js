// Trusted, isolated test entrypoint; never included in the main app.
import {renderUI} from './renderer.js';
let current;
window.mountVerification=data=>{
 current?.destroy();document.body.replaceChildren();
 const record=window.verification={errors:[],states:[]};
 current=renderUI(data,{onError:()=>record.errors.push('runtime-error'),onState:s=>{record.states=[s];},onSuggest:()=>{},onDb:()=>({ok:false,error:'Isolated database unavailable'}),onPing:()=>({ok:false,error:'Network disabled'}),onAction:()=>Promise.reject(Error('Actions disabled'))});
 current.element.style.width='100%';document.body.append(current.element);
};
