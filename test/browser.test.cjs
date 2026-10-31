// Browser acceptance tests (Playwright core + system Chrome).
// Env: BASE_URL, MOCK_URL, CHROME_PATH (optional).
const { chromium } = require('playwright-core');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4598';
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:4599';
const KEY = 'test-key-1234567890';

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
  const shots = path.resolve(__dirname, '..', 'docs', 'screenshots');
  fs.mkdirSync(shots, { recursive: true });
  try {
    // 1. empty state until a model exists
    await p.goto(BASE);
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

    // 4. artifact renders + is interactive + state survives reload
    let f = p.frameLocator('iframe.render').first();
    await f.locator('#amt').waitFor({ timeout: 10000 });
    await f.locator('#amt').fill('7');
    await f.locator('#out').filter({ hasText: 'Wert: 7' }).waitFor({ timeout: 5000 });
    await p.waitForFunction(() => {
      try { const db = JSON.parse(localStorage.getItem('form.v3')); const m = db.sessions[0].messages.at(-1); return m && m.render && m.render.state.value === 7; } catch { return false; }
    }, undefined, { timeout: 8000 });
    await p.reload();
    f = p.frameLocator('iframe.render').first();
    await f.locator('#amt').waitFor({ timeout: 10000 });
    await f.locator('#amt').waitForFunction(el => el.value === '7', { timeout: 10000 });
    assert.equal(await f.locator('#amt').inputValue(), '7');
    await f.locator('#out').filter({ hasText: 'Wert: 7' }).waitFor({ timeout: 5000 });
    ok('artifact interactive (slider changes value), state survives reload');

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

    // 7. stop aborts upstream (wait for previous chat to finish first: server allows one at a time)
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
    ok('stop button aborts upstream');

    // 7b. moving sketch animation in normal-motion context
    const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE);
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

    // 8. export never contains keys
    const dl = p.waitForEvent('download');
    await p.locator('#export').click();
    const d = await dl;
    const data = fs.readFileSync(await d.path(), 'utf8');
    assert.ok(!data.includes(KEY), 'export must not contain API key');
    assert.equal(JSON.parse(data).version, 3);
    const ls = await p.evaluate(() => JSON.stringify(localStorage));
    assert.ok(!ls.includes(KEY), 'key never in localStorage');
    ok('export + localStorage contain sessions, never keys');

    // 9. boundary / sanitizing / egress / sandbox regression (ported from v2)
    await p.evaluate(render => {
      const id = crypto.randomUUID();
      localStorage.setItem('form.v3', JSON.stringify({
        version: 3, current: id,
        sessions: [{ id, title: 'Boundary', messages: [{ role: 'assistant', id: crypto.randomUUID(), prose: 'Boundary check.', render }] }]
      }));
    }, boundaryRender);
    await p.reload();
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
    const statuses = await p.evaluate(async () => [
      await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.status),
      await fetch('/form.models.json').then(r => r.status),
      await fetch('/api/models').then(r => r.text())
    ]);
    assert.equal(statuses[0], 403);
    assert.equal(statuses[1], 404);
    assert.ok(!statuses[2].includes(KEY), 'models API masked');
    assert.deepEqual(external, [], 'no external egress requests: ' + JSON.stringify(external));
    ok('sanitizing/egress/CSRF/secret-path regression ported from v2 boundary test');

    // 10. mobile 390px + screenshots
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
