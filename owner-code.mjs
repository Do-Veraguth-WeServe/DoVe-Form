// Deterministic JSON snapshot, including declarative actions but excluding mutable state.
// Inputs are app-owned validated render snapshots, not an authorization grant.
export function ownerCodeText(render){
  const {state,...code}=render;
  return JSON.stringify(code,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
}
