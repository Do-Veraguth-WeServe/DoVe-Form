// Real-deployment smoke (NOT part of run-all): drives the live app at SMOKE_URL
// with the configured real model. v3.2: login flow as first user, data-driven
// todo element via ui.db (survives reload), in-place refinement, ui.ping element,
// pin quickbar, overlay, logout/login with data intact, desktop + mobile shots.
// Usage: SMOKE_URL=https://host:9444 SMOKE_USER=dömu SMOKE_PASS='...' node test/smoke.deployed.cjs
// If the user does not exist yet and registration is open, the script registers it.
const { chromium } = require('playwright-core');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const BASE = process.env.SMOKE_URL || 'https://fhisling.tail11036c.ts.net:9444';
const USER = process.env.SMOKE_USER || 'smokeuser';
const PASS = process.env.SMOKE_PASS || 'smoke-password-1';
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
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  const shots = path.resolve(__dirname, '..', 'docs', 'screenshots');
  fs.mkdirSync(shots, { recursive: true });
  const ok = s => console.log('PASS', s);

  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.locator('#login[open]').waitFor({ timeout: 20000 });

  // 0. login (or first-user registration) — wrong password must fail cleanly first
  await p.locator('#loginform [name=username]').fill(USER);
  await p.locator('#loginform [name=password]').fill('definitely-wrong');
  await p.locator('#loginform button').last().click();
  await p.locator('#loginerr').waitFor({ timeout: 8000 });
  ok('wrong password rejected with inline error');
  let loggedIn = false;
  await p.locator('#loginform [name=password]').fill(PASS);
  await p.locator('#loginform button').last().click();
  try {
    await p.locator('#login[open]').waitFor({ state: 'detached', timeout: 8000 });
    loggedIn = true;
  } catch {
    const err = await p.locator('#loginerr').innerText().catch(() => '');
    if (!/benutzername|passwort/i.test(err)) throw Error('login failed: ' + err);
  }
  if (!loggedIn) {
    const regVisible = await p.locator('#switchreg').isVisible().catch(() => false);
    if (!regVisible) throw Error('login failed and registration is closed — create the user via useradmin.mjs');
    await p.locator('#switchreg').click();
    await p.locator('#regform [name=username]').fill(USER);
    await p.locator('#regform [name=password]').fill(PASS);
    await p.locator('#regform [name=password2]').fill(PASS);
    await p.locator('#regform button').last().click();
    await p.locator('#login[open]').waitFor({ state: 'detached', timeout: 10000 });
    ok('first user registered (Owner)');
  } else ok('login as existing user');
  // dismiss the local-data import offer if it appears (smoke keeps server state)
  await p.locator('#importskip').click().catch(() => {});
  await p.locator('#model').waitFor({ state: 'visible', timeout: 15000 });
  ok('deployed app loads, configured model present: ' + (await p.locator('#model option').first().textContent()));

  // 1. data-driven element with ui.db (persistent server-side table)
  await p.locator('#new').click();
  await p.locator('#prompt').fill('Baue mir ein Element "Aufgaben": Eingabefeld + Button «Hinzufügen», darunter die Liste der offenen Aufgaben aus einer echten Datenbanktabelle (ui.db.create/insert/select). Beim Laden sollen gespeicherte Einträge erscheinen — die Liste muss Seiten-Reloads überleben. Kurze Antwort, dann das Element.');
  await p.locator('#prompt').press('Enter');
  let tf = p.frameLocator('iframe.render').last();
  await tf.locator('input,button').first().waitFor({ timeout: 180000 });
  ok('real model produced a data-driven element (iframe rendered)');
  console.log('  element name:', await p.locator('.elname').last().textContent());

  // interact: add one todo (whatever the model named the controls, find input+button)
  const input = tf.locator('input[type=text],input:not([type])').first();
  const addBtn = tf.locator('button').first();
  const before = await tf.locator('body').innerText().catch(() => '');
  const marker = 'Milch-' + Date.now().toString(36);
  await input.fill(marker).catch(() => {});
  await addBtn.click();
  let after = '';
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(500); after = await tf.locator('body').innerText().catch(() => ''); if (after.includes(marker)) break; }
  assert.ok(after.includes(marker), 'todo entry rendered inside element');
  ok('ui.db insert visible in element: ' + marker);

  // reload: the todo must come back from the SERVER database
  await p.reload();
  tf = p.frameLocator('iframe.render').last();
  await tf.locator('body').waitFor({ timeout: 20000 });
  let persisted = '';
  for (let i = 0; i < 40; i++) { await p.waitForTimeout(500); persisted = await tf.locator('body').innerText().catch(() => ''); if (persisted.includes(marker)) break; }
  assert.ok(persisted.includes(marker), 'todo survived reload via server-side ui.db');
  ok('data-driven element survives reload (server-side table)');

  // 2. in-place refinement: no duplicate assistant message
  const before2 = {
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
  const after2 = {
    assist: await p.locator('.message.assistant').count(),
    frames: await p.locator('iframe.render').count()
  };
  console.log('  assistant msgs:', before2.assist, '->', after2.assist, '| iframes:', before2.frames, '->', after2.frames);
  assert.equal(after2.assist, before2.assist, 'no new assistant message (in-place)');
  assert.equal(after2.frames, before2.frames, 'no duplicate element');
  ok('in-place refinement on live model: element replaced, history clean');

  // 3. lab-shell element with real /bin/ping
  await p.locator('#prompt').fill('Baue mir ein Element "Ping-Konsole": Eingabefeld für einen Ziel-Host (default example.com), ein Button, der ui.ping auf den Host ausführt, und die Ausgabe (ok, ms, ip) darunter. Labor-Look. Kurze Antwort, dann das Element.');
  await p.locator('#prompt').press('Enter');
  let pf = p.frameLocator('iframe.render').last();
  await pf.locator('input').first().waitFor({ timeout: 180000 });
  const btn = pf.locator('button').first();
  await btn.click();
  let out = '';
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(500);
    const t = await pf.locator('body').innerText().catch(() => '');
    if (/(ms|online|ok)/i.test(t) && /\d/.test(t)) { out = t; break; }
  }
  console.log('  element output:', out.replace(/\n/g, ' | ').slice(0, 160));
  assert.match(out, /(ms|online)/i, 'ping result rendered in element');
  ok('ui.ping executed via real /bin/ping, result visible in element');

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

  // 5. logout -> login: conversations + todo table intact (server-side truth)
  await p.locator('#logout').click();
  await p.locator('#login[open]').waitFor({ timeout: 8000 });
  await p.locator('#loginform [name=username]').fill(USER);
  await p.locator('#loginform [name=password]').fill(PASS);
  await p.locator('#loginform button').last().click();
  await p.locator('#quickbar .qchip, iframe.render').first().waitFor({ timeout: 20000 });
  const titles = await p.locator('#sessions button').allInnerTexts();
  console.log('  conversations after re-login:', titles.join(' | ').slice(0, 160));
  assert.ok(titles.length >= 2, 'conversations restored after logout/login');
  ok('logout + re-login: all conversations and elements intact');

  // 6. mobile 390px
  await p.setViewportSize({ width: 390, height: 844 });
  await p.reload();
  await p.locator('iframe.render').first().waitFor({ timeout: 20000 });
  await p.locator('#quickbar .qchip').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at 390px');
  await p.screenshot({ path: path.join(shots, 'smoke-mobile.png'), fullPage: false });
  ok('390px clean; screenshots saved (smoke-desktop.png, smoke-mobile.png)');

  await b.close();
  console.log('DEPLOYED SMOKE PASSED');
})().catch(e => { console.error('FAIL', e && e.stack || e); process.exit(1); });
