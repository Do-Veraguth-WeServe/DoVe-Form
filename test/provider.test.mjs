// Unit tests for the extracted provider transport (provider.mjs) against a
// local loopback SSE upstream — no real provider, no server, isolated ports.
// Caps are env-driven and set BEFORE import (module reads them once).
process.env.FORM3_CONTENT_MAX = '1000';
process.env.FORM3_TRANSPORT_MAX = '2000';
const { runRound, artifactRoundError, ProviderError, SizeError } = await import('../provider.mjs');
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// loopback upstream: behavior keyed by base path
const upstream = http.createServer((req, res) => {
  const path = req.url.split('/chat/completions')[0];
  req.resume();
  if (path === '/ok') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hallo ' } }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Welt.' }, finish_reason: 'stop' }] }) + '\n\n');
    res.write('data: [DONE]\n\n');
    return res.end();
  }
  if (path === '/truncate') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Prosa. ```json\n{"version":1,"html":"<div>abrupt' } }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'length' }] }) + '\n\n');
    res.write('data: [DONE]\n\n');
    return res.end();
  }
  if (path === '/malformed') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: this is not json\n\n');
    res.write(':\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'trotzdem lesbar.' } }] }) + '\n\n');
    res.write('garbage without data prefix\n\n');
    res.write('data: [DONE]\n\n');
    return res.end();
  }
  if (path === '/errframe') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Anfang ' } }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ error: { message: 'provider exploded' } }) + '\n\n');
    return res.end();
  }
  if (path === '/trailingline') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Start. ' } }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Ende ohne Zeilenumbruch.' } }] })); // no \n
    return res.end();
  }
  if (path === '/utf8split') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const buf = Buffer.from('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Grüsse aus Zürich' } }] }) + '\n\n');
    const k = buf.indexOf(Buffer.from('ü')) + 1;
    res.write(buf.slice(0, k));
    res.write(buf.slice(k));
    return res.end();
  }
  if (path === '/authfail') {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'bad key' } }));
  }
  if (path === '/bigcontent') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < 5; i++) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(300) } }] }) + '\n\n');
    res.write('data: [DONE]\n\n');
    return res.end();
  }
  if (path === '/bigtransport') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (let i = 0; i < 80; i++) res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'y' } }] }) + '\n\n'); // ~80 * 46 > 2000 transport bytes, content stays tiny
    res.write('data: [DONE]\n\n');
    return res.end();
  }
  if (path === '/slow') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'erster ' } }] }) + '\n\n');
    return; // never ends
  }
  res.writeHead(404); res.end();
});
await new Promise(r => upstream.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${upstream.address().port}`;
const cfg = p => ({ baseUrl: BASE + p, apiKey: 'k', model: 'm' });

test('clean round: prose parsed, finish_reason stop, actual content captured (no SSE envelopes)', async () => {
  const prose = [];
  const r = await runRound(cfg('/ok'), [{ role: 'user', content: 'hi' }], {}, t => prose.push(t));
  assert.equal(prose.join(''), 'Hallo Welt.');
  assert.equal(r.finishReason, 'stop');
  assert.equal(r.truncated, false);
  assert.equal(r.render, null);
  assert.equal(r.hadArtifact, false);
  assert.equal(r.contentText, 'Hallo Welt.');
  assert.ok(!r.contentText.includes('data:'));
});

test('finish_reason=length sets truncated; unterminated artifact reported as invalid', async () => {
  const r = await runRound(cfg('/truncate'), [{ role: 'user', content: 'hi' }], {});
  assert.equal(r.truncated, true);
  assert.equal(r.finishReason, 'length');
  assert.equal(r.render, null);
  assert.ok(r.hadArtifact);
  assert.ok(r.error);
  assert.ok(r.contentText.includes('```json'));
});

test('malformed SSE frames are ignored, valid frames still parsed', async () => {
  const prose = [];
  const r = await runRound(cfg('/malformed'), [{ role: 'user', content: 'hi' }], {}, t => prose.push(t));
  assert.equal(prose.join(''), 'trotzdem lesbar.');
  assert.equal(r.finishReason, null);
});

test('explicit provider error frame throws ProviderError (distinct from malformed frames)', async () => {
  await assert.rejects(
    () => runRound(cfg('/errframe'), [{ role: 'user', content: 'hi' }], {}),
    e => e instanceof ProviderError && e.message.includes('provider exploded')
  );
});

test('final unterminated SSE line is parsed', async () => {
  const prose = [];
  await runRound(cfg('/trailingline'), [{ role: 'user', content: 'hi' }], {}, t => prose.push(t));
  assert.equal(prose.join(''), 'Start. Ende ohne Zeilenumbruch.');
});

test('UTF-8 multibyte char split across reads is reassembled', async () => {
  const prose = [];
  await runRound(cfg('/utf8split'), [{ role: 'user', content: 'hi' }], {}, t => prose.push(t));
  assert.equal(prose.join(''), 'Grüsse aus Zürich');
});

