// Mock OpenAI-compatible streaming provider for tests.
// Speaks POST /v1/chat/completions with SSE deltas. Scenarios are routed by
// keywords in the last user message. GET /admin/stats exposes call counts,
// disconnects, auth state and the last request's message roles (for history tests).
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4599);
const KEY = 'test-key-1234567890';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const stats = { calls: {}, disconnects: 0, lastAuthOk: false, lastRoles: [], lastUserContent: '', lastMessages: [] };

const sliderArtifact = {
  version: 1,
  name: 'Spar-Rechner',
  html: '<div><h2>Spar-Rechner</h2><label for="amt">Wert <strong id="lbl"></strong></label><input id="amt" type="range" min="1" max="10" step="1"><p id="out"></p></div>',
  css: 'h2{color:#d4ef8b}input[type=range]{accent-color:#d4ef8b}p{color:#9ca49f}',
  js: 'ui.value("amt",String(state.value||3));function draw(){ui.text("lbl",String(state.value||3));ui.text("out","Wert: "+(state.value||3))}ui.on("amt","input",e=>{state.value=Number(e.value);draw();ui.persist()});draw();',
  state: { value: 3 }
};

// Same element, accent flipped to blue — proves in-place refinement.
const refinedArtifact = {
  version: 1,
  name: 'Spar-Rechner',
  html: sliderArtifact.html,
  css: 'h2{color:#7fd4ef}input[type=range]{accent-color:#7fd4ef}p{color:#9ca49f}',
  js: sliderArtifact.js,
  state: { value: 3 }
};

// Lab-shell element exercising ui.ping through the parent bridge.
const pingArtifact = {
  version: 1,
  name: 'Netz-Labor',
  html: '<div><h2>Netz-Labor</h2><label for="phost">Ziel</label><input id="phost" type="text" value="example.com"><button id="go">Ping</button><p id="pout">–</p></div>',
  css: 'h2{color:#d4ef8b}button{margin:6px 0}p{color:#9ca49f}',
  js: 'ui.value("phost",state.host||"example.com");ui.on("go","click",()=>{ui.text("pout","ping "+state.host+" …");ui.ping(state.host,r=>{ui.text("pout",r.ok?("online · "+r.ms+" ms · "+r.ip):("offline · "+(r.error||"?")))})});ui.on("phost","input",e=>{state.host=e.value;ui.persist()});',
  state: { host: 'example.com' }
};

// Data-driven element exercising ui.db (persistent tables) end to end.
const dbArtifact = {
  version: 1,
  name: 'Aufgaben-DB',
  html: '<div><h2>Aufgaben-DB</h2><input id="t" type="text"><button id="add">+</button><button id="done">Erste erledigt</button><button id="pop">Erste löschen</button><button id="big">Grosse Zeile</button><button id="dropall">Tabelle löschen</button><ul id="list"></ul><p id="msg">startet …</p></div>',
  css: 'h2{color:#d4ef8b}button{margin:4px 4px 0 0}li{margin:2px 0;color:#e9e9de}p{color:#9ca49f}',
  js: 'state.items=state.items||[];function draw(){ui.html("list",state.items.map(function(i){return "<li>"+String(i.t)+(i.done?" ✓":"")+"</li>"}).join(""))}function load(){ui.db.select("todos",{},function(r){if(r.ok){state.items=r.rows||[];draw();ui.text("msg","geladen: "+state.items.length)}else{ui.text("msg",r.error||"db")}})}ui.db.create("todos",["t","done"],function(){load()});ui.on("t","input",function(e){state.t=e.value;ui.persist()});ui.on("add","click",function(){var t=state.t||("item "+(state.items.length+1));ui.db.insert("todos",{t:t,done:false},function(r){if(r.ok){state.items.push({id:r.id,t:t,done:false});draw();ui.text("msg","ok id "+r.id);ui.value("t","");state.t="";ui.persist()}else{ui.text("msg","Fehler: "+(r.error||"?"))}})});ui.on("done","click",function(){var f=state.items[0];if(!f)return ui.text("msg","leer");ui.db.update("todos",f.id,{done:true},function(r){ui.text("msg",r.ok?"updated "+f.id:"Fehler: "+(r.error||"?"));if(r.ok){f.done=true;draw()}})});ui.on("pop","click",function(){var f=state.items[0];if(!f)return ui.text("msg","leer");ui.db.delete("todos",f.id,function(r){ui.text("msg",r.ok?"gelöscht "+f.id:"Fehler: "+(r.error||"?"));if(r.ok){state.items.shift();draw()}})});ui.on("big","click",function(){var s="";for(var i=0;i<19000;i++)s+="x";ui.db.insert("todos",{t:s},function(r){ui.text("msg",r.ok?"surreal ok":"Fehler: "+(r.error||"?"))})});ui.on("dropall","click",function(){ui.db.drop("todos",function(r){ui.text("msg",r.ok?"gedroppt":"Fehler: "+(r.error||"?"));if(r.ok){state.items=[];draw()}})});load();',
  state: {}
};

