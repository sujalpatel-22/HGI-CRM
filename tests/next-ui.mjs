import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(root, 'www');
const out = path.join(root, 'tests', 'next-out');
fs.mkdirSync(out, { recursive: true });
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf' };
const server = http.createServer((req, res) => {
  const relative = new URL(req.url, 'http://localhost').pathname.replace(/^\//, '') || 'index.html';
  const file = path.resolve(www, relative);
  if (!file.startsWith(www + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file).slice(1)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
let checks = 0;
try {
  for (const width of (process.env.HGI_UI_WIDTHS || '360,412,800,1440').split(',').map(Number)) {
    const context = await browser.newContext({ viewport: { width, height: width < 768 ? 850 : 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.waitForFunction(() => window.HGI_READY);
    await page.evaluate(() => {
      const seed = HGI_DEMO_DATA.build();
      seed.company.name = 'Hariguru Industries';
      seed.ui.demo = false; seed.ui.lang = 'en'; seed.ui.theme = 'light';
      localStorage.setItem('hgi_billing_v7_prod', JSON.stringify(seed));
      sessionStorage.setItem('hgi_auth_session', 'true');
    });
    await page.reload(); await page.waitForFunction(() => window.HGI_READY);
    await page.waitForTimeout(700);
    await page.evaluate(() => { document.querySelectorAll('#toast-container > *').forEach(e => e.remove()); window.scrollTo(0, 0); });
    assert(await page.evaluate(() => !!document.querySelector('html.hgi-next') && HGI_APP.version === '8.1.0')); checks++;
    assert(await page.evaluate(() => getComputedStyle(document.body).backgroundColor === 'rgb(245, 247, 251)')); checks++;
    assert(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1)); checks++;
    await page.screenshot({ path: path.join(out, `${width}-dashboard.png`), fullPage: width >= 768 });
    await page.locator('.nx-collect').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.click('.nx-collect');
    assert(await page.evaluate(() => $('inv-filter-status').value === 'Outstanding' && getFilteredInvoices().length > 0 && getFilteredInvoices().every(d => !d.cancelled && balanceOf(d) > 0.009))); checks++;
    await page.fill('#inv-search', 'no-such-buyer-98765');
    await page.waitForTimeout(150);
    assert(await page.locator('.nx-empty').isVisible()); checks++;
    await page.screenshot({path:path.join(out, `${width}-empty.png`)});
    await page.click('.nx-empty button');
    assert(await page.evaluate(() => !$('inv-search').value && !$('inv-filter-status').value)); checks++;
    await page.screenshot({ path: path.join(out, `${width}-documents.png`), fullPage: false });
    await page.evaluate(() => newDocument('INV'));
    await page.fill('#inv-buyer-name', 'Acme Engineering');
    await page.fill('#inv-buyer-address', 'GIDC Naroda, Ahmedabad');
    await page.evaluate(() => { $('inv-buyer-state-code').value = '24'; onBuyerStateCodeInput(); });
    const row = page.locator('#invoice-items-body tr').first();
    await row.locator('.item-desc').fill('Industrial Fastener Kit (Sample)');
    await row.locator('.item-desc').dispatchEvent('change');
    await page.waitForTimeout(300);
    await page.evaluate(() => { document.querySelectorAll('#toast-container > *').forEach(e => e.remove()); scrollTo(0, 0); });
    await page.screenshot({ path: path.join(out, `${width}-editor.png`), fullPage: false });
    assert(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1)); checks++;
    await page.evaluate(() => switchTab('items'));
    await page.screenshot({ path: path.join(out, `${width}-items.png`), fullPage: false });
    await page.evaluate(() => switchTab('settings'));
    await page.screenshot({ path: path.join(out, `${width}-settings.png`), fullPage: false });
    await page.evaluate(() => { HGI_M.setTheme('dark'); switchTab('dashboard'); scrollTo(0, 0); });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, `${width}-dark.png`), fullPage: false });
    assert.deepEqual(errors, []); checks++;
    console.log(`${width}px: redesigned screens and interactions passed`);
    await context.close();
  }
  console.log(`${checks} redesign checks passed`);
} finally { await browser.close(); server.close(); }
