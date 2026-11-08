// Source-only shared-state stream. No source chat, actions, namespaces or replay cache.
import {validateRender} from './contract.mjs';
import {elementCodeRevision,elementStateRevision} from './element-sharing.mjs';
export class ElementStreams {
  constructor(sharing,{interval=1000,maxPerUser=4}={}) {
    this.sharing=sharing;this.interval=interval;this.maxPerUser=maxPerUser;this.counts=new Map();
  }
  open({uid,id,sessionValid,res}) {
    if((this.counts.get(uid)||0)>=this.maxPerUser)return false;
    this.counts.set(uid,(this.counts.get(uid)||0)+1);
    let stopped=false,timer,last=null;
    const stop=()=>{
      if(stopped)return;stopped=true;clearInterval(timer);
      const n=this.counts.get(uid)-1;if(n)this.counts.set(uid,n);else this.counts.delete(uid);
      res.end();
    };
    const send=(event,data)=>res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');
    res.on('close',stop);
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','X-Accel-Buffering':'no','Connection':'keep-alive'});
    const tick=()=>{
      if(stopped||res.destroyed)return stop();
      try {
        // Recheck session AND grant in one synchronous ACL transaction immediately
        // before each delivery. No asynchronous queue/replay of authorized snapshots.
        this.sharing.locked(()=>{
          if(!sessionValid())throw Error('unavailable');
          const {render,owner,grant}=this.sharing.authorize(uid,id);
          const dbRevision=this.sharing.elementDB?.revision(owner.conversationId,grant.message_id)||0;
          const {actions,...safe}=validateRender(render);
          const stateRevision=elementStateRevision(safe.state);
          const snapshot={id,dbRevision,render:safe,codeRevision:elementCodeRevision(render),stateRevision,canEdit:false};
          const ok=last===stateRevision+':'+dbRevision?send('heartbeat',{}):send('snapshot',snapshot);
          last=stateRevision+':'+dbRevision;
          // Never accumulate stale private payloads for a slow/disconnected client.
          if(!ok)stop();
        });
      } catch {
        // Generic invalidation also covers contention. Client must clear sandbox
        // before retrying. Already-delivered bytes cannot be recalled.
        if(!res.destroyed)send('invalidated',{id});
        stop();
      }
    };
    timer=setInterval(tick,this.interval);timer.unref?.();tick();return true;
  }
}
