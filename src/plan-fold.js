// Local presentation state only; never grants plan/build permission.
export function planFold({box,head,body,key,revision,questions}) {
 const storageKey='form-plan-fold:'+key;let saved;try{saved=JSON.parse(sessionStorage.getItem(storageKey));}catch{}
 let open=saved?.revision===revision?saved.open:questions>0;
 const toggle=document.createElement('button');toggle.type='button';toggle.className='blueprint-toggle';
 const status=document.createElement('span');status.className='blueprint-fold-status';status.textContent=questions?questions+' offene Fragen':'Plan ansehen';
 const arrow=document.createElement('span');arrow.className='blueprint-chevron';arrow.textContent='⌄';arrow.setAttribute('aria-hidden','true');
 toggle.append(head,status,arrow);body.id='plan-body-'+key.replace(/[^a-zA-Z0-9-]/g,'-');toggle.setAttribute('aria-controls',body.id);box.append(toggle,body);
 let animation;
 function apply(value,animate=true){open=value;try{sessionStorage.setItem(storageKey,JSON.stringify({revision,open}));}catch{}toggle.setAttribute('aria-expanded',String(open));body.inert=!open;body.setAttribute('aria-hidden',String(!open));box.classList.toggle('is-open',open);const from=body.getBoundingClientRect().height;animation?.cancel();body.style.height=open?'auto':'0px';if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){animation=body.animate([{height:from+'px',opacity:open?0.4:1},{height:(open?body.scrollHeight:0)+'px',opacity:open?1:0}],{duration:280,easing:'cubic-bezier(.2,.8,.2,1)'});}}
 toggle.onclick=()=>apply(!open);body.style.height='0px';apply(open,false);if(open&&saved?.revision!==revision)requestAnimationFrame(()=>{body.style.height='0px';apply(true);});
 return {close:()=>apply(false),open:()=>apply(true)};
}
