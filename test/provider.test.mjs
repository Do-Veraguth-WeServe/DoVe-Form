// Unit tests for the extracted provider transport (provider.mjs) against a
// local loopback SSE upstream — no real provider, no server, isolated ports.
// Caps are env-driven and set BEFORE import (module reads them once).
process.env.FORM3_CONTENT_MAX = '1000';
process.env.FORM3_TRANSPORT_MAX = '2000';
const { runRound, ProviderError, SizeError } = await import('../provider.mjs');
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

test.after(() => new Promise(r => upstream.close(r)));

process.on('exit', () => upstream.close());
