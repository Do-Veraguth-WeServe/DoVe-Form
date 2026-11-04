import {newQuickJSWASMModule,newVariant,RELEASE_SYNC} from 'quickjs-emscripten';
let ctx,rt,deadline,ops,count;
const ready=newQuickJSWASMModule(newVariant(RELEASE_SYNC,{wasmLocation:'/quickjs.wasm'}));

// Guest code runs per event/init with a hard interrupt deadline and an
// operation budget; every ui.* call becomes a JSON op for the host bridge.
const INIT = `
let state = __state;
let pingc = 0;
let dbc = 0;
let actionc = 0;
const handlers = Object.create(null);
const ui = Object.freeze({
  every: (ms, fn) => { if(typeof fn!=='function')throw Error('ui.every requires callback'); handlers['__clock:tick']=fn; __emit(JSON.stringify({op:'clock',ms:Math.max(50,Math.min(1000,Number(ms)||50))})); },
  text: (id, value) => __emit(JSON.stringify({op:"text", id, value:String(value)})),
  value: (id, value) => __emit(JSON.stringify({op:"value", id, value:String(value)})),
  html: (id, html) => __emit(JSON.stringify({op:"html", id, html:String(html)})),
  attr: (id, name, value) => __emit(JSON.stringify({op:"attr", id, name, value:String(value)})),
  on: (id, event, fn) => { handlers[id+":"+event] = fn; __emit(JSON.stringify({op:"on", id, event})); },
  persist: () => __emit(JSON.stringify({op:"state", state})),
  suggest: text => __emit(JSON.stringify({op:"suggest", text:String(text)})),
  ping: (host, fn) => {
    const ref = String(++pingc);
    handlers["__ping:"+ref+":ping"] = fn;
    __emit(JSON.stringify({op:"ping", host:String(host), ref}));
  },
  action: (name, inputs, fn) => {
    const ref='a'+String(++actionc);
    if(typeof fn==='function')handlers['__action:'+ref+':action']=fn;
    __emit(JSON.stringify({op:'action',name:String(name),inputs,ref}));
  },
  db: (() => {
    const call = (dbop, table, args, cb) => {
      const ref = 'd' + String(++dbc);
      if (typeof cb === 'function') handlers["__db:"+ref+":db"] = cb;
      __emit(JSON.stringify({op:"db", dbop, table:String(table), args, ref}));
    };
    return Object.freeze({
      create: (t, c, cb) => { if (typeof c === 'function') { cb = c; c = undefined; } call('create', t, [c === undefined ? null : c], cb); },
      drop: (t, cb) => call('drop', t, [], cb),
      insert: (t, row, cb) => call('insert', t, [row === undefined ? null : row], cb),
      select: (t, q, cb) => { if (typeof q === 'function') { cb = q; q = undefined; } call('select', t, [q === undefined ? null : q], cb); },
      update: (t, id, patch, cb) => call('update', t, [id, patch === undefined ? null : patch], cb),
      delete: (t, id, cb) => call('delete', t, [id], cb)
    });
  })()
});
`;

function run(code){
  deadline=Date.now()+150;count=0;ops=[];
  let result=ctx.evalCode(code);
  if(result.error){const err=ctx.dump(result.error);result.error.dispose();throw Error(err.message||'Sandbox error')}
  result.value.dispose();
  postMessage({type:'ops',ops});
}

onmessage=async({data:d})=>{
  try{
    if(d.type==='init'){
      const q=await ready;
      postMessage({type:'engine-ready'});
      rt=q.newRuntime();
      rt.setMemoryLimit(16*1024*1024);
      rt.setMaxStackSize(256*1024);
      rt.setInterruptHandler(()=>Date.now()>deadline);
      ctx=rt.newContext();
      const emit=ctx.newFunction('__emit',h=>{
        if(++count>250)throw Error('Operation budget');
        const raw=ctx.getString(h);
        const o=JSON.parse(raw);
        if(raw.length>(o.op==='html'?24000:o.op==='db'?20000:8192))throw Error('Operation size');
        ops.push(o);
      });
      ctx.setProp(ctx.global,'__emit',emit);emit.dispose();
      run('const __state='+JSON.stringify(d.state??{})+';'+INIT+d.js);
    } else if(d.type==='event'&&ctx){
      run('handlers['+JSON.stringify(d.id+':'+d.event)+']?.('+JSON.stringify(d.value)+')');
    }
  }catch(e){
    postMessage({type:'error',message:'Interaktion angehalten: '+String(e.message).slice(0,180)});
    close();
  }
};
