// Entry is distinct from submit/background updates: start at the end before paint.
// Briefly accommodate async Element sizing, but never trap someone reading history.
export function sessionEntry(feed){
  let stopped=false,timer,observer,mutations=null,primed=false;const ends=new Set();
  const events=['pointerdown','touchstart','wheel','keydown'];
  const stop=()=>{if(stopped)return;stopped=true;clearTimeout(timer);observer?.disconnect();mutations?.disconnect();feed.removeEventListener('scroll',onScroll);for(const e of events)document.removeEventListener(e,stop,true);};
  // scrollTo() applies asynchronously in Chrome; direct assignment keeps pins
  // immediate. Every pin records the layout end it targeted so a later scroll
  // event can tell a content clamp (lands exactly on a known end) from a reader.
  const bottom=()=>{if(stopped)return;const end=feed.scrollHeight-feed.clientHeight;if(!primed){primed=true;feed.scrollTop=feed.scrollHeight;ends.add(end);return;}const pos=feed.scrollTop;if(end-pos>2&&!knownEnd(pos)){stop();return;}feed.scrollTop=feed.scrollHeight;ends.add(end);};
  const knownEnd=pos=>{for(const e of ends)if(Math.abs(pos-e)<=2)return true;return false;};
  const onScroll=()=>{if(stopped)return;const gap=feed.scrollHeight-feed.clientHeight-feed.scrollTop;
    // At the end (or a clamp of earlier content that has since grown): keep following.
    if(gap<=2||knownEnd(feed.scrollTop)){bottom();return;}
    stop();};
  bottom();
  observer=new ResizeObserver(bottom);for(const frame of feed.querySelectorAll('iframe'))observer.observe(frame);
  // Entry iframes mount after us; ResizeObserver only sees nodes it was handed.
  // Any feed mutation re-pins (shrinks clamp the browser to the new end) and
  // adopt newly inserted iframes into the observer.
  mutations=new MutationObserver(records=>{let added=false;for(const r of records){for(const n of r.addedNodes){if(n.nodeType!==1)continue;const frames=n.tagName==='IFRAME'?[n]:n.querySelectorAll?.('iframe')||[];for(const f of frames){observer.observe(f);added=true;}}}bottom();});
  mutations.observe(feed,{childList:true,subtree:true});
  feed.addEventListener('scroll',onScroll,{passive:true});
  for(const e of events)document.addEventListener(e,stop,{capture:true,passive:true});
  timer=setTimeout(stop,2000);
  return stop;
}
