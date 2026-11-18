// Run with Playwright available via NODE_PATH (or installed locally).
// Mocks prediction responses; no model, camera or backend required.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'medicinal_info.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let response;
      await page.route('http://plant.test/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/predict') return route.fulfill({ json: response });
        const file = url.pathname.startsWith('/assets/') ? url.pathname.slice(8) : (mobile ? 'mobile.html' : 'index.html');
        const contentType = file.endsWith('.js') ? 'application/javascript; charset=utf-8'
          : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
        return route.fulfill({ body: fs.readFileSync(path.join(root, 'frontend', file)), contentType });
      });
      await page.goto('http://plant.test/' + (mobile ? 'mobile' : ''));
      const input = mobile ? '#file-gallery' : '#file';
      async function predict(info, name = 'Example', status = 'recognized') {
        response = { status, predicted_class: name, scientific_name: name, medicinal_info: info };
        await page.locator(input).setInputFiles({ name: 'plant.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
        assert.equal(await page.locator('.plant-guides').count(), 0, 'Selecting a new image clears old guides');
        await page.locator('#submit').click();
        await page.waitForFunction(() => !document.getElementById('submit').disabled);
        if (mobile) await page.locator('#notify-close').click();
      }
      for (const [name, info] of Object.entries(catalog)) {
        await predict(info, name);
        assert.equal(await page.locator('.guide-options button').count(), 2);
        assert.equal(await page.locator('#guide-usage').isVisible(), false);
        assert.equal(await page.locator('#guide-cultivation').isVisible(), false);
        await page.locator('[data-guide="usage"]').click();
        assert.equal(await page.locator('#guide-usage').isVisible(), true);
        const visible = await page.locator('#guide-usage').innerText();
        // Every nonblank source line must be present in the rendered guide.
        for (const line of info.usage_guide.split('\n').filter(line => line.trim())) {
          const plain = line.replace(/^### /, '').replace(/^\* /, '').replace(/\*/g, '');
          assert.ok(visible.includes(plain), `Missing content: ${name}: ${plain}`);
        }
        await page.locator('[data-guide="cultivation"]').click();
        assert.equal(await page.locator('#guide-usage').isVisible(), false);
        assert.equal(await page.locator('#guide-cultivation').isVisible(), true);
        assert.ok((await page.locator('#guide-cultivation').innerText()).includes('chưa được bổ sung'));
        assert.equal(await page.locator('[data-guide="usage"]').getAttribute('aria-pressed'), 'false');
        await page.locator('[data-guide="usage"]').click();
        assert.equal(await page.locator('#guide-usage').innerText(), visible);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      }
      await predict({});
      // Exercise keyboard activation and the missing-guide fallback.
      await page.locator('[data-guide="usage"]').focus();
      await page.keyboard.press('Enter');
      assert.ok((await page.locator('#guide-usage').innerText()).includes('Chưa có hướng dẫn'));
      await predict({ usage_guide: '<img src=x onerror="window.injected=true"> **Safe**', cultivation_guide: '**Canh tác**\n* Nội dung mới' });
      await page.locator('[data-guide="usage"]').click();
      assert.equal(await page.locator('#guide-usage img').count(), 0);
      assert.equal(await page.evaluate(() => window.injected), undefined);
      assert.equal(await page.locator('#guide-usage strong').innerText(), 'Safe');
      await page.locator('[data-guide="cultivation"]').click();
      assert.ok((await page.locator('#guide-cultivation').innerText()).includes('Nội dung mới'));
      for (const status of ['uncertain', 'unknown']) {
        await predict(null, 'Example', status);
        assert.equal(await page.locator('.plant-guides').count(), 0);
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${mobile ? 'Mobile' : 'Desktop'}: 21 complete guides, switching, reset, fallback, keyboard, escaping and uncertain/unknown passed.`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
