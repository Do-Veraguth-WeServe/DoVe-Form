// Only unused app-owned Workers enter this slot. Acquired Workers are never
// returned: guest runtimes, callbacks and state must not cross render lifetimes.
export function createEngineSpare({create,visible,listen,setTimer=setTimeout,clearTimer=clearTimeout}) {
 let spare=null,timer=null;
 const discard=()=>{if(timer!==null)clearTimer(timer);timer=null;const old=spare;spare=null;old?.terminate();};
 listen('visibilitychange',()=>{if(!visible())discard();});
 listen('pagehide',discard);
 return {
  warm(){
   if(spare||!visible())return;
   let w;try{w=create();}catch{return;}
   spare=w;
   w.onerror=()=>{if(spare===w)discard();};
   timer=setTimer(discard,15000);
  },
  take(){
   if(!visible())discard();
   if(!spare)return create();
   const w=spare;spare=null;
   if(timer!==null)clearTimer(timer);timer=null;w.onerror=null;
   return w;
  }
 };
}
