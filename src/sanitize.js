import DOMPurify from 'dompurify';
export {safeCSS} from '../css-policy.mjs';
const tags='div section main article header footer h1 h2 h3 p span strong em small label input button select option ul ol li table thead tbody tr th td details summary br hr svg path circle rect line polyline polygon text g'.split(' ');
const attrs='id class title role aria-label aria-pressed aria-hidden type value min max step checked disabled selected for viewBox d points cx cy r x y x1 x2 y1 y2 width height fill stroke stroke-width'.split(' ');
function scrub(s){const t=document.createElement('template');t.innerHTML=s;if(t.content.querySelectorAll('*').length>600)throw Error('Zu viele Elemente');for(const e of t.content.querySelectorAll('*')){for(const a of [...e.attributes]){if(/url\s*\(|[<>\\]/i.test(a.value))e.removeAttribute(a.name);}if(e.tagName==='INPUT'&&!['range','number','text','checkbox','radio'].includes(e.type))e.type='text';}return t.innerHTML;}
export function safeHTML(s){return scrub(DOMPurify.sanitize(s,{ALLOWED_TAGS:tags,ALLOWED_ATTR:attrs,ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false}));}
export function safeFragment(s){const html=safeHTML(s);let svg=html;try{const w=DOMPurify.sanitize('<svg>'+s+'</svg>',{ALLOWED_TAGS:[...tags,'svg'],ALLOWED_ATTR:attrs,ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});const d=document.createElement('div');d.innerHTML=w;let out='';for(const n of [...d.childNodes]){if(n.nodeType===1){const isSvgRoot=n.namespaceURI==='http://www.w3.org/2000/svg'&&n.tagName.toLowerCase()==='svg';out+=isSvgRoot?n.innerHTML:n.outerHTML}else if(n.nodeType===3)out+=n.textContent}if(out)svg=scrub(out);}catch{}let table='',section='',row='';
try{
 const clean=DOMPurify.sanitize('<table><tbody>'+s+'</tbody></table>',{ALLOWED_TAGS:tags,ALLOWED_ATTR:attrs,ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});
 const t=document.createElement('template');t.innerHTML=clean;const root=t.content.querySelector('table');
 if(root){table=scrub(root.innerHTML);section=scrub(root.querySelector('tbody')?.innerHTML||'');row=scrub(root.querySelector('tr')?.innerHTML||'');}
}catch{}
return {html,svg,table,section,row};}
