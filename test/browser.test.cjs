// Browser acceptance tests (Playwright core + system Chrome).
// Env: BASE_URL, MOCK_URL, CHROME_PATH (optional).
// v3.2: everything runs behind login (test server has FORM3_REGISTRATION=1).
// Conversations/elements persist SERVER-SIDE; ui.db runs against the real /api/db.
const { chromium } = require('playwright-core');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4598';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:4599';
const KEY = 'test-key-1234567890';
const OWNER = 'browserowner';
const PASS = 'password123';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',
  '/root/.cache/puppeteer/chrome/linux-151.0.7922.77/chrome-linux64/chrome'
].filter(Boolean);

function findChrome() {
  for (const c of CANDIDATES) { try { if (fs.existsSync(c)) return c; } catch {} }
  for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try { const { status, stdout } = require('child_process').spawnSync('which', [bin]); if (status === 0) return stdout.trim(); } catch {}
  }
  return null;
}

const boundaryRender = {
  version: 1,
  html: '<meta http-equiv="refresh" content="0;url=https://example.com"><a href="https://example.com">link</a><img src="https://example.com"><svg><a href="https://example.com"><text>X</text></a></svg><input id="amount" type="number"><p id="result"></p><svg viewBox="0 0 100 100"><g id="dyn"></g><g id="dyn3"></g></svg><div id="dyn2"></div><button id="suggest" onclick="location="https://example.com"">Suggest</button><script>location="https://example.com"</script>',
  css: '@import "https://example.com";p{background:url(https://example.com);color:#d4ef8b}',
  js: 'state.amount=state.amount||2;ui.value("amount",String(state.amount));ui.text("result",typeof window+"/"+typeof fetch+"/"+typeof document);ui.on("amount","input",e=>{state.amount=Number(e.value);ui.text("result",String(state.amount*12));ui.persist()});ui.on("suggest","click",()=>ui.suggest("explicit only"));ui.value("result","nope");ui.html("dyn","<script>location=\'https://example.com\'</script><img src=\'https://example.com\'><rect width=\'13\' height=\'13\'/>");ui.html("dyn2","<p>ok</p>");ui.html("dyn3","<rect width=\'9\' height=\'9\'/>");',
  state: {}
};

const mockStats = async () => (await (await fetch(MOCK + '/admin/stats')).json());

async function loginUI(p, username, password) {
  await p.locator('#loginform [name=username]').fill(username);
  await p.locator('#loginform [name=password]').fill(password);
  await p.locator('#loginform button').last().click();
}
async function registerUI(p, username, password) {
  await p.locator('#switchreg').click();
  await p.locator('#regform [name=username]').fill(username);
  await p.locator('#regform [name=password]').fill(password);
  await p.locator('#regform [name=password2]').fill(password);
  await p.locator('#regform button').last().click();
}

