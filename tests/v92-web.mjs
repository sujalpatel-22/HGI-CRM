#!/usr/bin/env node
// v9.2 tests: design / accessibility regressions, global search, quick invoice, dashboard widgets, register filters + bulk
// actions, performance budgets with a 5,000-invoice book, large-book persistence (IndexedDB), and GST engine parity
// between the app (computeDoc) and the server (backend/lib/gst-calc.js) on thousands of random documents.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WWW = path.join(root, 'www'), OUT = path.join(root, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const serverCalc = require('../backend/lib/gst-calc.js');
const CI = !!process.env.CI;

let failures = 0, passes = 0;
const lines = [];
const check = (cond, msg) => { const l = `${cond ? '✓' : '✗'} ${msg}`; lines.push(l); if (cond) passes++; else failures++; console.log('   ' + l); };
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', png: 'image/png', svg: 'image/svg+xml', json: 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html')));
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const BIG = path.join(root, 'tests', 'lib', 'big-book.js'), A11Y = path.join(root, 'tests', 'lib', 'a11y.js');
const browser = await chromium.launch();
const errors = [];

async function openApp({ width = 412, height = 915, mobile = true, theme = 'light', invoices = 300, ctx } = {}) {
  const context = ctx || await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: theme, acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(base); await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 30000 });
  if (await page.isVisible('#login-username')) { await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]'); }
  await page.addScriptTag({ path: BIG }); await page.addScriptTag({ path: A11Y });
  if (invoices !== null) await page.evaluate(([n, th]) => { const ob = document.getElementById('onboarding'); if (ob) ob.remove(); state.ui.onboarded = true; window.__bigBook({ invoices: n }); saveState(); HGI_M.setTheme(th); renderAll(); switchTab('dashboard'); }, [invoices, theme]);
  return page;
}
const settle = p => p.waitForTimeout(450);
const dlgClick = async (page, label) => { await page.click(`.acct-dlg button:has-text("${label}")`); };

/* ---------------------------------------------------------------- 1. accessibility on every main screen */
console.log('\n▶ Accessibility (labels, names, contrast, tap targets) — light and dark');
for (const theme of ['light', 'dark']) {
  const page = await openApp({ theme, invoices: 200 });
  for (const tab of ['dashboard', 'invoices', 'customers', 'items', 'returns', 'settings', 'create-invoice']) {
    await page.evaluate(t => { switchTab(t); window.scrollTo(0, 0); }, tab); await page.waitForTimeout(900);
    const found = { unnamed: new Set(), unlabeled: new Set(), smallTargets: new Set(), lowContrast: new Set() };
    for (const y of [0, 900, 1800]) { await page.evaluate(y => window.scrollTo(0, y), y); await page.waitForTimeout(200); const r = await page.evaluate(() => window.__a11y({})); Object.keys(found).forEach(k => r[k].forEach(x => found[k].add(x))); }
    const bad = Object.entries(found).flatMap(([k, s]) => [...s].map(x => `${k}: ${x}`));
    check(bad.length === 0, `${theme} ${tab}: no unnamed controls, unlabelled fields, low-contrast text or tap targets < 32 px${bad.length ? ' — ' + bad.slice(0, 4).join(' | ') : ''}`);
  }
  // dialogs and the search sheet
  await page.evaluate(() => { HGI_FLOW.open('pump'); }); await page.waitForTimeout(300);
  const s = await page.evaluate(() => window.__a11y({ root: document.getElementById('gsearch') }));
  check(!s.unnamed.length && !s.unlabeled.length && !s.lowContrast.length, `${theme} search sheet passes the same checks ${JSON.stringify(s).slice(0, 200)}`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { switchTab('invoices'); HGI_FLOW.openFilters(); }); await page.waitForSelector('.acct-dlg');
  const f = await page.evaluate(() => window.__a11y({ root: document.querySelector('.acct-dlg') }));
  check(!f.unnamed.length && !f.unlabeled.length && !f.lowContrast.length, `${theme} filter dialog passes ${JSON.stringify(f).slice(0, 200)}`);
  await dlgClick(page, 'Cancel');
  await page.context().close();
}