// Element B: proves per-element table scoping from inside the sandbox.
const scopeArtifact = {
  version: 1,
  name: 'Scoping-Test',
  html: '<div><h2>Scoping-Test</h2><button id="s">todos lesen</button><p id="msg">–</p></div>',
  css: 'h2{color:#d4ef8b}p{color:#9ca49f}',
  js: 'ui.on("s","click",function(){ui.db.select("todos",{},function(r){ui.text("msg",r.ok?"SEHEN!":"isoliert: "+(r.error||"?"))})});',
  state: {}
};

const boundaryArtifact = {
  version: 1,
  html: '<meta http-equiv="refresh" content="0;url=https://example.com"><a href="https://example.com">link</a><img src="https://example.com"><svg><a href="https://example.com"><text>X</text></a></svg><input id="amount" type="number"><p id="result"></p><svg viewBox="0 0 100 100"><g id="dyn"></g><g id="dyn3"></g></svg><div id="dyn2"></div><button id="suggest" onclick="location="https://example.com"">Suggest</button><script>location="https://example.com"</script>',
  css: '@import "https://example.com";p{background:url(https://example.com);color:#d4ef8b}',
  js: 'state.amount=state.amount||2;ui.value("amount",String(state.amount));ui.text("result",typeof window+"/"+typeof fetch+"/"+typeof document);ui.on("amount","input",e=>{state.amount=Number(e.value);ui.text("result",String(state.amount*12));ui.persist()});ui.on("suggest","click",()=>ui.suggest("explicit only"));ui.value("result","nope");ui.html("dyn","<script>location=\'https://example.com\'</script><img src=\'https://example.com\'><rect width=\'13\' height=\'13\'/>");ui.html("dyn2","<p>ok</p>");ui.html("dyn3","<rect width=\'9\' height=\'9\'/>");',
  state: {}
};

function sseWrite(res, obj) { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }

async function stream(res, chunks) {
  for (const c of chunks) {
    if (res.writableEnded || res.destroyed) return;
    sseWrite(res, { choices: [{ delta: { content: c.t }, ...(c.fr ? { finish_reason: c.fr } : {}) }] });
    if (c.pause) await sleep(c.pause);
  }
  if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
}

