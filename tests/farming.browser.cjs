// Requires Playwright and Edge; predictions are mocked to test every species without AI.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'medicinal_info.json'), 'utf8'));
const plain = line => line.replace(/^#{1,6} /, '').replace(/^\d+\.\s+/, '').replace(/^[-*] /, '')
  .replace(/\[([^\]]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))*)\)/g, '$1').replace(/\*/g, '').trim();

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  try {
    for (const mobile of [false, true]) {
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let response;
      await page.route('http://plant.test/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/predict') return route.fulfill({ json: response });
        const file = url.pathname.startsWith('/assets/') ? url.pathname.slice(8) : (mobile ? 'mobile.html' : 'index.html');
        const contentType = file.endsWith('.js') ? 'application/javascript; charset=utf-8'
          : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
        return route.fulfill({ body: fs.readFileSync(path.join(root, 'frontend', file)), contentType });
      });
      await page.goto('http://plant.test/' + (mobile ? 'mobile' : ''));
      async function predict(info, name = 'Example', status = 'recognized') {
        response = { status, predicted_class: name, scientific_name: name, medicinal_info: info };
        await page.locator(mobile ? '#file-gallery' : '#file').setInputFiles({ name: 'plant.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
        assert.equal(await page.locator('.farming-open').count(), 0);
        await page.locator('#submit').click();
        await page.waitForFunction(() => !document.getElementById('submit').disabled);
        if (mobile) await page.locator('#notify-close').click();
      }
      for (const [name, info] of Object.entries(catalog)) {
        await predict(info, name);
        assert.equal(await page.getByRole('button', { name: /Hướng dẫn sử dụng/i }).count(), 1);
        await page.locator('.farming-usage').click();
        assert.equal(await page.locator('.farming-usage-empty').isVisible(), true);
        assert.ok((await page.locator('.farming-usage-empty').innerText()).includes('chưa được bổ sung'));
        assert.equal(await page.locator('dialog').isVisible(), false);
        await page.locator('.farming-open').click();
        assert.equal(await page.locator('dialog').isVisible(), true);
        assert.equal(await page.locator('.farming-usage-empty').isVisible(), false);
        assert.equal(await page.locator('.farming-usage').getAttribute('aria-pressed'), 'false');
        assert.equal(await page.locator('.farming-context').count(), 0);
        assert.equal(await page.locator('.farming-body').evaluate(el => getComputedStyle(el).textAlign), 'left');
        assert.ok(!/^\d+\./.test(await page.locator('.farming-document h3').first().innerText()));
        assert.equal(await page.locator('.guide-source').count(), 0);
        const visible = await page.locator('.farming-document').innerText();
        for (const line of info.cultivation_guide.split('\n').filter(line => line.trim() && line !== '---')) {
          assert.ok(visible.includes(plain(line)), `Missing ${name}: ${plain(line)}`);
        }
        const expectedLinks = [...info.cultivation_guide.matchAll(/\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))*)\)/g)].map(m => m[1]);
        assert.deepEqual(await page.locator('.farming-document a').evaluateAll(links => links.map(a => a.getAttribute('href'))), expectedLinks);
        assert.ok(await page.locator('.farming-body').evaluate(el => el.scrollHeight > el.clientHeight));
        assert.equal(await page.locator('.farming-body').evaluate(el => el.scrollWidth > el.clientWidth), false);
        // Long document scrolls independently; its final paragraph is reachable.
        await page.locator('.farming-document').locator('p').last().scrollIntoViewIfNeeded();
        assert.equal(await page.locator('.farming-close').isVisible(), true);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.body.classList.contains('farming-modal-open'));
        assert.equal(await page.locator('dialog').isVisible(), false);
        assert.equal(await page.locator('body').evaluate(el => el.classList.contains('farming-modal-open')), false);
        assert.equal(await page.locator('.farming-open').evaluate(el => el === document.activeElement), true);
      }
      // Empty, unsafe source markup, backdrop, button dismissal, keyboard, focus trap.
      await predict({});
      await page.locator('.farming-open').focus();
      await page.keyboard.press('Enter');
      assert.ok((await page.locator('.farming-body').innerText()).includes('chưa được bổ sung'));
      await page.locator('.farming-close').click();
      await predict({ cultivation_guide: '# 8. Example\n\n<img src=x onerror="window.injected=true">\n\n[bad](javascript:alert(1))\n\n**Safe**' });
      await page.locator('.farming-open').click();
      assert.equal(await page.locator('.farming-body img, .farming-body a').count(), 0);
      assert.equal(await page.evaluate(() => window.injected), undefined);
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
      }
      await page.mouse.click(1, 1);
      assert.equal(await page.locator('dialog').isVisible(), false);
      await page.locator('.farming-open').click();
      assert.equal(await page.locator('.farming-body').evaluate(el => el.scrollTop), 0);
      await page.locator('.farming-close').click();
      for (const status of ['uncertain', 'unknown']) {
        await predict(null, 'Example', status);
        assert.equal(await page.locator('.farming-open, dialog').count(), 0);
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${mobile ? 'Mobile' : 'Desktop'}: all 21 full guides, usage placeholder, no context section, scrolling, dismissal, focus and fallback passed.`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