/* ---------------------------------------------------------------- 2. layout regressions found in the audit */
console.log('\n▶ Layout');
for (const [w, h] of [[1366, 900], [1180, 820], [800, 1280], [412, 915], [360, 640]]) {
  const page = await openApp({ width: w, height: h, mobile: w < 768, invoices: 1500 });
  await page.evaluate(() => { switchTab('dashboard'); }); await page.waitForTimeout(1600);   // after the count-up animation
  const r = await page.evaluate(() => {
    const box = e => e.getBoundingClientRect();
    const amt = document.querySelector('#hero .hero-amount'), aging = document.querySelector('#hero .hero-aging');
    const legend = [...document.querySelectorAll('#hero .hero-legend > div b')];
    const over = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
    const lg = legend.map(box);
    const clipped = [amt, ...legend, ...document.querySelectorAll('#hero .age b, .kpi-v')].filter(e => e && e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent);
    return { amtAging: amt && aging ? over(box(amt), box(aging)) : false, legendOverlap: lg.some((a, i) => lg.some((b, j) => i < j && over(a, b))), clipped, amount: amt && amt.textContent };
  });
  check(!r.amtAging && !r.legendOverlap && !r.clipped.length, `${w}px: crore amount (${r.amount}) and legend fit their boxes — no overlap, nothing cut off ${r.clipped.join(', ')}`);
  if (w < 768) {
    await page.evaluate(() => { newDocument('INV'); }); await settle(page);
    const seg = await page.evaluate(() => { const b = [...document.querySelectorAll('#doc-seg button')]; return { n: b.length, rows: new Set(b.map(x => x.offsetTop)).size, h: Math.max(...b.map(x => x.offsetHeight)) }; });
    check(seg.n === 7 && seg.rows === 1 && seg.h >= 40, `${w}px: document types in one scrollable row of 7 chips (rows ${seg.rows}, height ${seg.h})`);
    await page.click('#doc-seg button[data-v="PO"]'); await settle(page);
    const vis = await page.evaluate(() => { const s = document.getElementById('doc-seg'), b = s.querySelector('button.on'); const r = b.getBoundingClientRect(), sr = s.getBoundingClientRect(); return r.left >= sr.left - 1 && r.right <= sr.right + 1; });
    check(vis, `${w}px: the chosen chip (Purchase order) is scrolled into view`);
    await page.evaluate(() => editInvoice(state.invoices[0].id)); await settle(page);
    const title = await page.$eval('#mobile-page-title', e => e.textContent);
    check(/^Edit/.test(title), `${w}px: header says "${title}" while editing (was "New Invoice")`);
    const hdr = await page.evaluate(() => { const c = getComputedStyle(document.querySelector('#app-container > header')).backgroundColor; const m = c.match(/[\d.]+/g).map(Number); return m.length > 3 ? m[3] : 1; });
    check(hdr >= 0.95, `${w}px: sticky header is opaque enough that text does not show through (alpha ${hdr})`);
  }
  await page.context().close();
}

