// Run with Playwright available via NODE_PATH (or installed locally).
// Mocks prediction responses; no model, camera or backend required.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'medicinal_info.json'), 'utf8'));
const farmingPlain = line => line.replace(/^#{1,6} /, '').replace(/^\d+\.\s+/, '').replace(/^[-*] /, '')
  .replace(/\[([^\]]+)\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))*)\)/g, '$1').replace(/\*/g, '').trim();

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
        assert.equal(await page.locator('#farming-dialog').isVisible(), false);
        await page.locator('[data-guide="usage"]').click();
        assert.equal(await page.locator('#guide-usage').isVisible(), true);
        const visible = await page.locator('#guide-usage').innerText();
        assert.equal(await page.locator('#guide-usage h4').count(), 1);
        assert.equal(await page.locator('#guide-usage h5').count(), 4);
        assert.ok(!/^\d+\./.test(await page.locator('#guide-usage h4').innerText()));
        assert.equal(await page.locator('.guide-source').count(), 0);
        // Every nonblank source line must be present in the rendered guide.
        for (const line of info.usage_guide.split('\n').filter(line => line.trim())) {
          const plain = line.replace(/^### \d+\.\s+/, '').replace(/^### /, '').replace(/^\* /, '').replace(/\*/g, '')
            .replace(/\$(\d+)\\text\{--\}(\d+)\^\\circ\$/g, '$1–$2°')
            .replace(/\$(\d+)\^\\circ\\text\{C\}\$/g, '$1°C');
          assert.ok(visible.includes(plain), `Missing content: ${name}: ${plain}`);
        }
        await page.locator('[data-guide="cultivation"]').click();
        assert.equal(await page.locator('#guide-usage').isVisible(), false);
        assert.equal(await page.locator('#farming-dialog').isVisible(), true);
        assert.equal(await page.locator('.farming-body').evaluate(el => getComputedStyle(el).textAlign), 'left');
        assert.equal(await page.locator('.farming-context').count(), 0);
        assert.equal(await page.locator('.farming-usage-empty').count(), 0);
        assert.ok(!/^\d+\./.test(await page.locator('.farming-document h3').first().innerText()));
        const farmingText = await page.locator('.farming-document').innerText();
        for (const line of info.cultivation_guide.split('\n').filter(line => line.trim() && line !== '---')) {
          assert.ok(farmingText.includes(farmingPlain(line)), `Missing farming content: ${name}: ${farmingPlain(line)}`);
        }
        const expectedLinks = [...info.cultivation_guide.matchAll(/\]\((https?:\/\/(?:[^\s()]|\([^\s()]*\))*)\)/g)].map(m => m[1]);
        assert.deepEqual(await page.locator('.farming-document a').evaluateAll(links => links.map(a => a.getAttribute('href'))), expectedLinks);
        assert.ok(await page.locator('.farming-body').evaluate(el => el.scrollHeight > el.clientHeight));
        assert.equal(await page.locator('.farming-body').evaluate(el => el.scrollWidth > el.clientWidth), false);
        await page.locator('.farming-document p').last().scrollIntoViewIfNeeded();
        assert.equal(await page.locator('.farming-close').isVisible(), true);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.body.classList.contains('farming-modal-open'));
        assert.equal(await page.locator('#farming-dialog').isVisible(), false);
        assert.equal(await page.locator('[data-guide="cultivation"]').evaluate(el => el === document.activeElement), true);
        assert.equal(await page.locator('[data-guide="usage"]').getAttribute('aria-pressed'), 'false');
        assert.equal(await page.locator('[data-guide="cultivation"]').getAttribute('aria-pressed'), 'false');
        await page.locator('[data-guide="usage"]').click();
        assert.equal(await page.locator('#guide-usage').innerText(), visible);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      }
      await predict({});
      // Exercise keyboard activation and the missing-guide fallback.
      await page.locator('[data-guide="usage"]').focus();
      await page.keyboard.press('Enter');
      assert.ok((await page.locator('#guide-usage').innerText()).includes('Chưa có hướng dẫn'));
      await page.locator('[data-guide="cultivation"]').click();
      assert.ok((await page.locator('.farming-body').innerText()).includes('chưa được bổ sung'));
      await page.locator('.farming-close').click();
      await predict({ usage_guide: '<img src=x onerror="window.injected=true"> **Safe**', cultivation_guide: '**Canh tác**\n* Nội dung mới' });
      await page.locator('[data-guide="usage"]').click();
      assert.equal(await page.locator('#guide-usage img').count(), 0);
      assert.equal(await page.evaluate(() => window.injected), undefined);
      assert.equal(await page.locator('#guide-usage strong').innerText(), 'Safe');
      await page.locator('[data-guide="cultivation"]').click();
      assert.ok((await page.locator('.farming-body').innerText()).includes('Nội dung mới'));
      await page.locator('.farming-close').click();
      // Unsafe source markup and unsupported link protocols remain text in the popup.
      await predict({ usage_guide: '**Usage**', cultivation_guide: '# 8. Example\n\n<img src=x onerror="window.injected=true">\n\n[bad](javascript:alert(1))\n\n**Safe**' });
      await page.locator('[data-guide="cultivation"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.farming-body img, .farming-body a').count(), 0);
      assert.equal(await page.evaluate(() => window.injected), undefined);
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
      }
      await page.mouse.click(1, 1);
      await page.waitForFunction(() => !document.body.classList.contains('farming-modal-open'));
      assert.equal(await page.locator('#farming-dialog').isVisible(), false);
      await page.locator('[data-guide="cultivation"]').click();
      assert.equal(await page.locator('.farming-body').evaluate(el => el.scrollTop), 0);
      await page.locator('.farming-close').click();
      // Each feature remains usable if only the other guide is absent.
      await predict({ usage_guide: '**Usage only**' });
      await page.locator('[data-guide="usage"]').click();
      assert.ok((await page.locator('#guide-usage').innerText()).includes('Usage only'));
      await page.locator('[data-guide="cultivation"]').click();
      assert.ok((await page.locator('.farming-body').innerText()).includes('chưa được bổ sung'));
      await page.locator('.farming-close').click();
      await predict({ cultivation_guide: '# 1. Farming only' });
      await page.locator('[data-guide="usage"]').click();
      assert.ok((await page.locator('#guide-usage').innerText()).includes('Chưa có hướng dẫn'));
      await page.locator('[data-guide="cultivation"]').click();
      assert.ok((await page.locator('.farming-body').innerText()).includes('Farming only'));
      await page.locator('.farming-close').click();
      for (const status of ['uncertain', 'unknown']) {
        await predict(null, 'Example', status);
        assert.equal(await page.locator('.plant-guides').count(), 0);
      }
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`${mobile ? 'Mobile' : 'Desktop'}: both complete guides for all 21 species, inline/modal switching, links, scrolling, dismissal, focus, reset, fallbacks and escaping passed.`);
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
