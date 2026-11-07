import {Marked} from 'marked';
import DOMPurify from 'dompurify';
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const parser=new Marked({gfm:true,breaks:true,renderer:{html:token=>escape(token.text)}});
export function renderMarkdown(node,text){const html=parser.parse(String(text||'').slice(0,64000));node.innerHTML=DOMPurify.sanitize(html,{ALLOWED_TAGS:['p','br','hr','strong','em','del','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','a','table','thead','tbody','tr','th','td','input'],ALLOWED_ATTR:['href','title','start','type','checked','disabled'],ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false});for(const a of node.querySelectorAll('a')){const href=a.getAttribute('href')||'';if(!/^(https?:|mailto:)/i.test(href)){a.removeAttribute('href');continue;}a.target='_blank';a.rel='noopener noreferrer';}for(const input of node.querySelectorAll('input')){if(input.type!=='checkbox')input.remove();else input.disabled=true;}}
