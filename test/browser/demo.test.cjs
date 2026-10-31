const { chromium } = require(
  process.env.PLAYWRIGHT_PATH || '/usr/lib/node_modules/openclaw/node_modules/playwright-core',
);
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      '/root/.cache/puppeteer/chrome/linux-153.0.8010.36/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  let errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const checks = [];
  const ok = (s) => {
    checks.push(s);
    console.log('PASS', s);
  };
  try {
    await page.goto(process.env.URL || 'https://fhisling.tail11036c.ts.net:9443/form');
    await page.locator('#new').waitFor();
    ok('HTTPS app loads');
    await page.getByRole('button', { name: '↗ Sparziel erkunden' }).click();
    let calc = page.frameLocator('iframe').first();
    await calc.locator('#monthly').waitFor();
    let original = await calc.locator('#total').textContent();
    await calc.locator('#monthly').fill('700');
    assert.notEqual(await calc.locator('#total').textContent(), original);
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem('form.prototype.v1')).sessions[0].messages[1].state
          .monthly === 700,
    );
    ok('Calculator live DOM and persisted state');
    await page.reload();
    calc = page.frameLocator('iframe').first();
    assert.equal(await calc.locator('#monthly').inputValue(), '700');
    ok('Calculator survives refresh');
    await page.getByRole('button', { name: '◇ Orte vergleichen' }).click();
    let compare = page.frameLocator('iframe').nth(1);
    await compare.locator('[data-choice=city]').click();
    assert.equal(await compare.locator('[data-choice=city]').getAttribute('aria-pressed'), 'true');
    await compare.locator('#suggest').click();
    assert.match(await page.locator('#prompt').inputValue(), /city/);
    assert.equal(await page.locator('.user').count(), 2);
    ok('Comparison and suggestion require explicit send');
    await page.locator('#prompt').fill('Projekt planen');
    await page.locator('#prompt').press('Enter');
    let plan = page.frameLocator('iframe').nth(2);
    await plan.locator('#advance').click();
    assert.equal(await plan.locator('#progress').textContent(), '14 %');
    await page.reload();
    plan = page.frameLocator('iframe').nth(2);
    assert.equal(await plan.locator('#progress').textContent(), '14 %');
    assert.equal(
      await page
        .frameLocator('iframe')
        .nth(1)
        .locator('[data-choice=city]')
        .getAttribute('aria-pressed'),
      'true',
    );
    ok('Plan and selection survive refresh');
    await page.screenshot({ path: __dirname + '/desktop.png', fullPage: true });
    const frame = await (await page.locator('iframe').first().elementHandle()).contentFrame();
    assert.equal(
      await frame.evaluate(() => {
        try {
          return parent.document.body ? 'accessible' : 'no';
        } catch {
          return 'blocked';
        }
      }),
      'blocked',
    );
    assert.equal(
      await frame.evaluate(async () => {
        try {
          await fetch('https://example.com');
          return 'allowed';
        } catch {
          return 'blocked';
        }
      }),
      'blocked',
    );
    assert.equal(await page.locator('iframe').first().getAttribute('sandbox'), 'allow-scripts');
    ok('Opaque iframe denies parent DOM and network');
    let height = await page
      .locator('iframe')
      .first()
      .evaluate((e) => e.style.height);
    await page.evaluate(() =>
      window.postMessage({ v: 1, type: 'resize', channel: 'fake', height: 999999 }, '*'),
    );
    assert.equal(
      await page
        .locator('iframe')
        .first()
        .evaluate((e) => e.style.height),
      height,
    );
    ok('Forged resize ignored');
    await page.locator('#prompt').fill('<img src=x onerror=alert(1)>');
    await page.locator('#prompt').press('Enter');
    await page.frameLocator('iframe').nth(3).getByText('Damit lässt sich').waitFor();
    assert.equal(await page.locator('.bubble img').count(), 0);
    ok('Arbitrary input deterministic fallback, HTML inert');
    await page.locator('#prompt').fill('Stopptest');
    await page.locator('#prompt').press('Enter');
    await page.locator('#stop').click();
    await page.getByText('Antwort gestoppt.', { exact: false }).waitFor();
    ok('Loading and cancellation');
    await page.locator('#prompt').fill('Fehler');
    await page.locator('#prompt').press('Enter');
    await page.getByRole('button', { name: 'Plan-Demo ausprobieren' }).waitFor();
    ok('Error state recoverable');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await downloadPromise;
    const data = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(data.version, 1);
    await page.locator('#new').click();
    assert.equal(await page.locator('.sessions button').count(), 2);
    await page.locator('#file').setInputFiles({
      name: 'archive.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(data)),
    });
    await page.locator('.toast').filter({ hasText: 'Archiv sicher importiert' }).waitFor();
    assert.equal(await page.locator('.sessions button').count(), 3);
    ok('Multiple sessions and export/import merge');
    await page.locator('#file').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        '{"version":1,"sessions":[{"id":"x","title":"x","messages":[{"role":"assistant","id":"x","kind":"evil"}]}]}',
      ),
    });
    await page.locator('.toast').filter({ hasText: 'Import fehlgeschlagen:' }).waitFor();
    assert.equal(await page.locator('.sessions button').count(), 3);
    ok('Invalid imported renderer rejected atomically');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.locator('#mobile').click();
    await page.locator('#new').click();
    await page.getByRole('button', { name: '⌁ Projekt simulieren' }).click();
    let mobile = page.frameLocator('iframe').first();
    await mobile.locator('#advance').click();
    assert.equal(await mobile.locator('#progress').textContent(), '14 %');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(
      await page.locator('#feed').evaluate((e) => getComputedStyle(e).scrollBehavior),
      'auto',
    );
    await page.screenshot({ path: __dirname + '/mobile.png', fullPage: true });
    ok('390px mobile interaction, no horizontal overflow, reduced motion');
    assert.deepEqual(errors, []);
    ok('No uncaught JS errors');
    fs.writeFileSync(
      __dirname + '/test-results.json',
      JSON.stringify({ date: new Date().toISOString(), checks }, null, 2),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
