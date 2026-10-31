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
  const ok = s => console.log('PASS', s);
  const release = async group => (await (await fetch(MOCK + '/admin/release', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group }) })).json());
  // wait until no chat turn is streaming/pending on a page
  const idle = pg => pg.waitForFunction(() =>
    !document.querySelector('.live') && document.querySelector('#stop').classList.contains('hidden'),
    undefined, { timeout: 30000 });
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
    await p.waitForTimeout(500); // let the fresh sandbox finish its worker handshake
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

    // 7. stop CANCELS the server job: the provider connection is genuinely held
    // open by the mock; only the explicit stop may abort it.
    await p.waitForFunction(() => !document.querySelector('.live') && document.querySelector('#stop').classList.contains('hidden'), undefined, { timeout: 15000 });
    await p.locator('#prompt').fill('halten und stoppen holdprose bitte');
    await p.locator('#prompt').press('Enter');
    await p.locator('.live .think').waitFor({ timeout: 10000 }); // provider holds: honest thinking phase
    const thinkAnim = await p.evaluate(() => {
      const el = document.querySelector('.live .think .wire line') || document.querySelector('.live .think');
      return el ? getComputedStyle(el).animationName : 'none';
    });
    assert.equal(thinkAnim, 'none', 'prefers-reduced-motion: no movement while thinking');
    const discBefore = (await mockStats()).disconnects;
    await p.locator('#stop').click();
    await p.locator('#stop').waitFor({ state: 'hidden', timeout: 5000 });
    await new Promise(r => setTimeout(r, 1500));
    const st2 = await mockStats();
    assert.ok(st2.disconnects > discBefore, `stop aborted the held upstream (${discBefore} -> ${st2.disconnects})`);
    assert.equal((st2.active.holdprose || 0), 0, 'no held stream left after stop');
    assert.equal(await p.locator('#send').isVisible(), true);
    ok('stop cancels the server job and aborts the provider (reduced-motion static thinking)');

    // 7b. background build: phases, construction-site animation, honest states, cancel
    const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await ctx2.newPage();
    p2.on('response', r => { if (r.status() >= 400) console.log('p2 http', r.status(), r.url().slice(0, 60)); });
    await p2.goto(BASE);
    await loginUI(p2, OWNER, PASS);
    await p2.locator('#model').waitFor({ state: 'visible', timeout: 5000 });
    await p2.waitForTimeout(500);
    // (a) provider holds with NOTHING sent: the thinking phase is honest and long
    await p2.locator('#prompt').fill('holda nachdenken bitte');
    await p2.locator('#prompt').press('Enter');
    await p2.locator('.live .think').waitFor({ timeout: 8000 });
    assert.equal(await p2.locator('.live .think svg,.live .think .wire').count(),0,'no abstract line animation');

    await release('holda');
    await p2.locator('.live .prose').filter({ hasText: 'Hintergrund' }).waitFor({ timeout: 20000 });
    await p2.waitForFunction(() => !document.querySelector('.live') && document.querySelector('#stop').classList.contains('hidden'), undefined, { timeout: 20000 });
    // (b) provider holds INSIDE the artifact phase: the construction site is live
    await p2.locator('#prompt').fill('baue eine baustelle sitehold');
    await p2.locator('#prompt').press('Enter');
    await p2.locator('.site[data-jobid]').first().waitFor({ timeout: 15000 });
    let stHold = await mockStats();
    assert.ok((stHold.active.sitehold || 0) >= 1, 'upstream provider still OPEN while the site is shown');
    const anim = await p2.evaluate(() => {
      const load = document.querySelector('.site .load');
      const cs = load ? getComputedStyle(load) : null;
      const phase = document.querySelector('.site .sitephase');
      return cs ? { animation: cs.animationName, duration: cs.animationDuration, phase: phase ? phase.textContent : '' } : { error: 'missing' };
    });
    assert.equal(anim.error, undefined);
    assert.equal(anim.animation, 'lower', 'crane lowers its load — honest activity, no fake progress');
    assert.ok(parseFloat(anim.duration) > 0);
    assert.match(anim.phase, /baut|Warteschlange|prüft/, 'phase text without percentages: ' + anim.phase);
    assert.equal(await p2.locator('.site .sitemeta button', { hasText: 'Abbrechen' }).count(), 1, 'cancel offered per container');
    await p2.screenshot({ path: path.join(shots, 'site-desktop.png'), fullPage: true });
    const disc7b = (await mockStats()).disconnects;
    await p2.locator('.site .sitemeta button', { hasText: 'Abbrechen' }).first().click();
    // cancelled: the message ends with an honest "Abgebrochen." notice (no site left)
    await p2.locator('.notice').filter({ hasText: 'Abgebrochen.' }).first().waitFor({ timeout: 8000 });
    await new Promise(r => setTimeout(r, 800));
    stHold = await mockStats();
    assert.ok(stHold.disconnects > disc7b, 'cancel aborted the held upstream');
    await ctx2.close();
    ok('plain thinking status, recognizable construction site, cancel works');

    // 7c. genuine server-owned background job: chat answers BEFORE the element
    // completes; reload keeps the same job; tab close does not stop the build
    const slowBefore = (await mockStats()).calls.sitehold || 0;
    const siteholdaBefore = (await mockStats()).calls.siteholda || 0;
    await idle(p);
    await p.locator('#prompt').fill('baue noch ein element sitehold');
    await p.locator('#prompt').press('Enter');
    await p.locator('.site[data-jobid]').last().waitFor({ timeout: 15000 });
    const jobId1 = await p.locator('.site[data-jobid]').last().getAttribute('data-jobid');
    const jobSel = '.site[data-jobid="' + jobId1 + '"]';
    await p.evaluate(id => { window.__lastJobSel = id; }, jobId1);
    // second chat message must be answered while the FIRST provider call is
    // still held OPEN (detached generation, no per-user chat lock)
    await p.locator('#prompt').fill('Erkläre mir kurz, was ein VPN macht — prose only');
    await p.locator('#prompt').press('Enter');
    await p.locator('.message.assistant').last().locator('.prose').filter({ hasText: 'Virtual Private Network' }).waitFor({ timeout: 30000 });
    let stHold2 = await mockStats();
    assert.ok((stHold2.active.sitehold || 0) >= 1, 'first upstream STILL streaming while the second answer completed');
    assert.equal(await p.locator(jobSel).count(), 1, 'construction site still building while chat answered');
    // reload mid-stream (same context): same job id, current state, no duplicate build
    await p.reload();
    await p.locator(jobSel).first().waitFor({ timeout: 15000 });
    assert.equal(await p.locator(jobSel).first().getAttribute('data-jobid'), jobId1, 'reload shows the SAME job');
    stHold2 = await mockStats();
    assert.ok((stHold2.active.sitehold || 0) >= 1, 'reload did not abort the upstream');
    // dedicated context: close its ONLY tab — the server keeps building; reopen
    // shows exactly one finished element (job belongs to the server, not the tab)
    const ctx3 = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const pTab = await ctx3.newPage();
    pTab.on('response', r => { if (r.status() >= 400) console.log('pTab http', r.status(), r.url().slice(0, 60)); });
    await pTab.goto(BASE);
    await loginUI(pTab, OWNER, PASS);
    await pTab.locator('.message[data-mid]').first().waitFor({ timeout: 10000 }); // conversation actually loaded
    await pTab.waitForTimeout(400); // jobs snapshot applied
    await idle(pTab);
    const priorIds = await pTab.evaluate(() => [...document.querySelectorAll('.site[data-jobid]')].map(s => s.dataset.jobid));
    await pTab.locator('#prompt').fill('baustelle im geschlossenen tab siteholda');
    await pTab.locator('#prompt').press('Enter');
    // wait for a NEW site (this conversation already shows older jobs)
    await pTab.waitForFunction(oldIds => {
      const sites = [...document.querySelectorAll('.site[data-jobid]')];
      return sites.some(s => !oldIds.includes(s.dataset.jobid) && !s.className.includes('cancelled'));
    }, [...priorIds], { timeout: 15000 });
    const closedJob = await pTab.evaluate(oldIds => {
      const sites = [...document.querySelectorAll('.site[data-jobid]')];
      const el = sites.find(s => !oldIds.includes(s.dataset.jobid) && !s.className.includes('cancelled'));
      return el ? el.dataset.jobid : null;
    }, [...priorIds]);
    assert.ok(closedJob, 'a NEW non-cancelled construction site appeared');

    const closedSel = '.site[data-jobid="' + closedJob + '"]';
    await pTab.close();
    await new Promise(r => setTimeout(r, 1000));
    let stTab = await mockStats();
    assert.ok((stTab.active.siteholda || 0) >= 1, 'upstream STILL streaming after the tab closed');
    const discTab = stTab.disconnects;
    await release('siteholda'); // server completes with NO browser attached
    const p3 = await ctx3.newPage();
    await p3.goto(BASE);
    await p3.locator('.message[data-mid]').first().waitFor({ timeout: 15000 });
    assert.equal(await p3.locator(closedSel).count(), 0, 'no construction site left after completion');
    const closedName = await p3.evaluate(() => [...document.querySelectorAll('.elname')].map(e => e.textContent));
    assert.equal(closedName.filter(n => n === 'Baustellen-Element').length >= 1, true, 'finished element present after tab close');
    const iframesAfterReopen = await p3.locator('iframe.render').count();
    stTab = await mockStats();
    assert.equal(stTab.disconnects, discTab, 'provider saw no disconnect from the tab close');
    assert.equal(stTab.calls.siteholda, siteholdaBefore + 1, 'exactly ONE provider call for reload+tab-close+reopen');
    ok('background job survives reload + tab close; reopen shows exactly one element, one provider call');
    // release p's STILL-HELD first job so the per-user concurrency slot frees
    // for 7d (two concurrent generations must both be able to run)
    await release('sitehold');
    await p.waitForFunction(() => !document.querySelector('.site[data-jobid="' + window.__lastJobSel + '"]'), undefined, { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 300));

    // 7d. two jobs complete in REVERSE order and land on their own containers
    // (older cancelled sites stay visible forever — track only ACTIVE builds)
    const activeSites = () => p3.evaluate(() => [...document.querySelectorAll('.site[data-jobid]')]
      .filter(s => !s.className.includes('cancelled') && !s.className.includes('failed'))
      .map(s => s.dataset.jobid));
    const order = [];
    const watch = setInterval(async () => {
      try { order.push(await activeSites()); } catch {}
    }, 200);
    await idle(p3);
    const preActive = await activeSites();
    await p3.locator('#prompt').fill('erstes element siteholda los');
    await p3.locator('#prompt').press('Enter');
    await p3.waitForFunction(oldIds => {
      const sites = [...document.querySelectorAll('.site[data-jobid]')].filter(s => !s.className.includes('cancelled') && !s.className.includes('failed'));
      return sites.some(s => !oldIds.includes(s.dataset.jobid));
    }, preActive, { timeout: 15000 });
    const jA = await p3.evaluate(oldIds => {
      const sites = [...document.querySelectorAll('.site[data-jobid]')].filter(s => !s.className.includes('cancelled') && !s.className.includes('failed'));
      return sites.find(s => !oldIds.includes(s.dataset.jobid)).dataset.jobid;
    }, preActive);
    // second submit WHILE the first provider is still held open (concurrent turns)
    console.log('7D-PRE:', JSON.stringify({ active: (await mockStats()).active, promptBusy: await p3.locator('#prompt').inputValue().then(() => 'ok').catch(e => e.message) }));
    p3.on('response', r => { if (r.status() >= 400) console.log('p3 http', r.status(), r.url().slice(0, 60)); });
    await p3.locator('#prompt').fill('zweites element siteholdb los');
    await p3.locator('#prompt').press('Enter');
    await p3.waitForFunction(oldIds => {
      const sites = [...document.querySelectorAll('.site[data-jobid]')].filter(s => !s.className.includes('cancelled') && !s.className.includes('failed'));
      return sites.filter(s => !oldIds.includes(s.dataset.jobid)).length === 1;
    }, [...preActive, jA], { timeout: 15000 });
    const jB = await p3.evaluate(oldIds => [...document.querySelectorAll('.site[data-jobid]')]
      .find(s => !oldIds.includes(s.dataset.jobid) && !s.className.includes('cancelled') && !s.className.includes('failed')).dataset.jobid, [...preActive, jA]);
    assert.notEqual(jA, jB, 'each request has its own job');
    let stD = await mockStats();
    assert.ok((stD.active.siteholda || 0) >= 1 && (stD.active.siteholdb || 0) >= 1, 'both upstreams held open concurrently');
    await release('siteholdb'); // second finishes FIRST
    await p3.waitForFunction(jid => !document.querySelector('.site[data-jobid="' + jid + '"]'), jB, { timeout: 15000 });
    stD = await mockStats();
    assert.ok((stD.active.siteholda || 0) >= 1, 'first upstream still open after the second completed');
    await release('siteholda');
    await p3.waitForFunction(() => ![...document.querySelectorAll('.site[data-jobid]')]
      .some(s => !s.className.includes('cancelled') && !s.className.includes('failed')), undefined, { timeout: 20000 });
    clearInterval(watch);
    const seen = order;
    // jA must disappear LAST: at some point jA is the only active site left
    assert.ok(seen.some(list => list.length === 1 && list[0] === jA), 'first job outlived the second (reverse completion): ' + JSON.stringify(seen.slice(-8)));
    const names = await p3.evaluate(() => [...document.querySelectorAll('.elname')].map(e => e.textContent));
    assert.ok(names.includes('Zweites Element'), 'second job landed on its own container');
    assert.ok(names.filter(n => n === 'Baustellen-Element').length >= 1, 'first job landed on its own container');
    assert.ok(await p3.locator('iframe.render').count() >= iframesAfterReopen, 'no element lost (12-message display window may hide the oldest)');
    ok('two background jobs completed in reverse order, correct containers');

    // 7e. scroll-position preservation on submit (mid, bottom, button, 390px)
    const impLong = await p3.evaluate(async () => {
      const b = await (await fetch('/api/bootstrap')).json();
      const msgs = [];
      for (let i = 1; i <= 30; i++) {
        msgs.push({ role: 'user', text: 'Frage Nummer ' + i });
        msgs.push({ role: 'assistant', prose: 'Antwort Nummer ' + i + ' mit etwas Text zum Scrollen.' });
      }
      const r = await fetch('/api/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Form-CSRF': b.csrf },
        body: JSON.stringify({ sessions: [{ title: 'Lang', messages: msgs }] })
      });
      return r.status;
    });
    assert.equal(impLong, 200, 'long conversation seeded server-side');
    await p3.reload();
    await p3.locator('#sessions button').filter({ hasText: 'Lang' }).first().click();
    await p3.locator('.message[data-mid]').nth(5).waitFor({ timeout: 10000 });
    const topVisible = () => p3.evaluate(() => {
      const f = document.querySelector('#feed'); const fr = f.getBoundingClientRect();
      const dbg = { st: Math.round(f.scrollTop), sh: Math.round(f.scrollHeight), ch: f.clientHeight };
      for (const el of f.querySelectorAll('.message[data-mid]')) {
        const r = el.getBoundingClientRect();
        if (r.bottom > fr.top + 2) return { mid: el.dataset.mid, off: Math.round(r.top - fr.top), ...dbg };
      }
      return { ...dbg };
    });
    await p3.evaluate(() => { const f = document.querySelector('#feed'); f.scrollTop = f.scrollHeight * 0.45; });
    await p3.waitForTimeout(300);
    const midBefore = await topVisible();
    await p3.locator('#prompt').fill('Erkläre mir kurz, was ein VPN macht — prose only');
    await p3.locator('#prompt').press('Enter');
    await p3.locator('.message.assistant').last().locator('.prose').filter({ hasText: 'Virtual Private Network' }).waitFor({ timeout: 30000 });
    const midAfter = await topVisible();
    assert.equal(midAfter.mid, midBefore.mid, 'viewport anchor message unchanged on Enter submit: ' + JSON.stringify({ a: midBefore, b: midAfter }));
    assert.ok(Math.abs(midAfter.off - midBefore.off) < 60, 'anchor offset stable (delta ' + Math.abs(midAfter.off - midBefore.off) + ')');
    // send button must behave identically
    await idle(p3);
    await p3.locator('#prompt').fill('noch eine kurze antwort bitte');
    await p3.locator('#send').click();
    await idle(p3);
    const midAfter2 = await topVisible();
        // same anchor, or the anchor legitimately left the disclosed 12-message
    // window — then the viewport must still hold its middle position (no jump
    // to the top or the end; the window rotation makes pixel equality impossible)
    const stillThere = await p3.evaluate(mid => !!document.querySelector('.message[data-mid="' + mid + '"]'), midAfter.mid);
    if (midAfter2.mid !== midAfter.mid) {
      assert.ok(!stillThere, 'anchor must have left the rendered window, not moved: ' + JSON.stringify({ a: midAfter, b: midAfter2 }));
      const range = midAfter2.sh - midAfter2.ch;
      assert.ok(midAfter2.st > range * 0.25 && midAfter2.st < range * 0.75,
        'viewport stayed mid-conversation after window rotation: ' + JSON.stringify(midAfter2));
    }
    // at the bottom: position stays pinned to the bottom (no jump to top)
    await p3.evaluate(() => { const f = document.querySelector('#feed'); f.scrollTop = f.scrollHeight; });
    await p3.waitForTimeout(200);
    const topBeforeBottom = await p3.evaluate(() => Math.round(document.querySelector('#feed').scrollTop));
    await p3.locator('#prompt').fill('letzter test am grund');
    await p3.locator('#prompt').press('Enter');
    await idle(p3);
    const topAfterBottom = await p3.evaluate(() => Math.round(document.querySelector('#feed').scrollTop));
    assert.ok(Math.abs(topAfterBottom - topBeforeBottom) < 40, `viewport does not move on submit, even at the bottom (${topBeforeBottom} -> ${topAfterBottom})`);
    // mobile 390px: mid-anchor preserved + construction site screenshot
    await p3.locator('#sessions button').filter({ hasText: 'Lang' }).first().click();
    await p3.locator('.message[data-mid]').nth(5).waitFor({ timeout: 10000 });
    // switch to mobile width live (sidebar collapses via media query, no reload needed)
    await p3.setViewportSize({ width: 390, height: 844 });
    await p3.evaluate(() => { const f = document.querySelector('#feed'); f.scrollTop = f.scrollHeight * 0.5; });
    await p3.waitForTimeout(300);
    const mobBefore = await topVisible();
    await idle(p3);
    await p3.locator('#prompt').fill('Erkläre mir kurz, was ein VPN macht — prose only');
    await p3.locator('#prompt').press('Enter');
    await idle(p3);
    const mobAfter = await topVisible();
    assert.equal(mobAfter.mid, mobBefore.mid, '390px: anchor preserved');
    await idle(p3);
    await p3.locator('#prompt').fill('mobile baustelle sitehold');
    await p3.locator('#prompt').press('Enter');
    await p3.locator('.site[data-jobid]').first().waitFor({ timeout: 15000 });
    assert(await p3.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at 390px with site');
    await p3.screenshot({ path: path.join(shots, 'site-mobile.png'), fullPage: true });
    await p3.locator('.site .sitemeta button', { hasText: 'Abbrechen' }).first().click();
    await p3.locator('.notice').filter({ hasText: 'Abgebrochen.' }).first().waitFor({ timeout: 8000 });
    ok('scroll anchor preserved (Enter/button/bottom/390px), mobile construction-site screenshot saved');

    // 8. export never contains keys; localStorage cache holds schema v4
    assert.equal(await p.locator('#export,#import,#file').count(),0);
    const ls = await p.evaluate(() => JSON.stringify(localStorage));
    assert.ok(!ls.includes(KEY), 'key never in localStorage');
    ok('archive controls absent; cache contains no keys');

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
    await p.locator('#elements-tab').click();
    assert.equal(await p.locator('#sessions').isVisible(),false);
    assert.ok(await p.locator('#elements-list button').count()>=2,'collection includes pinned elements from multiple chats');
    await p.locator('#elements-list button').filter({hasText:'Spar-Rechner'}).first().click();
    await p.locator('#overlay[open]').waitFor();
    assert.match(await p.locator('#overlay .ovhead strong').textContent(),/Spar-Rechner/);
    await p.locator('#overlay button[aria-label="Element schliessen"]').click();
    await p.locator('#chats-tab').click();
    await p.locator('#sessions button').filter({hasText:'Boundary'}).first().click();
    await p.locator('#elements-tab').click();
    await p.locator('#elements-list button').first().click();
    await p.locator('#overlay[open]').waitFor();
    const surface=await p.evaluate(()=>({overlay:getComputedStyle(document.querySelector('#overlay')).backgroundColor,chat:getComputedStyle(document.body).backgroundColor,border:getComputedStyle(document.querySelector('#overlay')).borderTopWidth}));
    assert.equal(surface.overlay,surface.chat,'element surface matches chat background');
    assert.equal(surface.border,'0px');
    await p.setViewportSize({width:390,height:844});
    await p.screenshot({path:'docs/screenshots/element-mobile.png'});
    await p.locator('#overlay button[aria-label="Element schliessen"]').click();
    const menu=await p.locator('#mobile').boundingBox();
    const settings=await p.locator('#settingsbtn').boundingBox();
    assert.ok(menu.x>settings.x&&menu.x+menu.width<=390,'mobile menu sits at right edge');
    await p.setViewportSize({width:1440,height:1000});
    await p.locator('#chats-tab').click();
    await p.locator('#sessions button').filter({hasText:'Boundary'}).first().click();
    ok('Elements tab opens saved items; seamless surface; mobile menu right');
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
    await pB.locator('#sessions button').first().waitFor();
    assert.equal(await pB.locator('#importbar').count(),0);
    const bobsTitles = await pB.locator('#sessions button').allInnerTexts();
    assert.ok(bobsTitles.every(t => !t.includes('Spar') && !t.includes('Boundary')), 'user B sees only his own data: ' + bobsTitles.join('|'));
    ok('user B isolated; no archive UI');
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
