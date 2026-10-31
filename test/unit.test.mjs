import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRender, parseArtifact, systemPrompt, sanitizeName, deriveName, refineInstruction } from '../contract.mjs';
import { createStreamParser } from '../stream.mjs';
import { validateModelInput, maskKey, loadModels, saveModels } from '../models.mjs';
import { validHost, ipBlocked, runPing } from '../ping.mjs';
import { getQuickJS } from 'quickjs-emscripten';

test('render contract rejects malformed and oversized output', () => {
  assert.throws(() => parseArtifact('hello'));
  assert.throws(() => validateRender({ version: 1, html: 'x'.repeat(65000), css: '', js: '' }));
  assert.throws(() => validateRender({ version: 2, html: '', css: '', js: '' }));
  assert.throws(() => validateRender({ version: 1, html: '', css: '', js: '', state: [1] }));
  assert.equal(parseArtifact('{"version":1,"html":"ok","css":"","js":"","state":{}}').html, 'ok');
  assert.equal(parseArtifact('```json\n{"version":1,"html":"ok","css":"","js":"","state":{}}\n```').html, 'ok');
});

test('system prompt carries the v3 two-phase + SVG visual rules', () => {
  assert.ok(systemPrompt.includes('```json'));
  assert.ok(systemPrompt.includes('FIRST'));
  assert.ok(systemPrompt.includes('prose-only'));
  assert.ok(systemPrompt.includes('exactly ONE'));
  assert.ok(systemPrompt.includes('document order'));
  assert.ok(systemPrompt.includes('stroke-dasharray'));
  assert.ok(systemPrompt.includes('LAST element'));
  assert.ok(systemPrompt.includes('viewBox'));
  assert.ok(systemPrompt.includes('ui.ping'), 'ping primitive documented');
  assert.ok(systemPrompt.includes('NO fetch'), 'sandbox stays network-free otherwise');
});

test('render contract: optional name is sanitized as text', () => {
  assert.equal(validateRender({ version: 1, name: '  Spar-Rechner  ', html: 'x', css: '', js: '', state: {} }).name, 'Spar-Rechner');
  assert.equal(validateRender({ version: 1, name: 'a\nb\tc', html: 'x', css: '', js: '', state: {} }).name, 'a b c');
  assert.equal(validateRender({ version: 1, name: 'x'.repeat(100), html: 'x', css: '', js: '', state: {} }).name.length, 80);
  assert.equal('name' in validateRender({ version: 1, name: 42, html: 'x', css: '', js: '', state: {} }), false, 'non-string name dropped');
  assert.equal('name' in validateRender({ version: 1, name: '   ', html: 'x', css: '', js: '', state: {} }), false, 'blank name dropped');
});

test('deriveName: heading, then prose snippet, then fallback', () => {
  assert.equal(deriveName({ html: '<div><h1>Titel</h1></div>' }, 'x'), 'Titel');
  assert.equal(deriveName({ html: '<h2>A <em>B</em> C</h2>' }, 'x'), 'A B C');
  assert.equal(deriveName({ html: '<p>kein heading</p>' }, 'Ein Satz über Dinge'), 'Ein Satz über Dinge');
  assert.equal(deriveName({ html: '<p>x</p>' }, ''), 'Element');
});

test('refine instruction demands a full in-place update', () => {
  assert.ok(refineInstruction.includes('IN-PLACE REFINEMENT MODE'));
  assert.ok(refineInstruction.includes('FULL updated'));
  assert.ok(refineInstruction.includes('never a diff'));
  assert.ok(refineInstruction.includes('untrusted data'));
});

test('validHost: strict hostnames only, no literals/URLs/private forms', () => {
  for (const good of ['example.com', 'api.example.com', 'one.one.one.one', 'a-b.example.co.uk']) assert.equal(validHost(good), true, good);
  for (const bad of ['', 'localhost', '192.168.1.1', '8.8.8.8', '::1', 'fe80::1', 'http://example.com', 'example.com/x', 'example.com:443',
                     'exa mple.com', '-a.example.com', 'a..com', 'x'.repeat(300), 'example.123', '123.45.6.7.8', 'example-.com', null, 42])
    assert.equal(validHost(bad), false, JSON.stringify(bad));
});