/* ---------------------------------------------------------------- 3. global search + quick invoice */
console.log('\n▶ Global search');
{
  const page = await openApp({ invoices: 800 });
  await page.keyboard.press('Control+k');
  check(await page.isVisible('#gsearch.open') && await page.evaluate(() => document.activeElement.id === 'gs-input'), 'Ctrl+K opens search with the cursor in the field');
  await page.keyboard.press('Escape');
  check(!(await page.isVisible('#gsearch.open')), 'Esc closes it');
  await page.click('#gs-btn');
  const empty = await page.$$eval('#gs-list .gs-g', g => g.map(x => x.textContent));
  check(empty.some(x => /Actions/.test(x)), 'empty search offers actions');
  const target = await page.evaluate(() => state.invoices[37]);
  await page.fill('#gs-input', target.num); await page.waitForTimeout(150);
  const first = await page.$eval('#gs-list .gs-r.on b', e => e.textContent);
  check(first === target.num, `document number ${target.num} is the top result`);
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  check(await page.evaluate(n => currentEditId && state.invoices.find(d => d.id === currentEditId).num === n, target.num), 'Enter opens it');
  // amount search, multi-word
  await page.evaluate(() => HGI_FLOW.open('')); await page.fill('#gs-input', String(Math.round(target.grandTotal))); await page.waitForTimeout(150);
  check((await page.$$eval('#gs-list .gs-r b', e => e.map(x => x.textContent))).includes(target.num), 'amount finds the document');
  const buyer = await page.evaluate(() => state.customers.find(c => c.partyType !== 'supplier' && state.invoices.some(d => d.buyerName === c.name && d.docType === 'INV')));
  const words = buyer.name.split(' ');
  await page.fill('#gs-input', `${words[0].slice(0, 3)} ${words[1].slice(0, 4)}`.toLowerCase()); await page.waitForTimeout(150);
  const names = await page.$$eval('#gs-list .gs-r b', e => e.map(x => x.textContent));
  check(names.includes(buyer.name), `partial words "${words[0].slice(0, 3)} ${words[1].slice(0, 4)}" find buyer ${buyer.name}`);
  // buyer → new invoice with the buyer filled in
  await page.fill('#gs-input', buyer.name); await page.waitForTimeout(150);
  await page.evaluate(n => { const rows = [...document.querySelectorAll('#gs-list .gs-r')]; const r = rows.find(x => x.querySelector('b').textContent === n); r.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); }, buyer.name);
  await page.click('#gs-list .gs-r.on [data-sub="0"]'); await page.waitForTimeout(400);
  const f = await page.evaluate(() => ({ type: $('inv-doc-type').value, name: $('inv-buyer-name').value, gstin: $('inv-buyer-gstin').value, edit: currentEditId }));
  check(f.type === 'INV' && f.name === buyer.name && f.gstin === (buyer.gstin || '') && !f.edit, 'buyer result → "New invoice": a new invoice with the buyer\'s details filled in');
  // product while the editor is open → added to the invoice
  const prod = await page.evaluate(() => state.products.find(p => /Monoblock Pump 1HP/.test(p.name)) || state.products[3]);
  await page.evaluate(() => HGI_FLOW.open('')); await page.fill('#gs-input', prod.name); await page.waitForTimeout(150);
  const g0 = await page.$eval('#gs-list .gs-g', e => e.textContent);
  check(/Products/.test(g0), 'while an invoice is open, products come first');
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const rows = await page.evaluate(() => collectFormItems().map(i => [i.desc, i.rate, i.gst]));
  check(rows.length === 1 && rows[0][0] === prod.name && rows[0][1] === prod.rate && rows[0][2] === prod.gst, `product "${prod.name}" added with its rate and GST (${JSON.stringify(rows)})`);
  const recent = await page.evaluate(() => { HGI_FLOW.open(''); return [...document.querySelectorAll('#gs-list .gs-r b')].map(b => b.textContent); });
  check(recent.includes(target.num) && recent.includes(buyer.name) && recent.includes(prod.name), 'recent items: the opened document, buyer and product');
  await page.keyboard.press('Escape');
  await page.evaluate(() => HGI_FLOW.open('')); await page.fill('#gs-input', 'zzqqxx no such thing'); await page.waitForTimeout(150);
  check(/Nothing found/.test(await page.$eval('#gs-list', e => e.textContent)), 'no match: a clear empty state');
  await page.fill('#gs-input', 'gst return'); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  check(await page.evaluate(() => !document.getElementById('tab-returns').classList.contains('hidden')), 'actions: "gst return" + Enter opens GST Returns');
  // keyboard navigation
  await page.evaluate(() => HGI_FLOW.open('pump')); await page.waitForTimeout(150);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  check(await page.evaluate(() => document.querySelector('#gs-list .gs-r.on').dataset.r === '2' && document.getElementById('gs-input').getAttribute('aria-activedescendant') === 'gs-o2'), 'arrow keys move the highlighted result (and tell screen readers)');
  await page.keyboard.press('Escape');
  // speed with a big book
  await page.evaluate(() => { window.__bigBook({ invoices: 5000, buyers: 400, products: 600 }); });
  const ms = await page.evaluate(() => { HGI_FLOW.open(''); const inp = document.getElementById('gs-input'); const t0 = performance.now(); for (const q of ['pump', 'royal ent', '24aa', '1,180', 'dwc 110']) { inp.value = q; inp.dispatchEvent(new Event('input')); window.__lastRun = q; } return performance.now() - t0; });
  const one = await page.evaluate(() => { const a = performance.now(); HGI_FLOW.open('monoblock pump'); return performance.now() - a; });
  check(one < (CI ? 400 : 150), `search over 5,000 documents + 600 products: ${Math.round(one)} ms per query (budget ${CI ? 400 : 150} ms)`); void ms;
  await page.keyboard.press('Escape');
  // quick invoice / repeat last from the buyers list
  await page.evaluate(() => { window.__bigBook({ invoices: 300 }); saveState(); renderAll(); switchTab('customers'); });
  const b2 = await page.evaluate(() => state.customers.find(c => c.partyType !== 'supplier' && state.invoices.some(d => d.buyerName === c.name && d.docType === 'INV' && !d.cancelled)));
  await page.evaluate(id => HGI_FLOW.quickInvoice(id), b2.id); await settle(page);
  check(await page.evaluate(n => $('inv-buyer-name').value === n && $('inv-doc-type').value === 'INV', b2.name), 'buyer row action: new invoice for the buyer');
  const last = await page.evaluate(n => { const l = state.invoices.filter(d => d.buyerName === n && d.docType === 'INV' && !d.cancelled).sort((a, b) => (a.date < b.date ? 1 : -1))[0]; return { num: l.num, items: l.items.map(i => i.desc) }; }, b2.name);
  await page.evaluate(id => HGI_FLOW.repeatLast(id), b2.id); await settle(page);
  const rep = await page.evaluate(() => ({ items: collectFormItems().map(i => i.desc), edit: currentEditId, num: $('inv-num').value }));
  check(JSON.stringify(rep.items) === JSON.stringify(last.items) && !rep.edit && rep.num !== last.num, `"Repeat last" copies ${last.num}'s items into a new invoice with a new number (${rep.num})`);
  await page.screenshot({ path: path.join(OUT, 'v92-quick-invoice.png') });
  await page.context().close();
}

