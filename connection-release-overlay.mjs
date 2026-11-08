// Release adapter for the older production backend. Does not publish pending sharing work.
export function connectionReleaseOverlay(base,source){
 if(base.includes("from './connection-vault.mjs'"))throw Error('Connections already present; inspect before retry.');
 const once=(text,needle,value)=>{if(text.split(needle).length!==2)throw Error('Release anchor changed: '+needle);return text.replace(needle,value);};
 let out=once(base,"import {FormSharing} from './form-sharing.mjs';","import {FormSharing} from './form-sharing.mjs';\nimport {ConnectionVault} from './connection-vault.mjs';\nimport {ElementConnections} from './element-connections.mjs';");
 out=once(out,'const DB_RATE =',"const privateConnections=new ConnectionVault(store.db,path.join(DATA_DIR,'connection-master.key'));\nconst elementConnections=new ElementConnections(store,privateConnections);\nconst DB_RATE =");
 const a=source.indexOf("  if(pathname==='/api/element-settings'"),b=source.indexOf("  if(pathname==='/api/http'",a);if(a<0||b<a)throw Error('Connection routes missing.');out=once(out,"  if(pathname==='/api/http'||pathname.startsWith('/api/http/')){",source.slice(a,b)+"  if(pathname==='/api/http'||pathname.startsWith('/api/http/')){");return out;
}
