// Trusted app input only; serialized into the opaque iframe bootstrap as well.
// Chat and embedded Elements use identical displacement and release physics.
export function installScrollInput({target,enabled=()=>true,send}){
 let touch=null;
 target.addEventListener('touchstart',e=>{
  if(!e.isTrusted)return;send('scroll-stop');
  if(!enabled()||e.touches.length!==1){touch=null;return;}
  const t=e.touches[0];touch={x:t.screenX,y:t.screenY,lastY:t.screenY,time:e.timeStamp,velocity:0,vertical:false};
 },{passive:true});
 target.addEventListener('touchmove',e=>{
  if(!touch||!enabled()||!e.isTrusted||e.touches.length!==1)return;
  const t=e.touches[0],dy=touch.lastY-t.screenY;
  if(!touch.vertical){if(Math.abs(t.screenY-touch.y)<8)return;if(Math.abs(t.screenX-touch.x)>Math.abs(t.screenY-touch.y)){touch=null;return;}touch.vertical=true;}
  e.preventDefault();const now=e.timeStamp,dt=now-touch.time;
  touch.velocity=Math.max(-2.5,Math.min(2.5,dy/Math.max(8,dt)));touch.time=now;touch.lastY=t.screenY;
  send('scroll-parent',{delta:Math.max(-160,Math.min(160,dy))});
 },{passive:false});
 for(const type of ['touchend','touchcancel'])target.addEventListener(type,e=>{
  if(!e.isTrusted)return;
  if(type==='touchend'&&enabled()&&touch?.vertical&&e.touches.length===0&&e.timeStamp-touch.time<100)send('scroll-release',{velocity:touch.velocity});else send('scroll-stop');
  touch=null;
 },{passive:true});
 target.addEventListener('wheel',e=>{
  if(!e.isTrusted||!enabled()||e.ctrlKey||Math.abs(e.deltaX)>Math.abs(e.deltaY)||!e.deltaY)return;
  e.preventDefault();send('scroll-stop');
  // Same units across the iframe boundary; page mode uses the outer feed height.
  send('scroll-wheel',{delta:e.deltaY,mode:e.deltaMode});
 },{passive:false});
}