async function run(scenario, res) {
  const P = (t, pause, fr) => ({ t, pause, fr });
  if (scenario === 'slider') return stream(res, [
    P('Hier ist dein Spar-Rechner mit Regler. ', 60),
    P('Damit siehst du sofort, ', 60),
    P('wie sich der Wert ändert — ohne Neuladen.', 60),
    P('```json\n' + JSON.stringify(sliderArtifact) + '\n```', 10)
  ]);
  if (scenario === 'invalid') return stream(res, [
    P('Ich baue dir das Artefakt. ', 40),
    P('```json\n{"version":1,"html": "unclosed\n```', 20)
  ]);
  if (scenario === 'corrected') return stream(res, [
    P('Korrigierte Fassung: ', 40),
    P('```json\n' + JSON.stringify(sliderArtifact) + '\n```', 10)
  ]);
  if (scenario === 'refine') return stream(res, [
    P('Akzent jetzt blau. ', 40),
    P('```json\n' + JSON.stringify(refinedArtifact) + '\n```', 10)
  ]);
  if (scenario === 'pingshell') return stream(res, [
    P('Hier ist dein Netz-Labor mit echtem Ping. ', 40),
    P('```json\n' + JSON.stringify(pingArtifact) + '\n```', 10)
  ]);
  if (scenario === 'dbschema') return stream(res, [
    P('Hier ist deine Aufgaben-DB mit eigener Tabelle. ', 40),
    P('```json\n' + JSON.stringify(dbArtifact) + '\n```', 10)
  ]);
  if (scenario === 'dbscope') return stream(res, [
    P('Scoping-Test. ', 20),
    P('```json\n' + JSON.stringify(scopeArtifact) + '\n```', 10)
  ]);
  if (scenario === 'slow') return stream(res, [
    P('Erster Gedanke …', 6000),
    P(' Zweiter Teil nach der Pause.', 30)
  ]);
  if (scenario === 'boundary') return stream(res, [
    P('Boundary-Test.', 20),
    P('```json\n' + JSON.stringify(boundaryArtifact) + '\n```', 10)
  ]);
  // finish_reason=length truncation: prose complete, artifact JSON cut off
  if (scenario === 'truncate') return stream(res, [
    P('Hier verschiedene Darstellungen — leider zu lang. ', 20),
    P('```json\n{"version":1,"name":"Cut","html":"<div id=\\"x\\">unterminated', 10, 'length')
  ]);
  // explicit provider error frame mid-stream
  if (scenario === 'errframe') {
    res.write('data: {"error":{"message":"upstream exploded"}}\n\n');
    return res.end();
  }
  // final SSE line without trailing newline (unterminated)
  if (scenario === 'trailingline') {
    sseWrite(res, { choices: [{ delta: { content: 'Erster Teil. ' } }] });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Letztes Fragment.' } }] }));
    return res.end();
  }
  // one delta split mid-UTF8-codepoint across two TCP writes
  if (scenario === 'utf8split') {
    const buf = Buffer.from('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Grüsse aus Zürich' } }] }) + '\n\n');
    const k = buf.indexOf(Buffer.from('ü')) + 1; // split INSIDE the 2-byte sequence
    res.write(buf.slice(0, k));
    res.write(buf.slice(k));
    return res.end();
  }
  // default: prose-only
  return stream(res, [
    P('VPN steht für "Virtual Private Network". ', 60),
    P('Es verlängert dein privates Netz ', 60),
    P('um einen verschlüsselten Tunnel ', 60),
    P('und versteckt dadurch vieles von dem, was Websites über dich sehen könnten.', 40)
  ]);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/admin/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(stats));
  }
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) { res.writeHead(404); return res.end(); }
  let body = '';
  for await (const c of req) { body += c; if (body.length > 200000) break; }
  stats.lastAuthOk = req.headers.authorization === 'Bearer ' + KEY;
  let messages = [];
  try { messages = JSON.parse(body).messages || []; } catch {}
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const text = String(lastUser?.content || '').toLowerCase();
  stats.lastRoles = messages.map(m => m.role);
  stats.lastUserContent = String(lastUser?.content || '').slice(0, 1200);
  stats.lastMessages = messages.map(m => ({ role: m.role, content: String(m.content).slice(0, 500) }));
  const corrective = messages.some(m => m.role === 'user' && String(m.content).startsWith('Your previous answer'));
  const refine = messages.some(m => m.role === 'user' && String(m.content).includes('[marked-element'));
  let scenario = 'prose';
  if (corrective) scenario = 'corrected';
  else if (refine) scenario = 'refine';
  else if (text.includes('netz-labor')) scenario = 'pingshell';
  else if (text.includes('aufgaben-db')) scenario = 'dbschema';
  else if (text.includes('scoping-test')) scenario = 'dbscope';
  else if (text.includes('slider')) scenario = 'slider';
  else if (text.includes('invalid')) scenario = 'invalid';
  else if (text.includes('slow')) scenario = 'slow';
  else if (text.includes('boundary')) scenario = 'boundary';
  else if (text.includes('truncate')) scenario = 'truncate';
  else if (text.includes('errframe')) scenario = 'errframe';
  else if (text.includes('trailingline')) scenario = 'trailingline';
  else if (text.includes('utf8split')) scenario = 'utf8split';
  else if (text.includes('unauthorized')) scenario = 'unauthorized';
  stats.calls[scenario] = (stats.calls[scenario] || 0) + 1;
  req.on('close', () => { if (!res.writableEnded) stats.disconnects++; });
  res.on('close', () => { if (!res.writableEnded) stats.disconnects++; });
  if (scenario === 'unauthorized') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  await run(scenario, res);
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock provider ready on http://127.0.0.1:${PORT}`));