/* ---------------------------------------------------------------- 4. dashboard widgets */
console.log('\n▶ Dashboard widgets');
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: 'light' });
  let page = await openApp({ ctx, invoices: 200 });
  await page.evaluate(() => { HGI_FLOW.customizeDashboard(); }); await page.waitForSelector('#wd-list');
  await page.uncheck('#wd-list input[data-k="b-ring"]');
  await page.click('#wd-list [data-up="b-recent"]'); await page.click('#wd-list [data-up="b-recent"]');
  await dlgClick(page, 'Save'); await settle(page);
  const st = await page.evaluate(() => ({ ring: getComputedStyle(document.querySelector('#bento > .b-ring')).display, recent: Number(document.querySelector('#bento > .b-recent').style.order), flow: Number(document.querySelector('#bento > .b-flow').style.order) }));
  check(st.ring === 'none' && st.recent < st.flow, `hidden widget disappears, moved widget moves (recent ${st.recent} before cash flow ${st.flow})`);
  await page.reload(); await page.waitForFunction(() => window.HGI_READY === true);
  if (await page.isVisible('#login-username')) { await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]'); }
  await settle(page);
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#bento > .b-ring')).display === 'none'), 'layout kept after restart');
  await page.screenshot({ path: path.join(OUT, 'v92-dashboard-custom.png') });
  await page.evaluate(() => { HGI_FLOW.customizeDashboard(); }); await page.waitForSelector('#wd-list');
  await page.evaluate(() => document.querySelectorAll('#wd-list input').forEach(i => { if (i.checked) i.click(); }));
  await dlgClick(page, 'Save'); await settle(page);
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#bento > .b-hero')).display !== 'none'), 'cannot hide every widget');
  await page.evaluate(() => { HGI_FLOW.customizeDashboard(); }); await page.waitForSelector('#wd-list'); await dlgClick(page, 'Reset'); await settle(page);
  check(await page.evaluate(() => !document.getElementById('bento').classList.contains('custom') && getComputedStyle(document.querySelector('#bento > .b-ring')).display !== 'none'), 'Reset restores the standard dashboard');
  await ctx.close();
}

