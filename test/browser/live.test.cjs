const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const fs = require('fs'),
  assert = require('assert/strict');
(async () => {
  const b = await chromium.launch({
    executablePath: '/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300));
  });
  try {
    await p.goto('https://fhisling.tail11036c.ts.net:9443/form');
    await p
      .locator('#prompt')
      .fill(
        'Merke dir das Kennwort Waldstern. Baue einen kleinen interaktiven Rechner: Monatsbetrag 250 CHF, Eingabe mit id amount, Ergebnis id result zeigt 12 mal Betrag, state.amount. Nutze ui.on und ui.persist.',
      );
    await p.locator('#prompt').press('Enter');
    await p.waitForFunction(
      () => document.querySelectorAll('iframe,.notice.error').length > 0,
      {},
      { timeout: 180000 },
    );
    console.log('BODY', (await p.locator('body').innerText()).slice(-600));
    let f = p.frameLocator('iframe').first();
    await f.locator('#amount').waitFor({ timeout: 10000 });
    await f.locator('#amount').fill('700');
    await p.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem('form.live.v2')).sessions[0].messages.find((m) => m.render)
          ?.render.state.amount === 700,
      {},
      { timeout: 10000 },
    );
    console.log('INTERACTION', await f.locator('#result').textContent());
    assert.match(await f.locator('#result').textContent(), /8.?400/);
    await p.reload();
    await p.frameLocator('iframe').first().locator('#amount').waitFor();
    assert.equal(await p.frameLocator('iframe').first().locator('#amount').inputValue(), '700');
    await p
      .locator('#prompt')
      .fill(
        'Wie lautet mein Kennwort und wie hoch ist mein aktueller Monatsbetrag? Nenne beides und den Jahresbetrag in deiner Antwort.',
      );
    await p.locator('#prompt').press('Enter');
    await p.waitForFunction(
      () => JSON.parse(localStorage.getItem('form.live.v2')).sessions[0].messages.length === 4,
      {},
      { timeout: 180000 },
    );
    const db = await p.evaluate(() => JSON.parse(localStorage.getItem('form.live.v2')));
    fs.writeFileSync(__dirname + '/live-proof.json', JSON.stringify(db, null, 2));
    assert.match(db.sessions[0].messages[3].render.html, /Waldstern/);
    await p
      .frameLocator('iframe')
      .nth(1)
      .locator('body')
      .filter({ hasText: '700' })
      .waitFor({ timeout: 10000 });
    assert.match(await p.frameLocator('iframe').nth(1).locator('body').innerText(), /8.?400/);
    await p.screenshot({ path: __dirname + '/live-desktop.png' });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.reload();
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.screenshot({ path: __dirname + '/live-mobile.png' });
    console.log('PASS live model, multi-turn memory, interaction roundtrip, reload, mobile');
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
