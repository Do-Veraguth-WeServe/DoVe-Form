// App-owned transport only. Mounting/replacing sandboxes remains the caller's job.
// No writes or replay: revision events trigger fresh owner-authorized snapshots.
const token = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function ownerRevision(value) {
  return !!value && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 80 &&
    token(value.stateRevision) && token(value.ownerCodeRevision) &&
    Number.isSafeInteger(value.dbRevision) && value.dbRevision >= 0;
}
export function sameOwnerRevision(a,b) {
  return !!a && !!b && a.id===b.id && a.stateRevision===b.stateRevision &&
    a.ownerCodeRevision===b.ownerCodeRevision && a.dbRevision===b.dbRevision;
}
export function ownerSubscriptions({openStream,fetchSnapshot,schedule=queueMicrotask,
  setTimer=setTimeout,clearTimer=clearTimeout,leaseMs=6000}) {
  const entries=new Map();let stream=null,epoch=0,scheduled=false,closed=false,lease=null;
  function closeStream(){epoch++;stream?.close();stream=null;clearTimer(lease);lease=null;}
  function fail(message){closeStream();for(const entry of entries.values()){entry.seq++;entry.dirty=false;entry.failed=true;entry.callbacks.invalidate(message);}}
  function renew(generation){if(generation!==epoch)return;clearTimer(lease);lease=setTimer(()=>{if(generation===epoch)fail('Live-Verbindung unterbrochen. Bitte erneut verbinden.');},leaseMs);}
  async function drain(entry){
    if(closed||entry.failed||entry.loading||!entry.dirty||entries.get(entry.id)!==entry||entry.callbacks.busy())return;
    entry.dirty=false;entry.loading=true;const seq=entry.seq,generation=epoch;
    try {
      const next=await fetchSnapshot(entry.id);
      if(closed||entry.failed||entries.get(entry.id)!==entry||generation!==epoch)return;
      if(seq!==entry.seq||entry.callbacks.busy()){entry.dirty=true;return;}
      if(!ownerRevision(next)||next.id!==entry.id||!next.render||typeof next.render!=='object')throw Error('Ungültige Element-Aktualisierung.');
      // apply installs a staging surface synchronously; its own lifecycle owns
      // asynchronous readiness and must cancel that surface on invalidate.
      if(!sameOwnerRevision(entry.callbacks.current(),next))entry.callbacks.apply(next);
    } catch {
      if(!closed&&generation===epoch&&entries.get(entry.id)===entry)fail('Element-Aktualisierung nicht bestätigt. Bitte erneut verbinden.');
    } finally {
      entry.loading=false;
      if(entry.dirty&&!entry.failed&&!closed)schedule(()=>void drain(entry));
    }
  }
  function rebuild(){
    scheduled=false;if(closed)return;closeStream();if(!entries.size)return;
    for(const entry of entries.values()){entry.seq++;entry.last=null;entry.dirty=true;}
    const generation=epoch,ids=[...entries.keys()];
    try {
      stream=openStream('/api/elements/owner/stream?'+ids.map(id=>'id='+encodeURIComponent(id)).join('&'));
      const active=fn=>event=>{if(generation===epoch&&!closed)fn(event);};
      stream.addEventListener('heartbeat',active(()=>renew(generation)));
      stream.addEventListener('invalidated',active(()=>fail('Element nicht mehr verfügbar.')));
      stream.addEventListener('revisions',active(event=>{
        try {
          const data=JSON.parse(event.data);
          if(!Array.isArray(data.elements)||data.elements.length!==ids.length||
            data.elements.some(r=>!ownerRevision(r)||!ids.includes(r.id))||
            new Set(data.elements.map(r=>r.id)).size!==ids.length)throw Error('revision');
          renew(generation);
          for(const revision of data.elements){const entry=entries.get(revision.id);if(!entry||entry.failed)continue;
            if(!sameOwnerRevision(entry.last,revision)){entry.last=revision;entry.seq++;entry.dirty=true;}
            if(sameOwnerRevision(entry.callbacks.current(),revision)&&!entry.loading)entry.dirty=false;
            void drain(entry);
          }
        }catch{fail('Ungültige Live-Aktualisierung. Bitte erneut verbinden.');}
      }));
      stream.onerror=active(()=>fail('Live-Verbindung unterbrochen. Bitte erneut verbinden.'));
      renew(generation);
    }catch{fail('Live-Verbindung nicht verfügbar.');}
  }
  function queueRebuild(){if(scheduled||closed)return;scheduled=true;schedule(rebuild);}
  return {
    subscribe(id,callbacks){
      if(closed)throw Error('Live-Verbindung geschlossen.');
      if(typeof id!=='string'||!id.length||id.length>80||entries.has(id))throw Error('Ungültige oder doppelte Elementauswahl.');
      if(entries.size>=12)throw Error('Live-Aktualisierung ist auf 12 gleichzeitig geöffnete Elemente begrenzt.');
      const entry={id,callbacks,seq:0,dirty:false,loading:false,failed:false,last:null};entries.set(id,entry);queueRebuild();
      return {
        // Call before a local operation and after its acknowledgement/settlement.
        // Even if busy has already cleared, old in-flight snapshots must be discarded.
        changed(){if(entries.get(id)!==entry||entry.failed)return;entry.seq++;entry.dirty=true;void drain(entry);},
        destroy(){if(entries.get(id)!==entry)return;entry.seq++;entries.delete(id);queueRebuild();}
      };
    },
    offline(){if(!closed)fail('Offline. Bitte erneut verbinden.');},
    reconnect(){if(closed)return;for(const entry of entries.values()){entry.failed=false;entry.last=null;entry.dirty=true;entry.seq++;}queueRebuild();},
    destroy(){if(closed)return;closed=true;closeStream();for(const entry of entries.values())entry.seq++;entries.clear();}
  };
}