/* ---------------------------------------------------------------- 5. register: filters, sort, bulk */
console.log('\n▶ Document register: filters, sort, bulk actions');
{
  const page = await openApp({ invoices: 600 });
  await page.evaluate(() => switchTab('invoices'));
  const buyer = await page.evaluate(() => { const m = {}; state.invoices.forEach(d => { m[d.buyerName] = (m[d.buyerName] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1])[0]; });
  await page.click('#doc-filter-btn'); await page.waitForSelector('#adv-buyer');
  await page.fill('#adv-buyer', buyer[0]); await page.fill('#adv-min', '10000'); await page.selectOption('#adv-sort', 'high');
  await dlgClick(page, 'Apply'); await settle(page);
  const r = await page.evaluate(() => { const l = getFilteredInvoices(); return { n: l.length, names: [...new Set(l.map(d => d.buyerName))], min: Math.min(...l.map(d => d.grandTotal)), sorted: l.every((d, i) => !i || l[i - 1].grandTotal >= d.grandTotal), rows: document.querySelectorAll('#invoices-list-tbody tr[data-id]').length }; });
  const expect = await page.evaluate(n => state.invoices.filter(d => d.buyerName === n && d.grandTotal >= 10000).length, buyer[0]);
  check(r.n === expect && r.names.length === 1 && r.min >= 10000 && r.sorted && r.rows === Math.min(r.n, 150), `buyer + amount ≥ ₹10,000 + sorted high→low: ${r.n} documents (expected ${expect})`);
  check((await page.$$eval('#doc-adv-pills .adv-pill', p => p.length)) === 4, 'active filters shown as removable pills (+ clear all)');
  await page.click('#doc-adv-pills .adv-pill[data-k="min"]'); await settle(page);
  check(await page.evaluate(n => getFilteredInvoices().length === state.invoices.filter(d => d.buyerName === n).length, buyer[0]), 'removing a pill removes that filter only');
  await page.click('#doc-adv-pills .adv-pill.clear'); await settle(page);
  check(await page.evaluate(() => getFilteredInvoices().length === state.invoices.length), '"Clear all" shows everything again');
  await page.click('#doc-filter-btn'); await page.waitForSelector('#adv-kind'); await page.selectOption('#adv-kind', 'inter'); await dlgClick(page, 'Apply'); await settle(page);
  check(await page.evaluate(() => { const l = getFilteredInvoices(); return l.length > 0 && l.every(d => d.isInter && d.igst >= 0 && d.cgst === 0); }), 'supply filter "Other state (IGST)" shows IGST documents only');
  await page.click('#doc-filter-btn'); await page.waitForSelector('#adv-min'); await page.fill('#adv-min', '9000'); await page.fill('#adv-max', '10');
  await dlgClick(page, 'Apply'); await settle(page);
  check(/"Amount from" is more than/.test(await page.$eval('#toast-container', e => e.textContent)), 'impossible amount range is refused with a message');
  await page.evaluate(() => { window.__docAdv = {}; renderInvoiceList(); });
  // search in the register: all words must match
  await page.fill('#inv-search', `${buyer[0].split(' ')[0]} ${buyer[0].split(' ')[1]}`); await page.dispatchEvent('#inv-search', 'input'); await settle(page);
  check(await page.evaluate(n => getFilteredInvoices().every(d => d.buyerName.toLowerCase().includes(n.split(' ')[0].toLowerCase())), buyer[0]), 'register search matches every word');
  await page.fill('#inv-search', ''); await page.dispatchEvent('#inv-search', 'input');
  // bulk selection
  await page.evaluate(() => { $('inv-filter-type').value = 'INV'; $('inv-filter-status').value = 'Unpaid'; renderInvoiceList(); });
  await page.click('#doc-select-btn');
  const ids = await page.$$eval('#invoices-list-tbody tr[data-id]', r => r.slice(0, 3).map(x => x.dataset.id));
  for (const id of ids) await page.click(`#invoices-list-tbody tr[data-id="${id}"]`);
  check((await page.$eval('#bulk-bar .bb-n', e => e.textContent)).startsWith('3'), 'tapping rows selects them (3 selected), without opening them');
  check(await page.evaluate(() => !document.getElementById('preview-section') || document.getElementById('preview-section').classList.contains('hidden')), 'no document was opened by the taps');
  const dl = page.waitForEvent('download');
  await page.click('#bulk-bar [data-b="csv"]');
  const file = await dl; const csv = fs.readFileSync(await file.path(), 'utf8');
  const nums = await page.evaluate(ids => ids.map(id => state.invoices.find(d => d.id === id).num), ids);
  check(csv.split('\r\n').length === 4 && nums.every(n => csv.includes(n)), 'CSV of the selected documents (header + 3 rows)');
  const before = await page.evaluate(ids => ids.map(id => { const d = state.invoices.find(x => x.id === id); return { bal: balanceOf(d), pays: d.payments.length }; }), ids);
  await page.click('#bulk-bar [data-b="paid"]'); await page.waitForSelector('#bp-mode');
  await page.selectOption('#bp-mode', 'UPI'); await dlgClick(page, 'Record'); await settle(page);
  const after = await page.evaluate(ids => ids.map(id => { const d = state.invoices.find(x => x.id === id); return { bal: balanceOf(d), pays: d.payments.length, last: d.payments[d.payments.length - 1] }; }), ids);
  check(after.every((a, i) => a.bal === 0 && a.pays === before[i].pays + 1 && a.last.mode === 'UPI' && Math.abs(a.last.amount - before[i].bal) < 0.005), 'Mark paid: one receipt for the exact balance on each, balance now 0');
  await page.evaluate(() => { window.__bigBook({ invoices: 50 }); state.invoices.filter(d => d.docType === 'INV').slice(0, 2).forEach(d => { d.payments = []; d.items = [{ desc: 'Big order', hsn: '84137010', gst: 18, qty: 100, unit: 'NOS', rate: 2500 }]; Object.assign(d, totalsOf(computeDoc(d))); }); saveState(); $('inv-filter-type').value = ''; $('inv-filter-status').value = ''; renderInvoiceList(); });
  const big = await page.evaluate(() => state.invoices.filter(d => d.docType === 'INV' && balanceOf(d) >= 200000).slice(0, 1).map(d => d.id));
  await page.click('#bulk-bar [data-b="all"]'); await page.click('#bulk-bar [data-b="all"]');
  await page.click(`#invoices-list-tbody tr[data-id="${big[0]}"]`);
  await page.click('#bulk-bar [data-b="paid"]'); await page.waitForSelector('#bp-mode'); await page.selectOption('#bp-mode', 'Cash'); await dlgClick(page, 'Record'); await settle(page);
  check(await page.evaluate(id => balanceOf(state.invoices.find(d => d.id === id)) >= 200000, big[0]) && /269ST/.test(await page.$eval('#toast-container', e => e.textContent)), 'cash receipt of ₹2 lakh or more is refused (Sec 269ST)');
  await page.screenshot({ path: path.join(OUT, 'v92-bulk.png') });
  await page.click('#bulk-bar [data-b="x"]');
  check(!(await page.$('#bulk-bar')), 'leaving selection mode removes the bar');
  await page.context().close();
}

/* ---------------------------------------------------------------- 6. performance budgets (5,000 invoices) */
console.log('\n▶ Performance with 5,000 invoices, 400 buyers, 600 products');
const bench = {};
{
  const page = await openApp({ invoices: null });
  const m = await page.evaluate(() => {
    const ob = document.getElementById('onboarding'); if (ob) ob.remove(); state.ui.onboarded = true;
    window.__bigBook({ invoices: 5000, buyers: 400, products: 600 }); saveState();
    const t = (f, n = 3) => { const a = []; for (let i = 0; i < n; i++) { const s = performance.now(); f(); a.push(performance.now() - s); } return Math.round(a.sort((x, y) => x - y)[Math.floor(n / 2)]); };
    return { renderAll: t(() => renderAll()), dashboard: t(() => renderDashboard()), items: t(() => renderItemList()), register: t(() => renderInvoiceList()), buyers: t(() => renderCustomerList()), save: t(() => saveState()),
      search: t(() => { $('inv-search').value = 'pump royal'; renderInvoiceList(); }), returns: t(() => { if (typeof renderReturns === 'function') renderReturns(); }), bytes: JSON.stringify(state).length };
  });
  Object.assign(bench, m);
  const k = CI ? 3 : 1;
  check(m.renderAll < 1000 * k, `all screens render in ${m.renderAll} ms (budget ${1000 * k}; was 2,354 ms before v9.2)`);
  check(m.items < 300 * k, `products & stock: ${m.items} ms (budget ${300 * k}; was 1,679 ms)`);
  check(m.dashboard < 500 * k, `dashboard: ${m.dashboard} ms (budget ${500 * k}; was 857 ms)`);
  check(m.register < 200 * k && m.search < 250 * k, `document register: ${m.register} ms, search: ${m.search} ms`);
  await page.waitForTimeout(1500);   // the IndexedDB copy is written 0.8 s after a save
  const t0 = Date.now(); await page.reload(); await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 60000 }); bench.boot = Date.now() - t0;
  if (await page.isVisible('#login-username')) { await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]'); }
  const n = await page.evaluate(() => state.invoices.length);
  check(n === 5000, `start-up with the 5.6 MB book: ${bench.boot} ms, all ${n} invoices back`);
  // tap → next painted frame, median of 3 rounds
  const sw = await page.evaluate(async () => { const all = {}; for (let k = 0; k < 3; k++) for (const tb of ['invoices', 'customers', 'items', 'returns', 'dashboard']) { const a = performance.now(); switchTab(tb); await new Promise(x => requestAnimationFrame(() => setTimeout(x))); (all[tb] = all[tb] || []).push(performance.now() - a); }
    const r = {}; Object.entries(all).forEach(([k, v]) => { r[k] = Math.round(v.sort((x, y) => x - y)[1]); }); return r; });
  bench.switchTab = sw;
  check(Object.values(sw).every(v => v < (CI ? 1200 : 400)), `tab switches (tap → painted, median of 3): ${JSON.stringify(sw)} ms (budget ${CI ? 1200 : 400})`);
  await page.context().close();
}

