// App-owned gesture continuation. Never exposed to interpreted element code.
let active=null;
export function cancelFeedMomentum(owner){
  if(active&&(!owner||active.owner===owner)){cancelAnimationFrame(active.frame);active=null;}
}
for(const type of ['pointerdown','touchstart','wheel','keydown'])
  addEventListener(type,e=>{if(e.isTrusted)cancelFeedMomentum();},{capture:true,passive:true});
addEventListener('visibilitychange',()=>{if(document.hidden)cancelFeedMomentum();});
export function startFeedMomentum(owner,velocity){
  cancelFeedMomentum();
  const feed=owner.closest('#feed');
  if(!feed||!owner.isConnected||document.hidden||!Number.isFinite(velocity)||Math.abs(velocity)<0.08)return;
  const run={owner,frame:0,carry:0,velocity:Math.max(-2.5,Math.min(2.5,velocity)),start:performance.now(),last:performance.now()};
  active=run;
  const tick=now=>{
    if(active!==run)return;
    if(!owner.isConnected||owner.closest('#feed')!==feed||document.hidden||now-run.start>1200){cancelFeedMomentum(owner);return;}
    const dt=Math.min(32,now-run.last);
    // A callback in the current frame can predate performance.now() at release.
    // Never reverse or mistake a subpixel first tick for a scroll boundary.
    if(dt<=0){run.frame=requestAnimationFrame(tick);return;}run.last=now;
    const before=feed.scrollTop,delta=run.velocity*dt+run.carry;feed.scrollTop+=delta;
    run.carry=before+delta-feed.scrollTop;
    run.velocity*=Math.exp(-dt/240);
    if(Math.abs(run.velocity)<0.025||(Math.abs(delta)>=1&&Math.abs(feed.scrollTop-before)<0.1)){cancelFeedMomentum(owner);return;}
    run.frame=requestAnimationFrame(tick);
  };
  run.frame=requestAnimationFrame(tick);
}
