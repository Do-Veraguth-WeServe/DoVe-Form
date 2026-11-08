// Bounded app-owned question data, shared by planner and ordinary chat.
export const MAX_QUESTIONS=20;
export function normalizeQuestions(value){
 if(!Array.isArray(value)||value.length>MAX_QUESTIONS)throw Error('Ungültige Fragenanzahl.');
 return value.map(q=>{if(typeof q==='string'){if(!q.trim()||q.length>300)throw Error('Ungültige Frage.');return q.trim();}
 if(!q||typeof q!=='object'||typeof q.text!=='string'||!q.text.trim()||q.text.length>300||!Array.isArray(q.options)||q.options.length>8||q.options.some(o=>typeof o!=='string'||!o.trim()||o.length>160))throw Error('Ungültige Frageoptionen.');
 return {text:q.text.trim(),options:[...new Set(q.options.map(o=>o.trim()))]};});
}
