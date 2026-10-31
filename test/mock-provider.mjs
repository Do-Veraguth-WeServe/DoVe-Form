// Mock OpenAI-compatible streaming provider for tests.
// Speaks POST /v1/chat/completions with SSE deltas. Scenarios are routed by
// keywords in the last user message. GET /admin/stats exposes call counts,
// disconnects, auth state and the last request's message roles (for history tests).
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 4599);
const KEY = 'test-key-1234567890';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const stats = { calls: {}, disconnects: 0, lastAuthOk: false, lastRoles: [], lastUserContent: '' };

const sliderArtifact = {
  version: 1,
  html: '<div><h2>Spar-Rechner</h2><label for="amt">Wert <strong id="lbl"></strong></label><input id="amt" type="range" min="1" max="10" step="1"><p id="out"></p></div>',
  css: 'h2{color:#d4ef8b}input[type=range]{accent-color:#d4ef8b}p{color:#9ca49f}',
  js: 'ui.value("amt",String(state.value||3));function draw(){ui.text("lbl",String(state.value||3));ui.text("out","Wert: "+(state.value||3))}ui.on("amt","input",e=>{state.value=Number(e.value);draw();ui.persist()});draw();',
  state: { value: 3 }
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
    sseWrite(res, { choices: [{ delta: { content: c.t } }] });
    if (c.pause) await sleep(c.pause);
  }
  if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
}

async function run(scenario, res) {
  const P = (t, pause) => ({ t, pause });
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
  if (scenario === 'slow') return stream(res, [
    P('Erster Gedanke …', 6000),
    P(' Zweiter Teil nach der Pause.', 30)
  ]);
  if (scenario === 'boundary') return stream(res, [
    P('Boundary-Test.', 20),
    P('```json\n' + JSON.stringify(boundaryArtifact) + '\n```', 10)
  ]);
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
  stats.lastUserContent = String(lastUser?.content || '').slice(0, 300);
  const corrective = messages.some(m => m.role === 'user' && String(m.content).startsWith('Your previous answer'));
  let scenario = 'prose';
  if (corrective) scenario = 'corrected';
  else if (text.includes('slider')) scenario = 'slider';
  else if (text.includes('invalid')) scenario = 'invalid';
  else if (text.includes('slow')) scenario = 'slow';
  else if (text.includes('boundary')) scenario = 'boundary';
  stats.calls[scenario] = (stats.calls[scenario] || 0) + 1;
  req.on('close', () => { if (!res.writableEnded) stats.disconnects++; });
  res.on('close', () => { if (!res.writableEnded) stats.disconnects++; });
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  await run(scenario, res);
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock provider ready on http://127.0.0.1:${PORT}`));
