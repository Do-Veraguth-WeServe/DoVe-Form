// Entry is distinct from submit/background updates: start at the end before paint.
// Briefly accommodate async Element sizing, but never trap someone reading history.
export function sessionEntry(feed){
  let stopped=false,timer,observer,last=0;
  const events=['pointerdown','touchstart','wheel','keydown'];
  const stop=()=>{if(stopped)return;stopped=true;clearTimeout(timer);observer?.disconnect();for(const e of events)document.removeEventListener(e,stop,true);feed.removeEventListener('scroll',onScroll);};
  const onScroll=()=>{if(Math.abs(feed.scrollTop-last)>2)stop();};
  const bottom=()=>{if(stopped)return;feed.scrollTo({top:feed.scrollHeight,behavior:'instant'});last=feed.scrollTop;};
  bottom();
  observer=new ResizeObserver(bottom);for(const frame of feed.querySelectorAll('iframe'))observer.observe(frame);
  for(const e of events)document.addEventListener(e,stop,{capture:true,passive:true});
  feed.addEventListener('scroll',onScroll,{passive:true});timer=setTimeout(stop,2000);
  return stop;
}