(async () => {
  const exe = findChrome();
  if (!exe) {
    console.log('SKIP browser tests (no Chrome/Chromium found; set CHROME_PATH to run them)');
    return;
  }
  const b = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  const external = [];
  p.on('request', r => { if (r.url().startsWith('http') && !r.url().startsWith(BASE)) external.push(r.url()); });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', msg => { if (msg.type() === 'error') console.log('console-error:', msg.text()); });
  const ok = s => console.log('PASS', s);
  const shots = path.resolve(__dirname, '..', 'docs', 'screenshots');
  fs.mkdirSync(shots, { recursive: true });
  try {
    // 0. login gate: app demands a session before anything else
    await p.goto(BASE);
    await p.locator('#login[open]').waitFor({ timeout: 10000 });
    await loginUI(p, OWNER, 'completely-wrong');
    await p.locator('#loginerr').filter({ hasText: 'Ungültiger Benutzername oder Passwort' }).waitFor({ timeout: 5000 });
    ok('login gate: wrong password rejected with inline error');
    await registerUI(p, OWNER, PASS);
    await p.locator('#login[open]').waitFor({ state: 'detached', timeout: 10000 });
    ok('first registration becomes the logged-in owner session');

    // 1. empty state until a model exists
    await p.locator('#emptystate').waitFor({ timeout: 10000 });
    assert.equal(await p.locator('#send').isDisabled(), true);
    ok('empty state until model exists, composer blocked');

    // 2. add model via settings UI
    await p.locator('#settingsbtn').click();
    await p.locator('#addmodel [name=label]').fill('Mock');
    await p.locator('#addmodel [name=baseUrl]').fill(MOCK + '/v1');
    await p.locator('#addmodel [name=model]').fill('mock-model');
    await p.locator('#addmodel [name=apiKey]').fill(KEY);
    await p.locator('#addmodel button').last().click();
    await p.locator('#model').waitFor({ state: 'visible', timeout: 5000 });
    await p.locator('#emptystate').waitFor({ state: 'detached' });
    assert.equal(await p.locator('#send').isDisabled(), false);
    const listTxt = await p.locator('#modellist').innerText();
    assert.match(listTxt, /…7890/);
    assert.ok(!listTxt.includes(KEY), 'key masked in UI');
    ok('model added via settings UI, key masked, empty state gone');
    await p.keyboard.press('Escape'); // keyboard: Esc closes dialog
    await p.locator('#settings[open]').waitFor({ state: 'detached', timeout: 3000 }).catch(() => { throw Error('Escape did not close settings dialog'); });
    ok('settings dialog closes via Escape key');

    // 3. streaming: prose visibly streams before artifact completes
    await p.locator('#prompt').fill('Zeig mir einen Spar-Rechner mit Slider');
    const samples = [];
    const sampler = setInterval(async () => {
      try { const t = await p.locator('.live .prose').innerText().catch(() => null); if (t) samples.push(t.length); } catch {}
    }, 30);
    await p.locator('#prompt').press('Enter');
    await p.locator('iframe.render').first().waitFor({ timeout: 30000 });
    clearInterval(sampler);
    assert.ok(new Set(samples).size >= 2, 'prose visibly grew while streaming: ' + samples.join(','));
    ok('prose streams visibly before artifact completes');

    // 4. artifact renders + is interactive + state syncs to the SERVER, survives reload
    let f = p.frameLocator('iframe.render').first();
    await f.locator('#amt').waitFor({ timeout: 10000 });
    await f.locator('#out').filter({ hasText: 'Wert: 3' }).waitFor({ timeout: 10000 }); // element init drew from state
    await f.locator('#amt').fill('7');
    await f.locator('#out').filter({ hasText: 'Wert: 7' }).waitFor({ timeout: 5000 });
    await p.waitForTimeout(1200); // debounced /api/state (600ms) must land
    await p.reload();
    f = p.frameLocator('iframe.render').first();
    await f.locator('#amt').waitFor({ timeout: 10000 });
    await f.locator('#amt').waitForFunction(el => el.value === '7', { timeout: 10000 });
    assert.equal(await f.locator('#amt').inputValue(), '7');
    await f.locator('#out').filter({ hasText: 'Wert: 7' }).waitFor({ timeout: 5000 });
    ok('artifact interactive (slider changes value), state persists server-side across reload');

    // 5. invalid artifact -> exactly one retry -> success
    await p.locator('#prompt').fill('Test invalid artifact bitte');
    await p.locator('#prompt').press('Enter');
    const retrySeen = [];
    const retrySampler = setInterval(async () => {
      try { retrySeen.push(await p.locator('.notice').filter({ hasText: 'Korrekturversuch' }).count()); } catch {}
    }, 40);
    await p.locator('.notice').filter({ hasText: 'Korrekturversuch' }).first().waitFor({ timeout: 30000 });
    await p.locator('iframe.render').nth(1).waitFor({ timeout: 30000 });
    clearInterval(retrySampler);
    assert.equal(Math.max(...retrySeen, 0), 1, 'exactly one retry notice observed, saw: ' + retrySeen.join(','));
    const st = await mockStats();
    assert.ok(st.calls.invalid >= 1 && st.calls.corrected >= 1);
    ok('invalid artifact: one retry notice, corrected artifact renders');

    // 6. prose-only answer
    await p.locator('#prompt').fill('Erkläre mir kurz, was ein VPN macht — prose only');
    await p.locator('#prompt').press('Enter');
    await p.locator('.message.assistant').nth(2).locator('.prose').filter({ hasText: 'Virtual Private Network' }).waitFor({ timeout: 30000 });
    assert.equal(await p.locator('iframe.render').count(), 2);
    ok('prose-only answer without artifact');

    // 6b. elements: name from artifact JSON, pin -> quick access -> overlay
    assert.equal(await p.locator('.elname').first().textContent(), 'Spar-Rechner', 'element shows model-supplied name');
    const pinBtn = p.locator('.elhead button[aria-label="Element anpinnen"]').first();
    await pinBtn.scrollIntoViewIfNeeded();
    await pinBtn.click();
    const chip = p.locator('#quickbar .qchip');
    await chip.waitFor({ state: 'visible', timeout: 3000 });
    assert.match(await chip.first().textContent(), /Spar-Rechner/);
    await chip.first().click();
    await p.locator('#overlay[open]').waitFor({ timeout: 3000 });
    await p.locator('#overlay iframe.render').waitFor({ timeout: 8000 });
    assert.equal(await p.locator('#overlay .ovfoot button', { hasText: 'Mit KI bearbeiten' }).count(), 1, 'overlay offers KI refinement action');
    await p.locator('#overlay button[aria-label="Element schliessen"]').click();
    await p.locator('#overlay[open]').waitFor({ state: 'detached', timeout: 3000 });
    assert.equal(await p.locator('#overlay iframe.render').count(), 0, 'overlay iframe cleaned up on close');
    ok('element named, pin -> quick-access bar -> overlay opens/closes');

    // 6c. in-place refinement: marked element is REPLACED, no new assistant message
    await p.waitForFunction(() => !document.querySelector('.live'), undefined, { timeout: 15000 });
    const assistBefore = await p.locator('.message.assistant').count();
    const iframesBefore = await p.locator('iframe.render').count();
    let f0 = p.frameLocator('iframe.render').first();
    const colorBefore = await f0.locator('h2').evaluate(el => getComputedStyle(el).color);
    await p.locator('.elname').first().click();
    await p.locator('#refchip').waitFor({ state: 'visible', timeout: 3000 });
    assert.match(await p.locator('#refchip').innerText(), /Bearbeite: Spar-Rechner/);
    await p.locator('#prompt').fill('mache den Akzent blau');
    await p.locator('#prompt').press('Enter');
    await p.locator('#refchip').waitFor({ state: 'hidden', timeout: 30000 });
    await p.waitForFunction(() => !document.querySelector('.live'), undefined, { timeout: 30000 });
    assert.equal(await p.locator('.message.assistant').count(), assistBefore, 'assistant message count unchanged');
    assert.equal(await p.locator('iframe.render').count(), iframesBefore, 'no duplicate element');
    f0 = p.frameLocator('iframe.render').first();
    await f0.locator('h2').waitFor({ timeout: 8000 });
    const colorAfter = await f0.locator('h2').evaluate(el => getComputedStyle(el).color);
    assert.notEqual(colorAfter, colorBefore, 'element content replaced in place');
    assert.equal(colorAfter, 'rgb(127, 212, 239)');
    ok('in-place refinement replaces element (no duplicate), server archives old version');

    // 6d. overlay version history + revert (versions come from the SERVER after reload)
    await p.reload();
    await p.locator('iframe.render').first().waitFor({ timeout: 15000 });
    await p.locator('.elhead button[aria-label="Element öffnen"]').first().click();
    await p.locator('#overlay[open]').waitFor({ timeout: 3000 });
    await p.locator('#overlay button', { hasText: 'Versionen' }).click();
    await p.locator('#overlay .verow').waitFor({ timeout: 3000 });
    assert.equal(await p.locator('#overlay .verow').count(), 1, 'one archived version listed (server-side)');
    await p.locator('#overlay .verow button', { hasText: 'Wiederherstellen' }).click();
    await p.locator('#overlay iframe.render').waitFor({ timeout: 8000 });
    const of = p.frameLocator('#overlay iframe.render');
    await of.locator('h2').waitFor({ timeout: 8000 });
    assert.equal(await of.locator('h2').evaluate(el => getComputedStyle(el).color), colorBefore, 'revert restores previous version');
    await p.locator('#overlay button[aria-label="Element schliessen"]').click();
    await p.locator('#overlay[open]').waitFor({ state: 'detached', timeout: 3000 });
    ok('server-side version history keeps last versions, revert restores');

    // 6e. manual code editor: valid edit applies through the same pipeline, injection sanitized
    await p.locator('.elhead button[aria-label="Element öffnen"]').first().click();
    await p.locator('#overlay[open]').waitFor({ timeout: 3000 });
    await p.locator('#overlay button', { hasText: 'Code bearbeiten' }).click();
    await p.locator('#overlay .codeed textarea').first().waitFor({ timeout: 3000 });
    await p.locator('#overlay .codeed textarea').nth(0).fill('<h2 id="ce">Code-Edit OK</h2><p id="ce2"></p>');
    await p.locator('#overlay .codeed textarea').nth(2).fill('ui.text("ce2","manuell gesetzt");');
    await p.locator('#overlay .codeed textarea').nth(3).fill('{}');
    await p.locator('#overlay .codeed button[type=submit]').click();
    let cef = p.frameLocator('#overlay iframe.render');
    await cef.locator('#ce2').filter({ hasText: 'manuell gesetzt' }).waitFor({ timeout: 8000 });
    await p.locator('#overlay button', { hasText: 'Code bearbeiten' }).click();
    await p.locator('#overlay .codeed textarea').nth(0).fill('<script>fetch("https://example.com")</script><img src="https://example.com/x.png"><p id="bad">bleibt</p><input id="q" onpointerdown="fetch(\'https://example.com\')">');
    await p.locator('#overlay .codeed button[type=submit]').click();
    await p.locator('#overlay .toast, .toast').last().waitFor({ timeout: 5000 }).catch(() => {});
    cef = p.frameLocator('#overlay iframe.render');
    await cef.locator('#bad').waitFor({ timeout: 8000 });
    assert.equal(await cef.locator('script:not([nonce]), img').count(), 0, 'manual injection sanitized identically');
    assert.equal(await cef.locator('#q').getAttribute('onpointerdown'), null, 'inline handlers stripped');
    await p.locator('#overlay button[aria-label="Element schliessen"]').click();
    await p.locator('#overlay[open]').waitFor({ state: 'detached', timeout: 3000 });
    ok('manual code editor: valid edit applies, script/img/handler injection rejected identically');

    // 6f. ui.ping lab shell through mocked /api/ping (ok, blocked 403, rate limit 429)
    const pingCalls = {};
    await p.route('**/api/ping', async route => {
      const body = route.request().postDataJSON();
      const host = String(body.host || '');
      pingCalls[body.sessionId] = (pingCalls[body.sessionId] || 0) + 1;
      if (pingCalls[body.sessionId] > 10) return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Ping-Limit erreicht (10/Minute).' }) });
      if (host === 'private.example') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Private oder reservierte Adresse blockiert.' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ip: '93.184.216.34', ms: 23 }) });
    });
    await p.locator('#prompt').fill('baue mir ein Netz-Labor mit ping');
    await p.locator('#prompt').press('Enter');
    await p.locator('iframe.render').nth(2).waitFor({ timeout: 30000 });
    let pf = p.frameLocator('iframe.render').nth(2);
    await pf.locator('#go').click();
    await pf.locator('#pout').filter({ hasText: 'online · 23 ms · 93.184.216.34' }).waitFor({ timeout: 8000 });
    await pf.locator('#phost').fill('private.example');
    await pf.locator('#go').click();
    await pf.locator('#pout').filter({ hasText: 'offline · Private oder reservierte Adresse blockiert.' }).waitFor({ timeout: 8000 });
    await pf.locator('#phost').fill('example.com');
    for (let i = 0; i < 11; i++) await pf.locator('#go').click();
    await pf.locator('#pout').filter({ hasText: 'offline · Ping-Limit erreicht' }).waitFor({ timeout: 8000 });
    await p.unroute('**/api/ping');
    ok('ui.ping: public ok, private 403 surfaced, rate limit 429 — all rendered inside the element');

    // 6g. ui.db against the REAL /api/db: CRUD + reload persistence + scoping + quota
    await p.locator('#prompt').fill('baue mir eine Aufgaben-DB');
    await p.locator('#prompt').press('Enter');
    await p.locator('iframe.render').nth(3).waitFor({ timeout: 30000 });
    let df = p.frameLocator('iframe.render').nth(3);
    await df.locator('#msg').filter({ hasText: 'geladen: 0' }).waitFor({ timeout: 8000 });
    await df.locator('#t').fill('Milch');
    await df.locator('#add').click();
    await df.locator('#msg').filter({ hasText: 'ok id 1' }).waitFor({ timeout: 8000 });
    await df.locator('#t').fill('Brot');
    await df.locator('#add').click();
    await df.locator('#msg').filter({ hasText: 'ok id 2' }).waitFor({ timeout: 8000 });
    await df.locator('#list').filter({ hasText: 'Milch' }).waitFor({ timeout: 8000 });
    await df.locator('#done').click();
    await df.locator('#list li').first().filter({ hasText: 'Milch ✓' }).waitFor({ timeout: 8000 });
    await df.locator('#pop').click();
    await df.locator('#msg').filter({ hasText: 'gelöscht 1' }).waitFor({ timeout: 8000 });
    await df.locator('#list').filter({ hasText: 'Brot' }).waitFor({ timeout: 8000 });
    {
      const listText = await df.locator('#list').innerText();
      assert.ok(!listText.includes('Milch') && listText.includes('Brot'), 'deleted row removed from list: ' + listText);
    }
    await p.reload(); // real server-side table must survive reload
    await p.locator('iframe.render').nth(3).waitFor({ timeout: 15000 });
    df = p.frameLocator('iframe.render').nth(3);
    await df.locator('#msg').filter({ hasText: 'geladen: 1' }).waitFor({ timeout: 8000 });
    await df.locator('#list').filter({ hasText: 'Brot' }).waitFor({ timeout: 8000 });
    // scoping: a second element in the SAME conversation must not see the first element's tables
    await p.locator('#prompt').fill('scoping-test bitte');
    await p.locator('#prompt').press('Enter');
    await p.locator('iframe.render').nth(4).waitFor({ timeout: 30000 });
    const sf = p.frameLocator('iframe.render').nth(4);
    await sf.locator('#s').click();
    await sf.locator('#msg').filter({ hasText: 'isoliert: Tabelle nicht gefunden.' }).waitFor({ timeout: 8000 });
    // quota: oversized row rejected, error surfaces inside the element
    await df.locator('#big').click();
    await df.locator('#msg').filter({ hasText: 'Fehler: Zeile zu gross' }).waitFor({ timeout: 8000 });
    // drop removes the table
    await df.locator('#dropall').click();
    await df.locator('#msg').filter({ hasText: 'gedroppt' }).waitFor({ timeout: 8000 });
    ok('ui.db (real server): CRUD, reload persistence, element scoping, quota rejection');

    // 7. stop aborts upstream (wait for previous chat to finish first)
    await p.waitForFunction(() => !document.querySelector('.live'), undefined, { timeout: 15000 });
    await p.locator('#prompt').fill('slow story please');
    await p.locator('#prompt').press('Enter');
    await p.locator('.live .prose').filter({ hasText: 'Erster Gedanke' }).waitFor({ timeout: 30000 });
    const sketch = await p.evaluate(() => {
      const sk = document.querySelector('.live .sketch path');
      if (!sk) return { error: 'no sketch element' };
      const cs = getComputedStyle(sk);
      return { animation: cs.animationName, duration: cs.animationDuration, dash: cs.strokeDasharray };
    });
    assert.equal(sketch.error, undefined);
    assert.equal(sketch.animation, 'none', 'prefers-reduced-motion: animation disabled, element static');
    assert.ok(sketch.dash, 'sketch strokes defined');
    ok('sketch animation element present; reduced-motion fallback disables movement');
    const discBefore = (await mockStats()).disconnects;
    await p.locator('#stop').click();
    await p.locator('#stop').waitFor({ state: 'hidden', timeout: 5000 });
    await new Promise(r => setTimeout(r, 1500));
    const st2 = await mockStats();
    assert.ok(st2.disconnects > discBefore, `stop disconnected upstream (${discBefore} -> ${st2.disconnects})`);
    assert.equal(await p.locator('#send').isVisible(), true);
    ok('stop button aborts upstream, error turn synced from server');

    // 7b. moving sketch animation in normal-motion context
    const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE);
    await loginUI(p2, OWNER, PASS);
    await p2.locator('#model').waitFor({ state: 'visible', timeout: 5000 });
    await p2.locator('#prompt').fill('slow story animation');
    await p2.locator('#prompt').press('Enter');
    await p2.locator('.live .prose').filter({ hasText: 'Erster Gedanke' }).waitFor({ timeout: 30000 });
    const anim = await p2.evaluate(() => {
      const sk = document.querySelector('.live .sketch path');
      const cs = sk ? getComputedStyle(sk) : null;
      return cs ? { animation: cs.animationName, duration: cs.animationDuration } : { error: 'missing' };
    });
    await p2.locator('#stop').click();
    await ctx2.close();
    assert.equal(anim.error, undefined);
    assert.equal(anim.animation, 'draw', 'self-drawing stroke-dashoffset animation runs');
    assert.ok(parseFloat(anim.duration) > 0);
    ok('moving sketch-style generation animation (stroke-dashoffset) in normal mode');

    // 8. export never contains keys; localStorage cache holds schema v4
    const dl = p.waitForEvent('download');
    await p.locator('#export').click();
    const d = await dl;
    const data = fs.readFileSync(await d.path(), 'utf8');
    assert.ok(!data.includes(KEY), 'export must not contain API key');
    assert.equal(JSON.parse(data).version, 4);
    const ls = await p.evaluate(() => JSON.stringify(localStorage));
    assert.ok(!ls.includes(KEY), 'key never in localStorage');
    ok('export + localStorage cache contain sessions (schema v4), never keys');

    // 9. boundary / sanitizing / egress / sandbox regression — seeded SERVER-side via import
    const impStatus = await p.evaluate(async render => {
      const b = await (await fetch('/api/bootstrap')).json();
      const r = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Form-CSRF': b.csrf },
        body: JSON.stringify({ sessions: [{ title: 'Boundary', messages: [{ role: 'assistant', prose: 'Boundary check.', render }] }] })
      });
      return r.status;
    }, boundaryRender);
    assert.equal(impStatus, 200, 'boundary element imported server-side');
    await p.reload();
    await p.locator('#sessions button').filter({ hasText: 'Boundary' }).first().click();
    await p.locator('.elname').first().waitFor({ timeout: 10000 });
    assert.match(await p.locator('.elname').first().textContent(), /Boundary check/, 'imported element rendered');
    let bf = p.frameLocator('iframe.render').first();
    await bf.locator('#result').filter({ hasText: 'undefined/undefined/undefined' }).waitFor({ timeout: 10000 });
    await bf.locator('#amount').fill('7');
    await bf.locator('#result').filter({ hasText: '84' }).waitFor({ timeout: 5000 });
    await bf.locator('#suggest').click();
    assert.equal(await p.locator('#prompt').inputValue(), 'explicit only');
    assert.equal(await bf.locator('#dyn script,#dyn img').count(), 0);
    assert.equal(await bf.locator('#dyn3 rect').count(), 1);
    assert.equal(await bf.locator('#dyn2 p').count(), 1);
    await p.locator('.notice.error').filter({ hasText: 'ui.value' }).first().waitFor({ timeout: 5000 });
    assert.equal(await bf.locator('a,img,meta[http-equiv=refresh],script:not([nonce])').count(), 0);
    const frame = await (await p.locator('iframe.render').first().elementHandle()).contentFrame();
    assert.equal(await frame.evaluate(() => { try { return parent.document.body ? 'accessible' : 'no'; } catch { return 'blocked'; } }), 'blocked');
    assert.equal(await frame.evaluate(async () => { try { await fetch('https://example.com'); return 'allowed'; } catch { return 'blocked'; } }), 'blocked');
    assert.equal(await p.locator('iframe.render').first().getAttribute('sandbox'), 'allow-scripts');
    const height = await p.locator('iframe.render').first().evaluate(e => e.style.height);
    await p.evaluate(() => window.postMessage({ channel: 'fake', type: 'resize', height: 999999 }, '*'));
    assert.equal(await p.locator('iframe.render').first().evaluate(e => e.style.height), height);
    ok('forged resize ignored, opaque sandbox, no parent DOM / network');
    // pin the imported element so the mobile screenshot shows the quick-access bar
    const pinBtn2 = p.locator('.elhead button[aria-label="Element anpinnen"]').first();
    await pinBtn2.scrollIntoViewIfNeeded();
    await pinBtn2.click();
    await p.locator('#quickbar .qchip').first().waitFor({ state: 'visible', timeout: 3000 });
    const statuses = await p.evaluate(async () => [
      await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.status),
      await fetch('/form.models.json').then(r => r.status),
      await fetch('/api/models').then(r => r.text())
    ]);
    assert.equal(statuses[0], 403, 'chat without CSRF token rejected');
    assert.equal(statuses[1], 404);
    assert.ok(!statuses[2].includes(KEY), 'models API masked');
    assert.deepEqual(external, [], 'no external egress requests: ' + JSON.stringify(external));
    ok('sanitizing/egress/CSRF/secret-path regression ported from v2 boundary test');

    // 10. FRESH browser context (device switch): login -> all conversations + elements intact
    const ctxFresh = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const pFresh = await ctxFresh.newPage();
    await pFresh.goto(BASE);
    await pFresh.locator('#login[open]').waitFor({ timeout: 10000 });
    await loginUI(pFresh, OWNER, PASS);
    await pFresh.locator('#sessions button').first().waitFor({ timeout: 10000 });
    const freshTitles = await pFresh.locator('#sessions button').allInnerTexts();
    assert.ok(freshTitles.some(t => t.includes('Spar')), 'first conversation present on fresh device: ' + freshTitles.join('|'));
    assert.ok(freshTitles.some(t => t.includes('Boundary')), 'imported conversation present on fresh device');
    await pFresh.locator('#sessions button').filter({ hasText: 'Boundary' }).first().click();
    await pFresh.locator('iframe.render').first().waitFor({ timeout: 15000 });
    const ff = pFresh.frameLocator('iframe.render').first();
    await ff.locator('#amount').waitForFunction(el => el.value === '7', { timeout: 10000 });
    ok('fresh device: login restores every conversation incl. persisted element state');

    // 11. user B: separate account, sees NOTHING of the owner, gets import offer for local data
    const ctxB = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const pB = await ctxB.newPage();
    const legacyArchive = { version: 4, current: null, sessions: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Alt lokal', messages: [{ role: 'user', id: '21111111-1111-4111-8111-111111111111', text: 'alter Chat' }] }], elements: { pins: [], versions: {} } };
    await pB.goto(BASE);
    await pB.evaluate(arch => localStorage.setItem('form.v3', JSON.stringify(arch)), legacyArchive);
    await pB.reload();
    await pB.locator('#login[open]').waitFor({ timeout: 10000 });
    await registerUI(pB, 'bobmobile', 'password456');
    await pB.locator('#importbar').waitFor({ state: 'visible', timeout: 8000 });
    await pB.locator('#importgo').click();
    await pB.locator('#sessions button').filter({ hasText: 'Alt lokal' }).waitFor({ timeout: 8000 });
    const bobsTitles = await pB.locator('#sessions button').allInnerTexts();
    assert.ok(bobsTitles.every(t => !t.includes('Spar') && !t.includes('Boundary')), 'user B sees only his own data: ' + bobsTitles.join('|'));
    ok('user B isolated; first-login import offer migrates local conversations server-side');
    await ctxB.close();

    // 12. logout + login again: data intact
    await p.locator('#logout').click();
    await p.locator('#login[open]').waitFor({ timeout: 10000 });
    await loginUI(p, OWNER, PASS);
    await p.locator('#sessions button').first().waitFor({ timeout: 10000 });
    assert.ok((await p.locator('#sessions button').allInnerTexts()).some(t => t.includes('Spar')), 'owner conversations intact after logout/login');
    await p.locator('#sessions button').filter({ hasText: 'Boundary' }).first().click();
    await p.locator('iframe.render').first().waitFor({ timeout: 15000 });
    ok('logout clears the session; re-login restores everything');

    // 13. mobile 390px + screenshots
    await p.setViewportSize({ width: 390, height: 844 });
    await p.reload();
    await p.locator('iframe.render').first().waitFor({ timeout: 10000 });
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at 390px');
    await p.screenshot({ path: path.join(shots, 'mobile.png'), fullPage: true });
    await p.setViewportSize({ width: 1440, height: 1000 });
    await p.reload();
    await p.locator('iframe.render').first().waitFor({ timeout: 10000 });
    await p.screenshot({ path: path.join(shots, 'desktop.png'), fullPage: true });
    ok('390px mobile clean, desktop + mobile screenshots saved');

    assert.deepEqual(errors, [], 'no uncaught page errors: ' + errors.join('; '));
    ok('no uncaught JS errors');
    console.log('BROWSER TESTS PASSED');
  } finally {
    await b.close();
  }
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