test('upstream 401 becomes ProviderError with status (permanent, caller must not retry)', async () => {
  await assert.rejects(
    () => runRound(cfg('/authfail'), [{ role: 'user', content: 'hi' }], {}),
    e => e instanceof ProviderError && e.message.includes('401') && e.status === 401
  );
});

test('content cap (accumulated deltas) throws SizeError', async () => {
  await assert.rejects(
    () => runRound(cfg('/bigcontent'), [{ role: 'user', content: 'hi' }], {}),
    e => e instanceof SizeError
  );
});

test('transport cap (raw SSE bytes) throws SizeError even with tiny visible content', async () => {
  await assert.rejects(
    () => runRound(cfg('/bigtransport'), [{ role: 'user', content: 'hi' }], {}),
    e => e instanceof SizeError
  );
});

test('round deadline expiry maps to abortKind timeout', async () => {
  await assert.rejects(
    () => runRound(cfg('/slow'), [{ role: 'user', content: 'hi' }], { deadlineMs: Date.now() + 300 }),
    e => e.abortKind === 'timeout'
  );
});

test('external abort maps to abortKind external, not timeout', async () => {
  const stop = new AbortController();
  const p = runRound(cfg('/slow'), [{ role: 'user', content: 'hi' }], { signal: stop.signal });
  await sleep(150);
  stop.abort();
  await assert.rejects(p, e => e.abortKind === 'external');
});

test('already-expired deadline fails fast with timeout kind', async () => {
  await assert.rejects(
    () => runRound(cfg('/ok'), [{ role: 'user', content: 'hi' }], { deadlineMs: Date.now() - 1 }),
    e => e.abortKind === 'timeout'
  );
});

test('job generation has no default or zero-configured deadline', async () => {
  const { JobRunner } = await import('../jobs.mjs');
  assert.equal(new JobRunner({}).totalMs, Infinity);
  assert.equal(new JobRunner({}, {totalMs: 0}).totalMs, Infinity);
  assert.equal(new JobRunner({}, {totalMs: 12000}).totalMs, 12000);
});

test.after(() => new Promise(r => upstream.close(r)));

process.on('exit', () => upstream.close());

// Deterministic connection-reset regressions; never touch a real provider.
test('empty ECONNRESET retries once and completes, permanent reset stays bounded', async () => {
 const original=globalThis.fetch;let calls=0,retries=0;
 const reset=()=>new TypeError('terminated',{cause:Object.assign(Error('read ECONNRESET'),{code:'ECONNRESET'})});
 try{
  globalThis.fetch=async()=>{if(++calls===1)throw reset();return new Response('data: '+JSON.stringify({choices:[{delta:{content:'Recovered.'},finish_reason:'stop'}]})+'\n\n');};
  const r=await runRound(cfg('/unused'),[],{onTransportRetry:()=>retries++});assert.equal(calls,2);assert.equal(retries,1);assert.equal(r.contentText,'Recovered.');
  calls=0;globalThis.fetch=async()=>{calls++;throw reset()};
  await assert.rejects(()=>runRound(cfg('/unused'),[],{}),e=>e instanceof ProviderError&&e.cause.code==='ECONNRESET');assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});
test('connection reset after visible prose is not replayed',async()=>{
 const original=globalThis.fetch;let calls=0,visible='';
 try{
  globalThis.fetch=async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content:'Already visible.'}}]})+'\n\n'));setTimeout(()=>c.error(new TypeError('terminated',{cause:Object.assign(Error('reset'),{code:'ECONNRESET'})})),20);}}));};
  await assert.rejects(()=>runRound(cfg('/unused'),[],{},t=>visible+=t),ProviderError);assert.equal(calls,1);assert.equal(visible,'Already visible.');
 }finally{globalThis.fetch=original;}
});

// Regression (report 9fb9f9ba): the fixed rejection hint is ~150 chars, so the
// old 160-char cap truncated the verifier's bounded structural detail to
// "attribute-r" and the corrective round could not name the violation.
test('artifact rejection keeps the bounded verifier detail for the corrective round', () => {
 const hint='Animation browser verification rejected [HTML]: Use supported HTML: safe IDs, allowed tags/attributes/input types; no inline handlers or URL values.';
 const detail='attribute-removed:style×2, element-removed:marquee';
 const kept=artifactRoundError(new Error(hint+' '+detail));
 assert.ok(kept.length>160,'detail-bearing rejection must exceed the old cap');
 assert.match(kept,/attribute-removed:style/);
 assert.ok(kept.length<=400,'round error stays bounded');
 assert.equal(artifactRoundError(new Error('x'.repeat(5000))).length,400);
 for(const m of ['Animation verification unavailable','Animation verification incomplete','Animation verification deadline','Animation browser verification rejected [INTERNAL]: Isolated verifier unavailable or rejected the artifact.'])
  assert.throws(()=>artifactRoundError(new Error(m)),e=>e instanceof ProviderError,/Elementprüfung/);
});
