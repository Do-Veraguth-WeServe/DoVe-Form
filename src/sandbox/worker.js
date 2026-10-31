import { newQuickJSWASMModule, newVariant, RELEASE_SYNC } from 'quickjs-emscripten';
let ctx, rt, deadline, ops, count;
const ready = newQuickJSWASMModule(
  newVariant(RELEASE_SYNC, { wasmLocation: '/form/quickjs.wasm' }),
);
function run(code) {
  deadline = Date.now() + 150;
  count = 0;
  ops = [];
  let result = ctx.evalCode(code);
  if (result.error) {
    const err = ctx.dump(result.error);
    result.error.dispose();
    throw Error(err.message || 'Sandbox error');
  }
  result.value.dispose();
  postMessage({ type: 'ops', ops });
}
onmessage = async ({ data: d }) => {
  try {
    if (d.type === 'init') {
      const q = await ready;
      rt = q.newRuntime();
      rt.setMemoryLimit(16 * 1024 * 1024);
      rt.setMaxStackSize(256 * 1024);
      rt.setInterruptHandler(() => Date.now() > deadline);
      ctx = rt.newContext();
      const emit = ctx.newFunction('__emit', (h) => {
        if (++count > 250) throw Error('Operation budget');
        const raw = ctx.getString(h);
        if (raw.length > 8192) throw Error('Operation size');
        ops.push(JSON.parse(raw));
      });
      ctx.setProp(ctx.global, '__emit', emit);
      emit.dispose();
      run(
        'let state=' +
          JSON.stringify(d.state) +
          ';const handlers=Object.create(null);const ui=Object.freeze({text:(id,value)=>__emit(JSON.stringify({op:"text",id,value:String(value)})),value:(id,value)=>__emit(JSON.stringify({op:"value",id,value:String(value)})),attr:(id,name,value)=>__emit(JSON.stringify({op:"attr",id,name,value:String(value)})),on:(id,event,fn)=>{handlers[id+":"+event]=fn;__emit(JSON.stringify({op:"on",id,event}))},persist:()=>__emit(JSON.stringify({op:"state",state})),suggest:text=>__emit(JSON.stringify({op:"suggest",text:String(text)}))});\n' +
          d.js,
      );
    } else if (d.type === 'event' && ctx) {
      run(
        'handlers[' + JSON.stringify(d.id + ':' + d.event) + ']?.(' + JSON.stringify(d.value) + ')',
      );
    }
  } catch (e) {
    postMessage({
      type: 'error',
      message: 'Interaktion angehalten: ' + String(e.message).slice(0, 180),
    });
    close();
  }
};
