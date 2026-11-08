// JSON-only capability contract. v1 artifacts opt in explicitly; no migration.
export const ANIMATION_VERSION=1;
export const animationPrompt='Optional animations: {version:1,clips:{name:node}}. node is {type:"tween",target:"id",duration:1..2000,easing:"linear"|"ease-in"|"ease-out"|"ease-in-out",frames:[{opacity:0..1,x:-500..500,y:-500..500,rotate:-180..180,scaleX:0..2,scaleY:0..2}]} (2..8 frames), or {type:"sequence"|"parallel",children:[nodes]}, or {type:"crumple",targets:[3..8 distinct paper surface/SVG group IDs],duration:1..2000}. Crumple folds each surface independently; author adjacent paper panels, not a single card target. Maximum 16 clips, 16 tween leaves, depth4, 8s total, 8 concurrent targets. No CSS strings, URLs, functions or arbitrary properties. ui.animate(name, callback) returns a cancellation token; ui.cancelAnimation(token). Callback {ok,status:"finished"|"cancelled"|"error",error?}. Duplicate active clip starts fail. Reduced motion finishes asynchronously without movement. Missing targets fail. Only declared clips may run; use callback to persist completion via ui.db, recover on persistence failure. This is not arbitrary browser animation.';
export function validateAnimations(input){
 const fail=()=>{throw Error('Unsupported animation declaration (animation capability v1)');};
 const obj=(x,keys)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))fail();};
 obj(input,['version','clips']);if(input.version!==1)fail();obj(input.clips,Object.keys(input.clips||{}));
 const entries=Object.entries(input.clips);if(!entries.length||entries.length>16)fail();
 for(const [name,node] of entries){
  if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(name))fail();let leaves=0;
  const walk=(n,depth)=>{
   if(depth>4)fail();
   if(n?.type==='crumple'){
    obj(n,['type','targets','duration']);if(!Array.isArray(n.targets)||n.targets.length<3||n.targets.length>8||new Set(n.targets).size!==n.targets.length)fail();
    return walk(expandCrumple(n),depth);
   }
   if(n?.type==='tween'){
    obj(n,['type','target','duration','easing','frames']);
    if(++leaves>16||typeof n.target!=='string'||! /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(n.target)||!Number.isFinite(n.duration)||n.duration<1||n.duration>2000||!['linear','ease-in','ease-out','ease-in-out'].includes(n.easing)||!Array.isArray(n.frames)||n.frames.length<2||n.frames.length>8)fail();
    for(const f of n.frames){obj(f,['opacity','x','y','rotate','scaleX','scaleY']);if(!Object.keys(f).length)fail();for(const [k,v] of Object.entries(f)){const range=k==='opacity'?[0,1]:k.startsWith('scale')?[0,2]:k==='rotate'?[-180,180]:[-500,500];if(!Number.isFinite(v)||v<range[0]||v>range[1])fail();}}
    return {duration:n.duration,concurrency:1,targets:new Set([n.target])};
   }
   obj(n,['type','children']);if(!['sequence','parallel'].includes(n.type)||!Array.isArray(n.children)||!n.children.length||n.children.length>8)fail();
   const parts=n.children.map(c=>walk(c,depth+1));
   const targets=new Set();for(const p of parts)for(const t of p.targets){if(n.type==='parallel'&&targets.has(t))fail();targets.add(t);}
   const duration=n.type==='sequence'?parts.reduce((s,p)=>s+p.duration,0):Math.max(...parts.map(p=>p.duration));
   const concurrency=n.type==='parallel'?parts.reduce((s,p)=>s+p.concurrency,0):Math.max(...parts.map(p=>p.concurrency));
   if(duration>8000||concurrency>8)fail();return {duration,concurrency,targets};
  };walk(node,0);
 }
 if(JSON.stringify(input).length>24000)fail();return JSON.parse(JSON.stringify(input));
}
// Host creates numeric-derived keyframes, never evaluates guest CSS.
export function animationFrames(frames){return frames.map(f=>({...(f.opacity===undefined?{}:{opacity:f.opacity}),transform:'translate('+ (f.x??0)+'px,'+(f.y??0)+'px) rotate('+(f.rotate??0)+'deg) scale('+(f.scaleX??1)+','+(f.scaleY??1)+')'}));}

export function expandCrumple(n){return {type:'parallel',children:n.targets.map((target,i)=>({type:'tween',target,duration:n.duration,easing:'ease-in-out',frames:[{x:0,y:0,rotate:0,scaleX:1,scaleY:1,opacity:1},{x:(i%2?1:-1)*12,y:8+i*3,rotate:(i%2?1:-1)*(20+i*5),scaleX:0.65,scaleY:0.85,opacity:1},{x:(i%2?1:-1)*24,y:35+i*4,rotate:(i%2?1:-1)*(55+i*5),scaleX:0.18,scaleY:0.4,opacity:0}]}))};}
export function prepareAnimation(n){if(n.type==='crumple')return {...prepareAnimation(expandCrumple(n)),gather:true};return n.type==='tween'?{...n,frames:animationFrames(n.frames)}:{...n,children:n.children.map(prepareAnimation)};}
