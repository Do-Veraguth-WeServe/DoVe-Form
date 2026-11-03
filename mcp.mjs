// App-owned MCP transport. No dependency on an external agent harness.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Ajv from 'ajv';
const ajv=new Ajv({strict:false,allErrors:false});
export function validateEndpoint(value){
  const u=new URL(String(value));
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.hash||u.search)throw Error('MCP-Adresse ohne Zugangsdaten, Query oder Fragment erforderlich.');
  const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
  if(u.protocol==='http:'&&!local)throw Error('Für entfernte MCP-Server ist HTTPS erforderlich.');
  return u.href;
}
export class MCPConnections{
  constructor(file){this.file=file;this.entries=[];if(fs.existsSync(file)){this.entries=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(this.entries))throw Error('Ungültige MCP-Konfiguration');}}
  save(){fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.entries,null,2),{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,this.file);}
  publicList(){return this.entries.map(({token,...e})=>({...e,hasToken:!!token}));}
  add({name,url,token=''}){
    if(this.entries.length>=12)throw Error('Maximal 12 Verbindungen.');
    if(typeof name!=='string'||!name.trim()||name.length>80)throw Error('Name erforderlich (maximal 80 Zeichen).');
    if(typeof token!=='string'||token.length>4096||token.includes(String.fromCharCode(10))||token.includes(String.fromCharCode(13)))throw Error('Ungültiger Token.');
    const e={id:crypto.randomUUID(),name:name.trim(),url:validateEndpoint(url),token,enabled:false,tools:[]};this.entries.push(e);this.save();return e.id;
  }
  get(id){const e=this.entries.find(e=>e.id===id);if(!e)throw Error('Verbindung nicht gefunden.');return e;}
  remove(id){this.get(id);this.entries=this.entries.filter(e=>e.id!==id);this.save();}
  configure(id,{enabled,allowedTools}){
    const e=this.get(id);if(typeof enabled!=='boolean'||!Array.isArray(allowedTools)||allowedTools.some(n=>typeof n!=='string'||!e.tools.some(t=>t.name===n)))throw Error('Ungültige Tool-Auswahl.');
    e.enabled=enabled;e.tools=e.tools.map(t=>({...t,allowed:allowedTools.includes(t.name)}));this.save();
  }
  async withClient(id,fn,signal){
    const e=this.get(id),url=validateEndpoint(e.url);
    const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);
    const client=new Client({name:'form',version:'3.4.0'});
    // Never follow a redirect carrying credentials to another destination.
    const transport=new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:e.token?{Authorization:'Bearer '+e.token}:{}},fetch:(input,init)=>fetch(input,{...init,redirect:'error',signal:bounded})});
    try{await client.connect(transport);return await fn(client,bounded);}finally{await client.close().catch(()=>{});}
  }
  async discover(id,signal){
    const tools=await this.withClient(id,async(client,signal)=>{
      const all=[];let cursor;let pages=0;
      do{if(++pages>10)throw Error("Zu viele Tool-Seiten.");const r=await client.listTools(cursor?{cursor}:{},{signal,timeout:15000});all.push(...r.tools);cursor=r.nextCursor;if(all.length>100)throw Error('Maximal 100 Tools pro Verbindung.');}while(cursor);
      return all;
    },signal);
    const e=this.get(id);
    e.tools=tools.map(t=>{
      if(!/^[a-zA-Z0-9_.-]{1,64}$/.test(t.name)||JSON.stringify(t.inputSchema).length>12000)throw Error('Tool-Schema nicht unterstützt.');
      ajv.compile(t.inputSchema);
      return {name:t.name,description:String(t.description||'').slice(0,1200),inputSchema:t.inputSchema,allowed:false};
    });
    // Discovery never grants execution permission, even when server metadata claims read-only.
    e.enabled=false;this.save();return this.publicList().find(x=>x.id===id);
  }
  catalog(){return this.entries.filter(e=>e.enabled).flatMap(e=>e.tools.filter(t=>t.allowed).map(t=>({fingerprint:crypto.createHash("sha256").update(JSON.stringify([e.url,e.token,t.inputSchema])).digest("hex"),connectionId:e.id,connectionName:e.name,toolName:t.name,name:'mcp_'+crypto.createHash('sha256').update(e.id+':'+t.name).digest('hex').slice(0,24),description:e.name+': '+t.description,parameters:t.inputSchema}))).slice(0,64);}
  async call(name,args,{signal}={}){
    const t=this.catalog().find(t=>t.name===name);if(!t)throw Error('Tool nicht freigegeben.');
    if(!args||typeof args!=='object'||Array.isArray(args)||JSON.stringify(args).length>16000)throw Error('Ungültige Tool-Argumente.');
    const valid=ajv.compile(t.parameters);if(!valid(args))throw Error('Tool-Argumente entsprechen nicht dem Schema.');
    const result=await this.withClient(t.connectionId,(client,signal)=>client.callTool({name:t.toolName,arguments:args},undefined,{signal,timeout:25000}),signal);
    const encoded=JSON.stringify(result);if(encoded.length>64000)throw Error('Tool-Ergebnis zu gross.');return result;
  }
}
