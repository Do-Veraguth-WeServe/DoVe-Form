import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRender, parseArtifact, systemPrompt } from '../contract.mjs';
import { createStreamParser } from '../stream.mjs';
import { validateModelInput, maskKey, loadModels, saveModels } from '../models.mjs';
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
