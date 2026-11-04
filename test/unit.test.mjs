import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRender, parseArtifact, systemPrompt, sanitizeName, deriveName, refineInstruction } from '../contract.mjs';
import { createStreamParser } from '../stream.mjs';
import { validateModelInput, maskKey, loadModels, saveModels } from '../models.mjs';
import { validHost, ipBlocked, runPing } from '../ping.mjs';
import { ElementDB, QUOTAS } from '../db.mjs';
import { Store, hashPassword, verifyPassword, validateArchive, loadConfig } from '../store.mjs';
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

test('element db: lifecycle, where semantics, scoping, persistence, quotas', () => {
  const dir = path.join(os.tmpdir(), 'form3-db-unit-' + Date.now());
  const file = path.join(dir, 'elements.sqlite');
  const S = '11111111-1111-4111-8111-111111111111';
  const A = '22222222-2222-4222-8222-222222222222';
  const B = '33333333-3333-4333-8333-333333333333';
  let db = new ElementDB(file);
  const op = (elementId, o) => db.op({ sessionId: S, elementId, ...o });
  // lifecycle
  assert.equal(op(A, { op: 'create', table: 'todos' }).status, 200);
  assert.match(JSON.stringify(op(A, { op: 'create', table: 'todos' })), /existiert bereits/);
  assert.equal(op(A, { op: 'insert', table: 'todos', row: { t: 'a', done: false } }).result.id, 1);
  assert.equal(op(A, { op: 'insert', table: 'todos', row: { t: 'b', done: true, tags: ['x', 'y'] } }).result.id, 2);
  assert.equal(op(A, { op: 'insert', table: 'todos', row: { t: 'c', done: false } }).result.id, 3);
  // where: exact value, array (IN), limit
  const sel = op(A, { op: 'select', table: 'todos', query: { where: { done: false }, limit: 10 } });
  assert.deepEqual(sel.result.rows.map(r => r.t), ['a', 'c']);
  const inSel = op(A, { op: 'select', table: 'todos', query: { where: { t: ['a', 'c'] } } });
  assert.equal(inSel.result.rows.length, 2);
  assert.equal(op(A, { op: 'select', table: 'todos', query: { limit: 1 } }).result.rows.length, 1);
  // update merges, unknown row 404
  assert.equal(op(A, { op: 'update', table: 'todos', id: 1, patch: { done: true } }).status, 200);
  assert.equal(op(A, { op: 'select', table: 'todos', query: { where: { done: false } } }).result.rows.length, 1);
  assert.equal(op(A, { op: 'update', table: 'todos', id: 99, patch: {} }).status, 404);
  // delete frees quota, drop removes table
  assert.equal(op(A, { op: 'delete', table: 'todos', id: 3 }).status, 200);
  assert.equal(op(A, { op: 'delete', table: 'todos', id: 3 }).status, 404);
  assert.equal(op(A, { op: 'create', table: 'tmp1' }).status, 200);
  assert.equal(op(A, { op: 'drop', table: 'tmp1' }).status, 200);
  assert.equal(op(A, { op: 'drop', table: 'tmp1' }).status, 404);
  // scoping: element B (same session) sees nothing of A
  assert.equal(op(B, { op: 'select', table: 'todos' }).status, 404);
  assert.equal(op(B, { op: 'create', table: 'todos' }).status, 200);
  assert.equal(op(B, { op: 'insert', table: 'todos', row: { t: 'B-only' } }).result.id, 1); // own AUTOINCREMENT starts at 1
  assert.equal(op(B, { op: 'select', table: 'todos' }).result.rows[0].t, 'B-only');
  assert.equal(op(A, { op: 'select', table: 'todos' }).result.rows.length, 2);
  // invalid inputs
  assert.equal(op(A, { op: 'create', table: 'no way' }).status, 400);
  assert.equal(op(A, { op: 'insert', table: 'todos', row: 'nope' }).status, 400);
  assert.equal(op(A, { op: 'insert', table: 'todos', row: { x: 'x'.repeat(QUOTAS.bytesRow + 1) } }).status, 413);
  assert.equal(op(A, { op: 'select', table: 'todos', query: { limit: 9999 } }).status, 400);
  assert.equal(db.op({ sessionId: 'xx', elementId: A, op: 'select', table: 'todos' }).status, 400);
  // persistence across reopen
  db.close();
  db = new ElementDB(file);
  assert.deepEqual(op(A, { op: 'select', table: 'todos' }).result.rows.map(r => r.t), ['a', 'b']);
  db.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('element db: hard quotas — 10 tables, 5000 rows, 2 MB element', () => {
  const dir = path.join(os.tmpdir(), 'form3-db-quota-' + Date.now());
  const db = new ElementDB(path.join(dir, 'elements.sqlite'));
  const S = '44444444-4444-4444-8444-444444444444', E = '55555555-5555-4555-8555-555555555555';
  const op = o => db.op({ sessionId: S, elementId: E, ...o });
  // table quota
  for (let i = 0; i < 10; i++) assert.equal(op({ op: 'create', table: 't' + i }).status, 200);
  assert.equal(op({ op: 'create', table: 'one_more' }).status, 413);
  assert.equal(op({ op: 'drop', table: 't9' }).status, 200);
  assert.equal(op({ op: 'create', table: 'one_more' }).status, 200);
  // row-count quota (fill to 5000)
  for (let i = 0; i < QUOTAS.rows; i++) {
    const r = op({ op: 'insert', table: 't0', row: { i } });
    if (r.status !== 200) { assert.fail('insert ' + i + ' failed early: ' + JSON.stringify(r)); }
  }
  assert.equal(op({ op: 'insert', table: 't0', row: { i: -1 } }).status, 413);
  assert.equal(op({ op: 'delete', table: 't0', id: 1 }).status, 200);
  assert.equal(op({ op: 'insert', table: 't0', row: { i: -1 } }).status, 200);
  // byte quota: 2MB element — fill t1 with ~1KB rows until refusal
  let inserted = 0;
  const kbRow = { pad: 'x'.repeat(1024) };
  while (true) {
    const r = op({ op: 'insert', table: 't1', row: kbRow });
    if (r.status === 413) break;
    assert.equal(r.status, 200);
    inserted++;
    if (inserted > 4000) assert.fail('byte quota never hit');
  }
  assert.ok(inserted > 1000, 'reasonable fill before quota: ' + inserted);
  // t0 (5000 rows of ~10B) still fits; a fresh table in ANOTHER element works fine
  const S2 = '66666666-6666-4666-8666-666666666666', E2 = '77777777-7777-4777-8777-777777777777';
  assert.equal(db.op({ sessionId: S2, elementId: E2, op: 'create', table: 'fresh' }).status, 200);
  db.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
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

test('store: passwords scrypt-hashed, salted, timing-safe verify', () => {
  const h1 = hashPassword('correct horse battery');
  const h2 = hashPassword('correct horse battery');
  assert.notEqual(h1, h2, 'unique salt per hash');
  assert.match(h1, /^scrypt\$/);
  assert.equal(verifyPassword('correct horse battery', h1), true);
  assert.equal(verifyPassword('wrong password', h1), false);
  assert.equal(verifyPassword('correct horse battery', 'garbage'), false);
  assert.equal(verifyPassword('correct horse battery', ''), false);
});

test('store: first user is owner, second is user; sessions bound to users', () => {
  const dir = path.join(os.tmpdir(), 'form3-store-unit-' + Date.now());
  const s = new Store(dir);
  const a = s.createUser('alice', 'password123');
  const b = s.createUser('bob', 'password456');
  assert.equal(a.role, 'owner', 'first registered user becomes owner');
  assert.equal(b.role, 'user');
  assert.throws(() => s.createUser('alice', 'otherpass987'), /vergeben/);
  assert.throws(() => s.createUser('x', 'password123'), /Benutzername/);
  assert.equal(s.verifyLogin('alice', 'password123').id, a.id);
  assert.equal(s.verifyLogin('alice', 'wrong'), null);
  assert.equal(s.verifyLogin('nobody', 'whatever'), null);
  // sessions: token only usable via hash lookup, csrf rotates per session
  const s1 = s.createSession(a.id), s2 = s.createSession(a.id);
  assert.notEqual(s1.token, s2.token);
  assert.notEqual(s1.csrf, s2.csrf);
  assert.equal(s.getSession(s1.token).user.username, 'alice');
  assert.equal(s.getSession('forged-' + s1.token), null);
  s.deleteSession(s1.token);
  assert.equal(s.getSession(s1.token), null);
  // password reset kills sessions
  const s3 = s.createSession(b.id);
  s.resetPassword('bob', 'newpassword9');
  assert.equal(s.getSession(s3.token), null, 'reset invalidates sessions');
  assert.equal(s.verifyLogin('bob', 'newpassword9').id, b.id);
  s.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('store: conversations, messages, elements are user-scoped', () => {
  const dir = path.join(os.tmpdir(), 'form3-store-scope-' + Date.now());
  const s = new Store(dir);
  const alice = s.createUser('alice', 'password123');
  const bob = s.createUser('bob', 'password456');
  const cA = s.createConversation(alice.id, 'A');
  const u1 = s.appendMessage(cA.id, 'user', { text: 'Frage eins' });
  const e1 = s.appendMessage(cA.id, 'assistant', { prose: 'antwort', render: { version: 1, html: '<p>x</p>', css: '', js: '', state: {} } });
  // history window: server-side reconstruction
  s.appendMessage(cA.id, 'user', { text: 'Frage zwei mit slider bitte' });
  const hist = s.getHistory(cA.id);
  assert.deepEqual(hist.map(m => m.role), ['user', 'assistant', 'user']);
  assert.ok(hist[1].content.includes('interaktives Artefakt'));
  assert.deepEqual(s.getStates(cA.id), [{ id: e1, state: {} }]);
  // ownership: bob never sees alice's conversation or elements
  assert.equal(s.conversationOwner(cA.id), alice.id);
  assert.equal(s.messageOwner(e1).userId, alice.id);
  assert.equal(s.messageOwner(e1).conversationId, cA.id);
  assert.equal(s.messageOwner(e1).hasRender, true);
  assert.equal(s.listConversations(bob.id).conversations.length, 0);
  assert.equal(s.listConversations(alice.id).conversations.length, 1);
  // state update is ownership-checked
  s.updateMessageRender(alice.id, e1, { version: 1, html: '<p>y</p>', css: '', js: '', state: { value: 7 } });
  assert.throws(() => s.updateMessageRender(bob.id, e1, { version: 1, html: '<p>z</p>', css: '', js: '', state: {} }));
  assert.equal(s.getRender(e1).state.value, 7);
  // refine archives old render and replaces
  s.replaceRender(cA.id, e1, { version: 1, html: '<p>new</p>', css: '', js: '', state: {} }, 'neue prose');
  const snap = s.listConversations(alice.id);
  assert.equal(snap.versions[e1].length, 1);
  assert.equal(snap.conversations[0].messages.find(m => m.id === e1).render.html, '<p>new</p>');
  // pins enforced per user
  s.setPinned(alice.id, e1, true);
  assert.throws(() => s.setPinned(bob.id, e1, true));
  assert.equal(s.listConversations(alice.id).conversations[0].messages.find(m => m.id === e1).pinned, true);
  // delete purges
  let purged = [];
  s.deleteConversation(alice.id, cA.id, ids => purged = ids);
  assert.deepEqual(purged, [e1]);
  assert.equal(s.listConversations(alice.id).conversations.length, 0);
  s.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('store: import validation rejects malformed archives, regenerates ids', () => {
  const dir = path.join(os.tmpdir(), 'form3-store-imp-' + Date.now());
  const s = new Store(dir);
  const u = s.createUser('alice', 'password123');
  const render = { version: 1, html: '<p>ok</p>', css: '', js: '', state: {} };
  const created = s.importSessions(u.id, { sessions: [{ title: 'Alt', messages: [
    { id: 'm1', role: 'user', text: 'hallo' },
    { id: 'm2', role: 'assistant', prose: 'hi', render }
  ] }], elements: { pins: ['m2'], versions: { m2: [{ at: '2026-01-01', render }] } } });
  assert.equal(created.length, 1);
  const snap = s.listConversations(u.id);
  assert.equal(snap.conversations[0].messages.length, 2);
  const newElementId = snap.conversations[0].messages[1].id;
  assert.notEqual(newElementId, 'm2', 'ids regenerated');
  assert.equal(snap.conversations[0].messages[1].pinned, true, 'pins remapped');
  assert.equal(snap.versions[newElementId].length, 1, 'versions remapped');
  for (const bad of [null, { sessions: [] }, { sessions: [{ title: 'x', messages: [{ role: 'npc', text: 'yo' }] }] },
                     { sessions: [{ title: 'x', messages: [{ role: 'assistant' }] }] },
                     { sessions: [{ title: 'x', messages: [{ role: 'user', text: 42 }] }] }])
    assert.throws(() => s.importSessions(u.id, bad), /Ungültig/);
  s.close();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('config: defaults to registration off, env forces on, ENOENT safe', () => {
  const dir = path.join(os.tmpdir(), 'form3-cfg-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  const missing = path.join(dir, 'missing.json');
  let cfg = loadConfig(missing); // ENOENT must not throw
  assert.equal(cfg.registration, false);
  fs.writeFileSync(path.join(dir, 'on.json'), '{"registration":true}');
  assert.equal(loadConfig(path.join(dir, 'on.json')).registration, true);
  fs.writeFileSync(path.join(dir, 'bad.json'), 'not json');
  assert.equal(loadConfig(path.join(dir, 'bad.json')).registration, false, 'unreadable config falls back');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

test('system prompt documents ui.db for data-driven elements', () => {
  assert.ok(systemPrompt.includes('ui.db.create'));
  assert.ok(systemPrompt.includes('ui.db.select'));
  assert.ok(systemPrompt.includes('DATA-DRIVEN'));
  assert.ok(systemPrompt.includes('10 tables per element'));
  assert.ok(systemPrompt.includes('survives page reloads'));
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

test('generated interaction validation catches DOM event and value getter mistakes without hiding stored elements',()=>{
 const base={version:1,html:'<input id="q"><button id="go">Go</button>',css:'',js:'',state:{}};
 for(const js of ["ui.on('go','click',e=>e.preventDefault())","ui.value('q').trim()","ui.on('f','submit',()=>{})"]){assert.throws(()=>parseArtifact(JSON.stringify({...base,js})));assert.doesNotThrow(()=>validateRender({...base,js}),'existing stored renders remain readable');}
 const repaired=JSON.parse(fs.readFileSync(new URL('./fixtures/place-search-repaired-api.json',import.meta.url),'utf8'));assert.equal(parseArtifact(JSON.stringify(repaired)).actions[0].name,'Ortssuche');
});
