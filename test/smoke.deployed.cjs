// Real-deployment smoke (NOT part of run-all): drives the live app at SMOKE_URL
// with the configured real model — lab-shell element with ui.ping, in-place
// refinement (no duplicate), overlay + pin quickbar, desktop + mobile screenshots.
// Usage: SMOKE_URL=https://host:9444 node test/smoke.deployed.cjs
const { chromium } = require('playwright-core');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const BASE = process.env.SMOKE_URL || 'https://fhisling.tail11036c.ts.net:9444';
const CANDIDATES = [
  process.env.CHROME_PATH,
  '/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',
  '/root/.cache/puppeteer/chrome/linux-151.0.7922.77/chrome-linux64/chrome'
].filter(Boolean);

(async () => {
  let exe = null;
  for (const c of CANDIDATES) { try { if (fs.existsSync(c)) { exe = c; break; } } catch {} }
  if (!exe) throw Error('no chrome found');
  const b = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  const shots = path.resolve(__dirname, '..', 'docs', 'screenshots');
  fs.mkdirSync(shots, { recursive: true });
  const ok = s => console.log('PASS', s);

  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.locator('#model').waitFor({ state: 'visible', timeout: 15000 });
  ok('deployed app loads, configured model present: ' + (await p.locator('#model option').first().textContent()));

  // 1. real roundtrip: lab-shell element that pings a public host
  await p.locator('#new').click();
  await p.locator('#prompt').fill('Baue mir ein Element "Ping-Konsole": Eingabefeld für einen Ziel-Host (default example.com), ein Button, der ui.ping auf den Host ausführt, und die Ausgabe (ok, ms, ip) darunter. Labor-Look. Kurze Antwort, dann das Element.');
  await p.locator('#prompt').press('Enter');
  let pf = p.frameLocator('iframe.render').last();
  await pf.locator('input').first().waitFor({ timeout: 180000 });
  ok('real model produced a lab-shell element (iframe rendered)');
  const elname = await p.locator('.elname').last().textContent();
  console.log('  element name:', elname);

  // 2. real ping through /bin/ping, rendered inside the element
  const btn = pf.locator('button').first();
  await btn.click();
  let out = '';
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(500);
    const t = await pf.locator('body').innerText().catch(() => '');
    if (/ms|online|ok/i.test(t) && /\d/.test(t)) { out = t; break; }
  }
  console.log('  element output:', out.replace(/\n/g, ' | ').slice(0, 160));
  assert.match(out, /(ms|online)/i, 'ping result rendered in element');
  ok('ui.ping executed via real /bin/ping, result visible in element');

  // 3. in-place refinement: no duplicate assistant message
  const before = {
    assist: await p.locator('.message.assistant').count(),
    frames: await p.locator('iframe.render').count()
  };
  await p.locator('.elname').last().click();
  await p.locator('#refchip').waitFor({ state: 'visible', timeout: 5000 });
  console.log('  chip:', (await p.locator('#refchip').innerText()).trim());
  await p.locator('#prompt').fill('Mach den Akzent dieses Elements gelb und den Hintergrund etwas heller. Nur das Element aktualisieren.');
  await p.locator('#prompt').press('Enter');
  await p.locator('#refchip').waitFor({ state: 'hidden', timeout: 180000 });
  await p.waitForFunction(() => !document.querySelector('.live'), undefined, { timeout: 10000 });
  const after = {
    assist: await p.locator('.message.assistant').count(),
    frames: await p.locator('iframe.render').count()
  };
  console.log('  assistant msgs:', before.assist, '->', after.assist, '| iframes:', before.frames, '->', after.frames);
  assert.equal(after.assist, before.assist, 'no new assistant message (in-place)');
  assert.equal(after.frames, before.frames, 'no duplicate element');
  ok('in-place refinement on live model: element replaced, history clean');

  // 4. pin -> quickbar, overlay, screenshots
  const pinBtn = p.locator('.elhead button[aria-label="Element anpinnen"]').last();
  await pinBtn.scrollIntoViewIfNeeded();
  await pinBtn.click();
  await p.locator('#quickbar .qchip').last().waitFor({ state: 'visible', timeout: 5000 });
  ok('pinned -> quick-access bar shows: ' + (await p.locator('#quickbar .qchip').last().textContent()));
  const openBtn = p.locator('.elhead button[aria-label="Element öffnen"]').last();
  await openBtn.scrollIntoViewIfNeeded();
  await openBtn.click();
  await p.locator('#overlay[open]').waitFor({ timeout: 5000 });
  await p.locator('#overlay iframe.render').waitFor({ timeout: 15000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(shots, 'smoke-desktop.png'), fullPage: false });
  console.log('  overlay actions:', (await p.locator('#overlay .ovfoot button').allInnerTexts()).join(' / '));
  await p.locator('#overlay button[aria-label="Element schliessen"]').click();
  await p.locator('#overlay[open]').waitFor({ state: 'detached', timeout: 5000 });

  // 5. mobile 390px
  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload();
  await p.locator('iframe.render').first().waitFor({ timeout: 20000 });
  await p.locator('#quickbar .qchip').first().waitFor({ state: 'visible', timeout: 10000 });
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at 390px');
  await p.screenshot({ path: path.join(shots, 'smoke-mobile.png'), fullPage: false });
  ok('390px clean with quick-access bar; screenshots saved (smoke-desktop.png, smoke-mobile.png)');

  await b.close();
  console.log('DEPLOYED SMOKE PASSED');
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