/* ---------------------------------------------------------------- 7. big books survive (web: IndexedDB copy) */
console.log('\n▶ Large book persistence');
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  let page = await openApp({ ctx, invoices: null });
  const w = await page.evaluate(() => { const ob = document.getElementById('onboarding'); if (ob) ob.remove(); state.ui.onboarded = true; window.__bigBook({ invoices: 6500, buyers: 400, products: 600 }); window.__storageWarned = false; saveState(); state.invoices[5].buyerName = 'EDIT AFTER STORAGE FULL'; saveState(); return { warned: !!window.__storageWarned, size: JSON.stringify(state).length }; });
  const toastTxt = await page.$eval('#toast-container', e => e.textContent).catch(() => '');
  check(w.warned && /database instead/.test(toastTxt), `6,500 invoices (${(w.size / 1e6).toFixed(1)} MB) is over the 5 MB quick-storage limit; the user is told the data is kept in the browser database`);
  await page.waitForTimeout(1500);
  await page.reload(); await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 60000 });
  if (await page.isVisible('#login-username')) { await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]'); }
  const back = await page.evaluate(() => ({ n: state.invoices.length, edit: state.invoices[5].buyerName }));
  check(back.n === 6500 && back.edit === 'EDIT AFTER STORAGE FULL', `after restart: ${back.n} invoices and the last edit are there (before v9.2 the edit was lost)`);
  // a tab closed right after a change: the copy is written when the page is hidden
  await page.evaluate(() => { state.invoices[6].buyerName = 'CLOSED AT ONCE'; saveState(); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
  await page.waitForTimeout(600);
  await page.close(); page = await ctx.newPage(); page.on('dialog', d => d.accept());
  await page.goto(base); await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 60000 });
  if (await page.isVisible('#login-username')) { await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]'); }
  check(await page.evaluate(() => state.invoices[6].buyerName === 'CLOSED AT ONCE'), 'a change made just before closing the tab is kept');
  await ctx.close();
}