test('ipBlocked: every private/reserved range is caught, public passes', () => {
  for (const pub of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) assert.equal(ipBlocked(pub), false, pub);
  for (const priv of ['10.0.0.1', '172.16.0.1', '192.168.0.1', '127.0.0.1', '0.0.0.0', '169.254.1.1', '100.64.0.1', '224.0.0.1', '240.0.0.1', '255.255.255.255',
                      '::1', '::', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:10.0.0.1', '::ffff:192.168.0.1', 'not-an-ip', ''])
    assert.equal(ipBlocked(priv), true, priv);
});

test('runPing: ok / blocked / dual-stack / dns-fail / timeout with injected backend', async () => {
  const ok = await runPing({ host: 'good.example', sessionId: 's1', backend: { lookup: async () => [{ address: '93.184.216.34' }], exec: async () => ({ err: null, stdout: '64 bytes from 93.184.216.34: icmp_seq=1 ttl=54 time=23.4 ms' }) } });
  assert.deepEqual(ok, { status: 200, result: { ok: true, ip: '93.184.216.34', ms: 23 } });
  const quiet = await runPing({ host: 'good.example', backend: { lookup: async () => [{ address: '93.184.216.34' }], exec: async () => ({ err: null, stdout: '' }) } });
  assert.equal(quiet.result.ok, false);
  const blk = await runPing({ host: 'private.example', backend: { lookup: async () => [{ address: '10.0.0.5' }], exec: async () => ({ err: null, stdout: '' }) } });
  assert.equal(blk.status, 403);
  const dual = await runPing({ host: 'dual.example', backend: { lookup: async () => [{ address: '93.184.216.34' }, { address: 'fe80::1' }], exec: async () => ({ err: null, stdout: '' }) } });
  assert.equal(dual.status, 403, 'one blocked address among many blocks the ping');
  const dns = await runPing({ host: 'nope.example', backend: { lookup: async () => { throw Error('NXDOMAIN'); }, exec: async () => ({ err: null, stdout: '' }) } });
  assert.equal(dns.status, 200); assert.equal(dns.result.ok, false); assert.match(dns.result.error, /nicht gefunden/i);
  const to = await runPing({ host: 'good.example', backend: { lookup: async () => [{ address: '93.184.216.34' }], exec: async () => ({ err: Error('Command failed: timeout'), stdout: '' }) } });
  assert.equal(to.result.ok, false); assert.match(to.result.error, /Zeitüberschreitung/);
  const bad = await runPing({ host: '192.168.1.1' });
  assert.equal(bad.status, 400);
});

test('optional: real /bin/ping binary probe (skip when absent or offline)', { skip: !process.env.FORM3_REAL_PING }, async () => {
  const r = await runPing({ host: 'one.one.one.one', sessionId: 'real-probe' });
  assert.equal(r.status === 200 || r.status === 403, true);
  console.log('real ping probe:', JSON.stringify(r));
});

test('stream parser: prose-only answer relays everything', () => {
  const prose = [];
  const p = createStreamParser({ onProse: t => prose.push(t) });
  p.feed('Hello ');
  p.feed('world. A `` pair and a lone ``` fence-free text.');
  const fin = p.finish();
  assert.equal(fin.hadArtifact, false);
  assert.equal(fin.artifactRaw, null);
  assert.equal(prose.join(''), 'Hello world. A `` pair and a lone ``` fence-free text.');
});

test('stream parser: marker split across chunks is not emitted as prose', () => {
  const prose = [];
  let started = 0;
  const p = createStreamParser({ onProse: t => prose.push(t), onArtifactStart: () => started++ });
  p.feed('Erste Antwort. Dann``');
  p.feed('`json\n{"vers');
  p.feed('ion":1,"html":"x","css":"","js":"","state":{}}');
  p.feed('\n```\n');
  const fin = p.finish();
  assert.equal(prose.join(''), 'Erste Antwort. Dann');
  assert.equal(started, 1);
  assert.equal(fin.hadArtifact, true);
  const render = parseArtifact(fin.artifactRaw);
  assert.equal(render.html, 'x');
});

test('stream parser: artifact in same chunk as marker, unterminated fence', () => {
  const prose = [];
  let started = 0;
  const p = createStreamParser({ onProse: t => prose.push(t), onArtifactStart: () => started++ });
  p.feed('Prose.```json\n{"version":1,"html":"y","css":"","js":"","state":{}}');
  const fin = p.finish();
  assert.equal(prose.join(''), 'Prose.');
  assert.equal(started, 1);
  assert.equal(fin.hadArtifact, true);
  assert.equal(parseArtifact(fin.artifactRaw).html, 'y');
});

test('stream parser: partial-marker suffix is held back, not lost', () => {
  const prose = [];
  const p = createStreamParser({ onProse: t => prose.push(t) });
  p.feed('a``');
  p.feed('x');
  const fin = p.finish();
  assert.equal(fin.hadArtifact, false);
  assert.equal(prose.join(''), 'a``x'); // backticks are real prose when no marker follows
});

test('model registry: validation, masking, persistence, ENOENT safety', () => {
  const tmp = path.join(os.tmpdir(), 'form3-unit-models-' + Date.now() + '.json');
  try {
    assert.throws(() => validateModelInput({ label: 'x', baseUrl: 'ftp://nope', model: 'm', apiKey: '123456' }));
    assert.throws(() => validateModelInput({ label: 'x', baseUrl: 'https://a.b/v1', model: 'm', apiKey: '123' }));
    assert.throws(() => validateModelInput({ label: 'x', baseUrl: 'https://a.b/v1', model: '', apiKey: '123456' }));
    const v = validateModelInput({ label: ' z.ai ', baseUrl: 'https://api.z.ai/v1/', model: 'glm-4.6', apiKey: 'sk-test-abcdef' });
    assert.deepEqual(v, { label: 'z.ai', baseUrl: 'https://api.z.ai/v1/', model: 'glm-4.6', apiKey: 'sk-test-abcdef' });
    assert.equal(maskKey('sk-test-abcdef'), '…cdef');
    // missing file -> empty registry, never an abort
    assert.deepEqual(loadModels(tmp + '-does-not-exist'), { models: [] });
    saveModels(tmp, { models: [{ id: 'x', label: 'l', baseUrl: 'https://a.b', model: 'm', apiKey: 'keykeykey' }] });
    assert.equal(fs.statSync(tmp).mode & 0o777, 0o600);
    assert.equal(loadModels(tmp).models[0].apiKey, 'keykeykey');
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
});

test('QuickJS has no browser capabilities or host Function escape', async () => {
  const q = await getQuickJS();
  const c = q.newContext();
  for (const name of ['window', 'document', 'location', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'importScripts', 'process', 'require']) {
    const h = c.unwrapResult(c.evalCode('typeof ' + name));
    assert.equal(c.dump(h), 'undefined');
    h.dispose();
  }
  const r = c.unwrapResult(c.evalCode('Function("return typeof globalThis.fetch")()'));
  assert.equal(c.dump(r), 'undefined');
  r.dispose();
  c.dispose();
});

test('QuickJS interrupts CPU exhaustion', async () => {
  const q = await getQuickJS();
  const r = q.newRuntime();
  r.setMemoryLimit(16 * 1024 * 1024);
  const deadline = Date.now() + 50;
  r.setInterruptHandler(() => Date.now() > deadline);
  const c = r.newContext();
  const v = c.evalCode('while(true){}');
  assert(v.error);
  v.error.dispose();
  c.dispose();
  r.dispose();
});