/* ---------------------------------------------------------------- 8. GST engine parity: app vs server */
console.log('\n▶ GST calculation: app (computeDoc) = server (gst-calc) on random documents');
{
  const page = await openApp({ invoices: null });
  const N = 4000;
  const docs = await page.evaluate(N => {
    let s = 42; const r = () => (s = (s * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(r() * a.length)];
    const units = ['NOS', 'Nos', 'pcs', 'KG', 'kgs', 'MTR', 'm', 'SET', 'box', 'LTR', 'OTH', 'Hrs'];
    const out = [];
    for (let i = 0; i < N; i++) {
      const st = pick(['B2B', 'B2B', 'B2C', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP']);
      const items = Array.from({ length: 1 + Math.floor(r() * 7) }, () => ({ desc: 'x', hsn: pick(['8413', '84137010', '3917', '9987', '7307']), gst: pick([0, 5, 12, 18, 28, 40, 3, 0.25]), qty: Math.round(r() * 5000) / (pick([1, 10, 1000])), unit: pick(units), rate: Math.round(r() * 1e6) / pick([1, 100, 1000]) }));
      const d = { docType: 'INV', supplyType: st, pos: pick(['24', '27', '08', '', '96', '7']), reverseCharge: r() > 0.9, items, discount: r() > 0.7 ? Math.round(r() * 5000) / 100 : 0, pfCharges: r() > 0.7 ? Math.round(r() * 2000) : 0, otherCharges: r() > 0.8 ? Math.round(r() * 1500) / 10 : 0 };
      const c = computeDoc(d, { stateCode: '24' });
      out.push({ d, c: { taxable: c.taxable, cgst: c.cgst, sgst: c.sgst, igst: c.igst, roundoff: c.roundoff, grandTotal: c.grandTotal, isInter: c.isInter } });
    }
    return out;
  }, N);
  let mism = [];
  for (const { d, c } of docs) {
    const s = serverCalc.computeDoc(d, '24');
    const k = ['taxable', 'cgst', 'sgst', 'igst', 'roundoff', 'grandTotal', 'isInter'];
    if (k.some(x => (typeof c[x] === 'number' ? Math.abs(c[x] - s[x]) > 0.0049 : c[x] !== s[x]))) mism.push({ d: JSON.stringify(d).slice(0, 160), app: c, server: k.reduce((o, x) => (o[x] = s[x], o), {}) });
  }
  check(mism.length === 0, `${N} random documents (8 supply types, 8 GST rates incl. 0.25 / 3 / 40 %, units, discounts, charges, reverse charge): app and server agree to the paisa${mism.length ? ' — ' + mism.length + ' differ, e.g. ' + JSON.stringify(mism[0]) : ''}`);
  // fixed cases checked by hand
  const fixed = await page.evaluate(() => [
    computeDoc({ supplyType: 'B2B', pos: '24', items: [{ qty: 2, rate: 5000, gst: 18 }] }, { stateCode: '24' }),
    computeDoc({ supplyType: 'B2B', pos: '27', items: [{ qty: 2, rate: 5000, gst: 18 }] }, { stateCode: '24' }),
    computeDoc({ supplyType: 'EXPWOP', pos: '96', items: [{ qty: 1, rate: 100000, gst: 18 }] }, { stateCode: '24' }),
    computeDoc({ supplyType: 'B2B', pos: '24', reverseCharge: true, items: [{ qty: 1, rate: 10000, gst: 5 }] }, { stateCode: '24' }),
    computeDoc({ supplyType: 'B2B', pos: '24', discount: 100, pfCharges: 250, items: [{ qty: 3, rate: 333.33, gst: 18 }, { qty: 1, rate: 99.99, gst: 5 }] }, { stateCode: '24' })
  ].map(c => [c.taxable, c.cgst, c.sgst, c.igst, c.roundoff, c.grandTotal]));
  check(JSON.stringify(fixed[0]) === JSON.stringify([10000, 900, 900, 0, 0, 11800]), 'intra-state 2 × ₹5,000 @ 18 %: CGST 900 + SGST 900 = ₹11,800');
  check(JSON.stringify(fixed[1]) === JSON.stringify([10000, 0, 0, 1800, 0, 11800]), 'inter-state: IGST 1,800');
  check(JSON.stringify(fixed[2]) === JSON.stringify([100000, 0, 0, 0, 0, 100000]), 'export under LUT: zero-rated');
  check(fixed[3][5] === 10000 && fixed[3][1] === 250, 'reverse charge: tax shown (CGST 250) but not added to the total');
  check(Math.abs(fixed[4][0] - (999.99 + 99.99 - 100 + 250)) < 0.011 && Number.isInteger(fixed[4][5]), `discount + packing apportioned; total rounded to the rupee (${fixed[4].join(', ')})`);
  await page.context().close();
}

check(errors.length === 0, `no script errors${errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''}`);
await browser.close(); server.close();
fs.writeFileSync(path.join(OUT, 'v92-bench.json'), JSON.stringify(bench, null, 1));
fs.writeFileSync(path.join(OUT, 'v92-results.txt'), lines.join('\n') + `\n\n${passes} passed, ${failures} failed\n`);
console.log('\nbenchmarks', JSON.stringify(bench));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
