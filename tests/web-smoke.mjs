#!/usr/bin/env node
// End-to-end test of the bundled web app (www/) in Chromium at phone, tablet and desktop sizes.
// Runs in CI after `npm run build:web`. Exit code 1 on any failure. Screenshots → tests/out/
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(root, 'www');
const OUT = path.join(root, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const LOCAL_TW = process.env.HGI_LOCAL_TAILWIND_RUNTIME;   // dev-only: path to the Tailwind v3 play runtime when the CLI isn't available

const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', png: 'image/png', svg: 'image/svg+xml', json: 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html')));
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const VIEWPORTS = [
  { name: 'phone-small-360', width: 360, height: 640, mobile: true },
  { name: 'phone-large-412', width: 412, height: 915, mobile: true },
  { name: 'tablet-800', width: 800, height: 1280, mobile: false },
  { name: 'desktop-1366', width: 1366, height: 900, mobile: false }
];
let failures = 0, passes = 0;
const check = (cond, msg) => { if (cond) { passes++; console.log('   ✓', msg); } else { failures++; console.log('   ✗', msg); } };

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  console.log(`\n▶ ${vp.name}`);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.mobile ? 2 : 1, isMobile: vp.mobile, hasTouch: vp.mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? (d.message().includes('Stock received') ? '10' : '') : undefined));
  if (LOCAL_TW) await page.route('**/vendor/chart.umd.js', r => r.fulfill({ body: fs.readFileSync(LOCAL_TW, 'utf8'), contentType: 'text/javascript' }));
  const shot = n => page.screenshot({ path: path.join(OUT, `${vp.name}-${n}.png`), fullPage: false });
  const noHScroll = async label => { const o = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth); check(o <= 1, `${label}: no horizontal scrolling (overflow ${o}px)`); };

  await page.goto(base); await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 20000 });
  // web build keeps the username/password login
  await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]');
  await page.waitForTimeout(400);
  check(await page.isVisible('#onboarding'), 'onboarding wizard shown on first run');
  const fresh = await page.evaluate(() => ({ p: state.products.length, c: state.customers.length, i: state.invoices.length, co: state.company,
    prefill: ['ob-name', 'ob-gstin', 'ob-addr', 'ob-phone', 'ob-acc', 'ob-ifsc'].map(id => document.getElementById(id).value).join('') }));
  check(fresh.p === 0 && fresh.c === 0 && fresh.i === 0, `fresh install has no products, buyers or documents (${fresh.p}/${fresh.c}/${fresh.i})`);
  check(!fresh.co.name && !fresh.co.gstin && !fresh.co.bankAcc && !fresh.co.bankIfsc && !fresh.co.phone && !fresh.co.address, 'fresh install has no sample company, GSTIN or bank details');
  check(fresh.prefill === '', 'onboarding fields start empty (no sample values)');
  await shot('01-onboarding');
  await page.click('#ob-next');                                                   // welcome → business
  await page.fill('#ob-name', 'Shree Test Traders'); await page.fill('#ob-gstin', '24AAPFU0939F1Z1'); await page.dispatchEvent('#ob-gstin', 'input');
  await page.fill('#ob-addr', 'Plot 12, GIDC Naroda, Ahmedabad'); await page.fill('#ob-pin', '382330');
  await page.click('#ob-next');
  // Bank & UPI step (user-reported: a 10-character IFSC silently blocked "Next" because the error toast was hidden)
  await page.fill('#ob-bank', 'PNB'); await page.fill('#ob-acc', '2138 0021 000086'); await page.fill('#ob-ifsc', 'PUNB213800'); await page.fill('#ob-upi', 'name@bank');
  await page.click('#ob-next'); await page.waitForTimeout(200);
  const bankErr = await page.evaluate(() => ({ step: document.querySelector('.ob-step.active').dataset.step, errs: [...document.querySelectorAll('#onboarding .ob-err')].map(e => e.textContent),
    fixVisible: !!document.querySelector('#onboarding .ob-fix') && document.querySelector('#onboarding .ob-fix').offsetHeight > 0,
    toastOnTop: Number(getComputedStyle(document.getElementById('toast-container')).zIndex) > Number(getComputedStyle(document.getElementById('onboarding')).zIndex) }));
  check(bankErr.step === '2' && bankErr.errs.some(e => /11 characters/.test(e) && /PUNB0213800/.test(e)) && bankErr.errs.some(e => /only an example/.test(e)), `wrong IFSC / example UPI explained under the fields (${bankErr.errs.length} messages)`);
  check(bankErr.fixVisible, 'one-tap IFSC correction offered');
  check(bankErr.toastOnTop, 'toasts appear above the setup wizard');
  await page.click('#onboarding .ob-fix'); await page.fill('#ob-upi', '');
  await page.click('#ob-next'); await page.waitForTimeout(150);
  check(await page.evaluate(() => document.querySelector('.ob-step.active').dataset.step === '3' && state.company.bankIfsc === 'PUNB0213800' && state.company.bankAcc === '21380021000086' && state.company.upiId === ''),
    'after correcting, Next continues and bank details are saved');
  await page.click('#ob-next');
  await page.waitForTimeout(300);
  check(!(await page.isVisible('#onboarding')), 'onboarding completes');
  check(await page.evaluate(() => state.company.name === 'Shree Test Traders' && state.company.stateCode === '24' && state.company.pan === 'AAPFU0939F'), 'onboarding saved company, state code & PAN from GSTIN');
  check((await page.isVisible('#bottom-nav')) === vp.mobile, `bottom navigation ${vp.mobile ? 'visible' : 'hidden'}`);
  if (vp.name === 'desktop-1366') {
    check(await page.evaluate(async () => { let netBlocked = false; try { await fetch('https://example.com/csp-probe', { mode: 'no-cors' }); } catch (e) { netBlocked = true; }
      return !!document.querySelector('meta[http-equiv="Content-Security-Policy"]') && netBlocked; }), 'Content-Security-Policy active (remote connections blocked)');
    errors.splice(0, errors.length, ...errors.filter(e => !e.includes('csp-probe')));   // the probe's own expected violation
  }
  if (!vp.mobile) check(await page.evaluate(() => { const r = document.getElementById('rail'); return !!r && getComputedStyle(r).display !== 'none' && r.querySelectorAll('.rail-btn[data-tab]').length === 6; }), 'tablet/desktop: side rail navigation shown');
  check(await page.evaluate(() => document.querySelectorAll('#hgi-icons symbol').length > 40 && !!document.querySelector('#bottom-nav svg.ic, #rail svg.ic')), 'custom icon set in use');
  check(await page.evaluate(() => { switchTab('items'); const ok = document.getElementById('tab-items').classList.contains('tab-in'); switchTab('dashboard'); return ok; }), 'screen change answers with a fade-in');
  check((await page.isVisible('#quick-actions')) === vp.width < 768, `dashboard quick actions ${vp.width < 768 ? 'shown' : 'hidden'} at ${vp.width}px`);
  // editor: segmented document type drives the real select; consignee collapses when same as billing
  await page.evaluate(() => { newDocument('INV'); switchTab('create-invoice'); }); await page.waitForTimeout(150);
  await page.click('#doc-seg button[data-v="QUO"]'); await page.waitForTimeout(120);
  const seg1 = await page.evaluate(() => ({ v: $('inv-doc-type').value, on: document.querySelector('#doc-seg button.on').dataset.v, title: $('form-title').textContent }));
  await page.click('#doc-seg button[data-v="CRN"]'); await page.waitForTimeout(120);
  const seg2 = await page.evaluate(() => ({ v: $('inv-doc-type').value, on: document.querySelector('#doc-seg button.on').dataset.v }));
  await page.click('#doc-seg button[data-v="INV"]'); await page.waitForTimeout(120);
  check(seg1.v === 'QUO' && seg1.on === 'QUO' && seg2.v === 'CRN' && seg2.on === 'CRN' && await page.evaluate(() => $('inv-doc-type').value === 'INV'), `document type switcher (${seg1.title})`);
  const ship = await page.evaluate(() => { const c = $('sync-shipping-chk'); if (!c.checked) { c.click(); } const hidden = $('inv-ship-name').offsetParent === null;
    c.click(); const shown = $('inv-ship-name').offsetParent !== null; c.click(); return hidden && shown; });
  check(ship, 'consignee fields collapse when "Same as billing" is ticked');
  await page.evaluate(() => switchTab('dashboard'));
  await shot('02-dashboard'); await noHScroll('dashboard');

  // GST engine unchanged (same numbers as v6 regression)
  const calc = await page.evaluate(() => { const c = computeDoc({ supplyType: 'B2B', pos: '24', items: [{ qty: 10, rate: 1000, gst: 18, hsn: '848390', unit: 'NOS' }, { qty: 5, rate: 400, gst: 5, hsn: '870899', unit: 'PCS' }], discount: 600, pfCharges: 300, otherCharges: 0 });
    return [c.taxable, c.cgst, c.grandTotal, c.roundoff]; });
  check(JSON.stringify(calc) === JSON.stringify([11700, 926.25, 13553, 0.5]), `GST engine unchanged ${JSON.stringify(calc)}`);

  // the user adds their own items (fresh installs have none)
  await page.evaluate(() => {
    state.products.push({ id: uid('PROD'), name: 'Industrial Machine Components', hsn: '848390', unit: 'NOS', rate: 2500, gst: 18, trackStock: true, openingStock: 10, minStock: 2, stockIns: [] });
    state.products.push({ id: uid('PROD'), name: 'Precision Fabrication Assemblies', hsn: '730890', unit: 'SET', rate: 4000, gst: 18 });
    saveState(); refreshProductDatalist(); renderItemList();
  });

  // invoice
  await page.evaluate(() => newDocument('INV'));
  await page.fill('#inv-buyer-name', 'Shree Ram Engineering'); await page.fill('#inv-buyer-gstin', '27AAPFU0939F1ZV'); await page.dispatchEvent('#inv-buyer-gstin', 'input');
  await page.fill('#inv-buyer-address', 'MIDC Bhosari, Pune'); await page.fill('#inv-buyer-pin', '411026');
  const row = page.locator('#invoice-items-body tr').first();
  await row.locator('.item-desc').fill('Industrial Machine Components'); await row.locator('.item-desc').dispatchEvent('change');
  await row.locator('.item-qty').fill('12');
  await page.waitForTimeout(400);
  if (vp.width < 768) check(await page.evaluate(() => document.querySelector('#live-total b').textContent.replace(/[^\d.]/g, '') === String(collectDocFromForm().grandTotal.toFixed(2))), 'save bar shows the live grand total');
  if (vp.width < 768) check(await page.evaluate(() => {
    const stateField = $('inv-buyer-state'), code = $('inv-buyer-state-code');
    return stateField.getBoundingClientRect().width > code.getBoundingClientRect().width * 1.8 && code.inputMode === 'numeric' && $('inv-buyer-pin').inputMode === 'numeric';
  }), 'phone address: full-width state and numeric keypad for code/PIN');
  await shot('03-invoice-form'); await noHScroll('invoice form');
  const stockWarn = await page.evaluate(() => [...document.querySelectorAll('#check-list > div')].some(d => d.textContent.includes('only 10 available')));
  check(stockWarn, 'stock check warns when selling more than available');
  const saved = await page.evaluate(() => saveCurrentInvoice());
  check(saved === true, 'invoice saved');
  check(await page.evaluate(() => stockOf(state.products[0]) === -2), 'stock reduced by invoiced quantity');

  // dashboard hero agrees with the ledger; editor sections in fill-in order
  await page.evaluate(() => switchTab('dashboard')); await page.waitForTimeout(200);
  const hero = await page.evaluate(() => {
    const due = liveDocs().filter(d => d.docType === 'INV').reduce((a, d) => a + Math.max(0, balanceOf(d)), 0);
    const r = gstSummaryFor(todayISO().slice(0, 7));
    return { shown: document.getElementById('hero-amount').textContent, expect: money(due), segs: document.querySelectorAll('#hero .ledger .seg').length,
      strip: document.getElementById('stat-strip').textContent.includes(money(r.tax)), kpisHidden: getComputedStyle(document.querySelector('.dash-kpis')).display === 'none' };
  });
  check(hero.shown === hero.expect && hero.segs >= 1 && hero.strip && hero.kpisHidden, `dashboard hero shows amount to collect ${hero.shown} and this month's GST`);
  await page.evaluate(() => switchTab('create-invoice')); await page.waitForTimeout(150);
  const ed = await page.evaluate(() => { const y = s => document.querySelector(s).getBoundingClientRect().top;
    return { ordered: y('.sec-doc') < y('.sec-parties') && y('.sec-parties') < y('.sec-items') && y('.sec-items') < y('.sec-charges') && y('.sec-charges') < y('.sec-summary') && y('.sec-summary') < y('.sec-supply'),
      pick: !!document.querySelector('.sec-parties #inv-customer-select'), heads: document.querySelectorAll('#invoice-form .ed-head').length }; });
  check(ed.ordered && ed.pick && ed.heads >= 8, `invoice editor: ${ed.heads} named sections in fill-in order, saved-buyer picker in Customer`);

  // preview, scaling and print/PDF
  await page.evaluate(() => renderPreview()); await page.waitForTimeout(500);
  const sc = await page.evaluate(() => { const w = document.querySelector('.page-scale-wrap'); return { wrap: w ? w.getBoundingClientRect().width : 0, vw: window.innerWidth }; });
  check(sc.wrap > 0 && sc.wrap <= sc.vw, `invoice preview fits the screen (${Math.round(sc.wrap)} ≤ ${sc.vw})`);
  await page.evaluate(() => document.getElementById('preview-section').scrollIntoView()); await shot('04-preview'); await noHScroll('preview');
  await page.evaluate(() => renderPreviewPages(selectedCopies()));
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check(pages === 3, `print: 3 copies → 3 A4 pages (got ${pages})`);
  fs.writeFileSync(path.join(OUT, `${vp.name}-invoice.pdf`), pdf);

  // quotation → invoice
  await page.evaluate(() => newDocument('QUO'));
  await page.fill('#inv-buyer-name', 'Patel Hardware'); await page.fill('#inv-buyer-address', 'Ring Road, Surat');
  await page.fill('#inv-buyer-state-code', '24'); await page.dispatchEvent('#inv-buyer-state-code', 'input');
  const qrow = page.locator('#invoice-items-body tr').first();
  await qrow.locator('.item-desc').fill('Precision Fabrication Assemblies'); await qrow.locator('.item-desc').dispatchEvent('change');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => saveCurrentInvoice()) === true, 'quotation saved');
  const qid = await page.evaluate(() => state.invoices.find(d => d.docType === 'QUO').id);
  check(await page.evaluate(id => displayStatus(state.invoices.find(d => d.id === id)) === 'Open', qid), 'quotation status Open');
  check(await page.evaluate(() => buildReturns(todayISO().slice(0, 7)).b2cs ? Object.keys(buildReturns(todayISO().slice(0, 7)).b2cs).length === 0 : true), 'quotation not in GST returns');
  await page.evaluate(id => convertQuote(id), qid); await page.waitForTimeout(300);
  check(await page.evaluate(() => currentDocType() === 'INV' && $('inv-buyer-name').value === 'Patel Hardware'), 'convert loads quotation into a new invoice');
  check(await page.evaluate(() => saveCurrentInvoice()) === true, 'converted invoice saved');
  check(await page.evaluate(id => displayStatus(state.invoices.find(d => d.id === id)) === 'Converted', qid), 'quotation marked Converted');

  // register as cards on phones
  await page.evaluate(() => switchTab('invoices')); await page.waitForTimeout(300);
  if (vp.mobile) {
    check(await page.evaluate(() => { const tr = document.querySelector('#invoices-list-tbody tr:not(.month-row)'); return getComputedStyle(tr).display === 'grid' && tr.getBoundingClientRect().height < 140; }), 'register rows shown as compact cards (< 140px)');
    await page.click('#invoices-list-tbody tr:not(.month-row) td:nth-child(5)'); await page.waitForTimeout(250);
    const sheet = await page.evaluate(() => ({ open: document.getElementById('more-sheet').classList.contains('open'), acts: [...document.querySelectorAll('#more-sheet .act')].map(b => b.textContent.trim()) }));
    check(sheet.open && sheet.acts.includes('Record Receipt') && sheet.acts.includes('View / Print') && sheet.acts.some(a => /Delete/.test(a)), `tapping a row opens its labelled actions (${sheet.acts.length})`);
    await page.click('#more-sheet .act >> text=Record Receipt'); await page.waitForTimeout(300);
    check(await page.evaluate(() => !document.getElementById('payment-modal').classList.contains('hidden') && !document.getElementById('more-sheet').classList.contains('open')), 'row action runs (receipt dialog opens)');
    await page.evaluate(() => closeModal('payment-modal'));
  }
  await shot('05-register'); await noHScroll('register');
  for (const tab of ['items', 'customers', 'returns', 'settings']) { await page.evaluate(t => switchTab(t), tab); await page.waitForTimeout(200); await noHScroll(tab); }
  await page.evaluate(() => switchTab('items')); await shot('06-items');

  // dark mode keeps the invoice paper white
  await page.evaluate(() => HGI_M.setTheme('dark')); await page.evaluate(() => { switchTab('invoices'); viewInvoiceDetail(state.invoices.find(d => d.docType === 'INV').id); }); await page.waitForTimeout(700);
  const dark = await page.evaluate(() => ({ html: document.documentElement.classList.contains('dark'), paper: getComputedStyle(document.querySelector('.a4-page')).backgroundColor, body: getComputedStyle(document.body).backgroundColor }));
  check(dark.html && dark.paper === 'rgb(255, 255, 255)' && dark.body !== 'rgb(255, 255, 255)', `dark mode: chrome dark, invoice paper white (${dark.paper})`);
  await page.evaluate(() => switchTab('dashboard')); await shot('07-dark');
  await page.evaluate(() => HGI_M.setTheme('light'));

  // Hindi UI; invoice stays English
  await page.evaluate(() => HGI_M.setLang('hi')); await page.waitForTimeout(300);
  const hi = await page.evaluate(() => ({ nav: document.querySelector('#bottom-nav button[data-tab="customers"] span').textContent, h: document.querySelector('#tab-dashboard h2').textContent }));
  check(hi.nav === 'ग्राहक' && hi.h === 'व्यापार सारांश', `Hindi labels applied (${hi.nav} / ${hi.h})`);
  check(await page.evaluate(() => document.querySelector('#hero .hero-label').textContent === 'वसूली बाकी'), 'dashboard hero translated');
  await page.evaluate(() => { renderPreview(); }); await page.waitForTimeout(400);
  check(await page.evaluate(() => document.querySelector('#invoice-preview-container').textContent.includes('TAX INVOICE')), 'invoice print stays in English');
  await page.evaluate(() => switchTab('dashboard')); await shot('08-hindi');
  await page.evaluate(() => HGI_M.setLang('gu')); await page.waitForTimeout(200);
  check(await page.evaluate(() => document.querySelector('#tab-dashboard h2').textContent) === 'વ્યવસાય સારાંશ', 'Gujarati labels applied');
  await page.evaluate(() => HGI_M.setLang('en'));

  // data persists across reload
  const count = await page.evaluate(() => state.invoices.length);
  await page.reload(); await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 20000 }).catch(e => console.log('   reload errors:', errors.slice(-5)));
  check(await page.evaluate(() => state.invoices.length) === count, `data persists after reload (${count} documents)`);

  if (vp.name === 'phone-large-412' || vp.name === 'desktop-1366') {
    // ---- Demo Mode: explicit opt-in, separate storage, watermark, real data untouched
    const realBefore = await page.evaluate(() => localStorage.getItem('hgi_billing_v7_prod'));
    const realCount = JSON.parse(realBefore).invoices.length;
    const relog = async () => {
      await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 20000 });
      if (await page.isVisible('#login-overlay')) { await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]'); await page.waitForTimeout(300); }
    };
    await page.evaluate(() => switchTab('settings'));
    await Promise.all([page.waitForEvent('load'), page.click('#prefs-enter-demo')]);
    await relog();
    const demo = await page.evaluate(() => ({ mode: DEMO_MODE, n: state.invoices.length, allDemo: state.invoices.every(d => d.demo), name: state.company.name, upi: state.company.upiId,
      banner: !!document.getElementById('demo-banner') && document.getElementById('demo-banner').offsetHeight > 0 }));
    check(demo.mode && demo.banner, 'Demo Mode opens with a visible DEMO banner');
    check(demo.n === 5 && demo.allDemo && /Demo/.test(demo.name) && demo.upi === '', `Demo Mode shows only sample data (${demo.n} docs, "${demo.name}", no real UPI)`);
    const age = await page.evaluate(() => { const toN = t => Number(String(t).replace(/[^\d.]/g, '')) || 0;
      const sum = [...document.querySelectorAll('#hero .age b')].reduce((a, b) => a + toN(b.textContent), 0);
      const overdue = liveDocs().filter(isOverdue).reduce((a, d) => a + balanceOf(d), 0);
      return { sum: Math.round(sum * 100) / 100, overdue: Math.round(overdue * 100) / 100, avatars: document.querySelectorAll('#dash-recent-table .avatar, #dash-top-buyers .avatar').length }; });
    const v8 = await page.evaluate(() => { HGI_STUDIO.renderDash(); const bars = [...document.querySelectorAll('svg.flow .bar')]; const cur = todayISO().slice(0, 7);
      const billed = liveDocs().filter(d => monthKey(d.date) === cur).reduce((a, d) => a + signed(d) * (d.grandTotal || 0), 0);
      return { bars: bars.length, read: document.getElementById('flow-read').textContent.includes(money(round2(billed))), ring: !!document.querySelector('#ring-card .r-arc'), kpis: document.querySelectorAll('#stat-strip .kpi').length,
        months: document.querySelectorAll('#invoices-list-tbody tr.month-row').length }; });
    check(await page.evaluate(() => { const l = [...document.querySelectorAll('svg.flow .gt')].map(e => e.textContent); return new Set(l).size === l.length; }), 'cash-flow scale labels are all different');
    check(v8.bars === 12 && v8.read && v8.ring && v8.kpis === 4, `cash-flow chart (12 months, this month's billing in the readout), collection ring and 4 KPI tiles`);
    await page.evaluate(() => switchTab('invoices'));
    check(await page.evaluate(() => document.querySelectorAll('#invoices-list-tbody tr.month-row').length >= 1), 'documents grouped under month headings');
    await page.evaluate(() => switchTab('dashboard'));
    check(age.sum === age.overdue && age.overdue > 0, `hero: overdue-by-age buckets add up to the overdue total (${age.sum})`);
    check(age.avatars >= 5, `party avatars on recent documents and who-owes-you (${age.avatars})`);
    await page.evaluate(() => switchTab('invoices')); await page.waitForTimeout(150);
    await page.click('#doc-chips button[data-i="2"]'); await page.waitForTimeout(150);   // Overdue
    const chip = await page.evaluate(() => ({ st: $('inv-filter-status').value, ty: $('inv-filter-type').value, rows: getFilteredInvoices().length,
      want: state.invoices.filter(d => d.docType === 'INV' && displayStatus(d) === 'Overdue').length, badge: document.querySelector('#doc-chips button[data-i="2"] b').textContent,
      on: document.querySelector('#doc-chips button.on').dataset.i }));
    check(chip.st === 'Overdue' && chip.ty === 'INV' && chip.rows === chip.want && chip.badge === String(chip.want) && chip.on === '2', `document filter chips (Overdue: ${chip.rows})`);
    await page.click('#doc-chips button[data-i="0"]'); await page.waitForTimeout(100);
    check(await page.evaluate(() => getFilteredInvoices().length === state.invoices.length), 'All chip clears the filters');
    await page.evaluate(() => switchTab('returns')); await page.waitForTimeout(150);
    const ret = await page.evaluate(() => { const mk = $('ret-month').value, R = buildReturns(mk), t = R.t31a;
      return { hero: $('ret-hero').querySelector('.rh-amount').textContent, want: money(round2(t.igst + t.cgst + t.sgst + R.t31b.igst)), secs: document.querySelectorAll('#ret-sections details').length,
        empty: document.querySelectorAll('#ret-empty .re-list span').length, mk }; });
    check(ret.hero === ret.want && ret.secs >= 2, `GST returns hero shows the month's output tax (${ret.hero}, ${ret.secs} sections, ${ret.empty} empty listed)`);
    await page.click('.period-step[aria-label="Previous month"]'); await page.waitForTimeout(120);
    check(await page.evaluate(mk => { const [y, m] = mk.split('-').map(Number), d = new Date(y, m - 2, 1); return $('ret-month').value === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }, ret.mk), 'period stepper moves to the previous month');
    await page.evaluate(() => { $('ret-month').value = todayISO().slice(0, 7); renderReturns(); });
    await page.evaluate(() => { editInvoice(state.invoices.find(d => d.docType === 'INV').id); renderPreview(); }); await page.waitForTimeout(500);
    check(await page.evaluate(() => document.querySelectorAll('#invoice-preview-container .demo-watermark').length > 0 && document.querySelector('#invoice-preview-container').textContent.includes('NOT A VALID TAX INVOICE')), 'demo invoices carry the NOT A VALID TAX INVOICE watermark');
    await shot('09-demo-preview');
    // business data identical (the save just before switching only stamps ui.rev / savedAt)
    const biz = j => { const o = JSON.parse(j); return JSON.stringify([o.company, o.invoices, o.products, o.customers]); };
    check(await page.evaluate(() => localStorage.getItem('hgi_billing_v7_prod')).then(j => biz(j) === biz(realBefore)), 'real data untouched while in Demo Mode');
    await page.evaluate(() => switchTab('settings'));
    await Promise.all([page.waitForEvent('load'), page.click('#prefs-exit-demo')]);
    await relog();
    const back = await page.evaluate(() => ({ mode: DEMO_MODE, n: state.invoices.length, demoDocs: state.invoices.filter(d => d.demo).length, demoKey: localStorage.getItem('hgi_billing_demo'), banner: !!document.getElementById('demo-banner') }));
    check(!back.mode && back.n === realCount && back.demoDocs === 0 && back.demoKey === null && !back.banner, `exit Demo Mode: real data back (${back.n} docs), sample data deleted`);
    await page.evaluate(() => { renderPreview(); }); await page.waitForTimeout(300);
    check(await page.evaluate(() => !document.querySelector('#invoice-preview-container .demo-watermark')), 'no watermark on real invoices');
  }

  check(errors.length === 0, `no JavaScript errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
// ---- Upgrade from v7.0.0 / v6 data that still has the old sample company values: warned, never silently changed
{
  console.log('\n▶ upgrade from older data with sample values');
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const legacy = { credentials: { username: 'admin', password: '123' },
    company: { name: 'HARI GURU INDUSTRIES', gstin: '24AAAFH1234F1Z5', stateCode: '24', state: 'Gujarat', address: 'Plot No 123, Phase 3, GIDC Naroda,\nAhmedabad, Gujarat - 382330',
      bankName: 'STATE BANK OF INDIA', bankAcc: '123456789012', bankIfsc: 'SBIN0001234', phone: '+91 98765 43210', prefixes: { INV: '' } },
    products: [{ id: 'PROD-101', name: 'Industrial Machine Components', hsn: '848390', unit: 'NOS', rate: 2500, gst: 18 }],
    customers: [], invoices: [{ id: 'DOC-1', docType: 'INV', num: '01/26-27', date: '2026-10-01', supplyType: 'B2C', pos: '24', buyerName: 'Old Customer', items: [{ desc: 'X', hsn: '848390', gst: 18, qty: 1, unit: 'NOS', rate: 100 }], payments: [] }],
    ui: { onboarded: true } };
  await ctx.addInitScript(s => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('hgi_billing_v7_prod', s); sessionStorage.setItem('__seeded', '1'); } }, JSON.stringify(legacy));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base); await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 20000 });
  await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]'); await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ n: state.invoices.length, p: state.products.length, gstin: state.company.gstin, acc: state.company.bankAcc,
    alert: document.getElementById('dash-alerts').textContent, check: runChecks(collectDocFromForm()).map(x => x.msg).join(' | ') }));
  check(r.n === 1 && r.p === 1, 'existing documents and items kept after upgrade');
  check(r.gstin === '24AAAFH1234F1Z5' && r.acc === '123456789012', 'existing company values not changed automatically');
  check(/Sample data in Settings/.test(r.alert) && /GSTIN/.test(r.alert) && /bank account/.test(r.alert), 'dashboard warns that Settings still hold sample values');
  check(/SAMPLE values/.test(r.check), 'compliance check blocks-warns sample values on new documents');
  await page.screenshot({ path: path.join(OUT, 'upgrade-sample-warning.png') });
  check(errors.length === 0, `no JavaScript errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
// ---- Data-safety and GST guards (audit P0/P1 items 2–9)
{
  console.log('\n▶ data safety & GST guards');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const co = { name: 'Guard Test Co', gstin: '24AAPFU0939F1Z1', stateCode: '24', state: 'Gujarat', address: 'Ahmedabad', prefixes: { INV: '' } };
  const item = (q) => [{ desc: 'Widget', hsn: '847130', gst: 18, qty: q, unit: 'NOS', rate: 1000 }];
  const seed = { credentials: { username: 'admin', password: '123' }, company: co, customers: [],
    products: [{ id: 'P1', name: 'Widget', hsn: '847130', unit: 'NOS', rate: 1000, gst: 18, trackStock: true, openingStock: 10, minStock: 1, stockIns: [] }],
    invoices: [
      { id: 'A', docType: 'INV', num: '01/26-27', date: '2026-10-01', supplyType: 'B2C', pos: '24', buyerName: 'Paid Buyer', items: item(1), payments: [{ id: 'PAY1', date: '2026-10-02', amount: 1180, tds: 0, mode: 'UPI', ref: '' }] },
      { id: 'B', docType: 'INV', num: '02/26-27', date: '2026-10-02', supplyType: 'B2C', pos: '24', buyerName: 'Noted Buyer', items: item(1), payments: [] },
      { id: 'C', docType: 'CRN', num: 'CN/01/26-27', date: '2026-10-03', supplyType: 'B2C', pos: '24', buyerName: 'Noted Buyer', refId: 'B', refNum: '02/26-27', items: item(1), payments: [] },
      { id: 'D', docType: 'INV', num: '03/26-27', date: '2026-10-04', supplyType: 'B2B', pos: '27', buyerName: 'IRN Buyer', buyerGstin: '27AAPFU0939F1ZV', items: item(1), payments: [], irn: 'a'.repeat(64), ackNo: '112010000000001', ackDate: '2026-10-04' }
    ], ui: { onboarded: true, rev: 5 } };
  await ctx.addInitScript(sd => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('hgi_billing_v7_prod', sd); sessionStorage.setItem('__seeded', '1'); } }, JSON.stringify(seed));
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'test' : undefined));
  await page.goto(base); await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 20000 });
  await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]'); await page.waitForTimeout(300);
  const n = () => page.evaluate(() => state.invoices.length);
  await page.evaluate(() => deleteInvoice('A'));
  check(await n() === 4, 'invoice with receipts cannot be deleted');
  await page.evaluate(() => deleteInvoice('B'));
  check(await n() === 4, 'invoice with a credit note against it cannot be deleted');
  await page.evaluate(() => cancelInvoice('B'));
  check(await page.evaluate(() => !state.invoices.find(d => d.id === 'B').cancelled), 'invoice with a live credit note cannot be cancelled');
  await page.evaluate(() => deleteInvoice('D'));
  check(await n() === 4, 'invoice with an IRN cannot be deleted');
  // IRN lock: amounts can't change, transport details can
  await page.evaluate(() => editInvoice('D')); await page.waitForTimeout(200);
  await page.locator('#invoice-items-body tr').first().locator('.item-qty').fill('5');
  await page.evaluate(() => saveCurrentInvoice());
  check(await page.evaluate(() => state.invoices.find(d => d.id === 'D').items[0].qty === 1), 'IRN-registered invoice: items/amounts locked');
  await page.evaluate(() => editInvoice('D')); await page.waitForTimeout(200);
  await page.fill('#inv-transport', 'Shree Logistics');
  await page.evaluate(() => saveCurrentInvoice());
  check(await page.evaluate(() => state.invoices.find(d => d.id === 'D').transport === 'Shree Logistics'), 'IRN-registered invoice: transport details can still be updated');
  // credit-note index stays correct as notes change
  check(await page.evaluate(() => balanceOf(state.invoices.find(d => d.id === 'B')) === 0), 'credit note reduces the invoice balance');
  await page.evaluate(() => cancelInvoice('C'));
  check(await page.evaluate(() => state.invoices.find(d => d.id === 'C').cancelled && balanceOf(state.invoices.find(d => d.id === 'B')) === state.invoices.find(d => d.id === 'B').grandTotal), 'cancelling the credit note restores the balance');
  // discount larger than value
  check(await page.evaluate(() => runChecks({ ...state.invoices[0], discount: 5000, items: [{ desc: 'Widget', hsn: '847130', gst: 18, qty: 1, unit: 'NOS', rate: 1000 }] }).some(x => x.lvl === 'error' && /Discount/.test(x.msg))), 'discount above item value is a compliance error');
  // products: duplicate name blocked, rename keeps stock history
  const stock0 = await page.evaluate(() => stockOf(state.products[0]));
  await page.evaluate(() => { openItemModal(); $('modal-item-name').value = 'widget'; $('modal-item-hsn').value = '847130'; $('modal-item-unit').value = 'NOS'; saveItemFromModal(); });
  check(await page.evaluate(() => state.products.length === 1), 'duplicate item name rejected');
  await page.evaluate(() => { openItemModal('P1'); $('modal-item-name').value = 'Widget Pro'; saveItemFromModal(); });
  check(await page.evaluate(s0 => state.products[0].name === 'Widget Pro' && stockOf(state.products[0]) === s0, stock0), `renamed item keeps its stock (${stock0})`);
  // backup restore: invalid rejected; valid restore keeps a safety copy that can be undone
  const restore = obj => page.evaluate(o => new Promise(res => { importJSONBackup({ target: { files: [new File([JSON.stringify(o)], 'b.json')], set value(v) {} } }); setTimeout(res, 600); }), obj);
  await restore({ company: { name: 'X' }, invoices: [{ foo: 1 }] });
  check(await n() === 4, 'invalid backup file rejected (data unchanged)');
  for (const invalid of [
    { company: [], invoices: [] },
    { company: { name: 'X' }, invoices: [], customers: [null] },
    { company: { name: 'X' }, invoices: [], products: [{ name: 42 }] },
    { company: { name: 'X' }, invoices: [{ num: '01', date: '2026-10-01', items: [null] }] },
    { company: { name: 'X' }, invoices: [{ num: '01', date: '2026-10-01', items: [], payments: [null] }] }
  ]) {
    await restore(invalid);
    check(await page.evaluate(() => state.company.name === 'Guard Test Co' && state.invoices.length === 4), 'malformed backup rejected before replacing current data');
  }
  check(await page.evaluate(async () => {
    const original = window.downloadBlob, before = state.ui.lastBackup;
    window.downloadBlob = async () => false;
    try { await exportJSONBackup(); return state.ui.lastBackup === before; }
    finally { window.downloadBlob = original; }
  }), 'failed backup export does not mark data as backed up');
  await restore({ company: { name: 'Restored Co', stateCode: '24' }, invoices: [], products: [], customers: [] });
  check(await page.evaluate(() => state.company.name === 'Restored Co' && state.invoices.length === 0 && !!localStorage.getItem('hgi_billing_v7_prod_before_restore') && !document.getElementById('onboarding')), 'valid backup restored (no setup wizard), safety copy kept');
  await page.evaluate(() => switchTab('settings'));
  check(await page.isVisible('#prefs-undo-restore'), 'Undo restore offered in Settings');
  await page.evaluate(() => HGI_M.undoRestore()); await page.waitForTimeout(400);
  check(await page.evaluate(() => state.company.name === 'Guard Test Co' && state.invoices.length === 4), 'undo restore brings back the previous data');
  // long registers are paged
  await page.evaluate(() => { for (let i = 10; i < 410; i++) state.invoices.push({ id: 'X' + i, docType: 'INV', num: `${i}/26-27`, date: '2026-09-01', supplyType: 'B2C', pos: '24', buyerName: 'Bulk ' + i,
    items: [{ desc: 'Widget Pro', hsn: '847130', gst: 18, qty: 1, unit: 'NOS', rate: 10 }], payments: [], grandTotal: 12, taxable: 10, cgst: 0.9, sgst: 0.9 }); saveState(); switchTab('invoices'); });
  const pg = await page.evaluate(() => ({ rows: document.querySelectorAll('#invoices-list-tbody tr:not(.show-more-row):not(.month-row)').length, more: !!document.getElementById('btn-show-more-docs'), foot: document.getElementById('invoices-list-tfoot').textContent }));
  check(pg.rows === 150 && pg.more && /404 docs/.test(pg.foot), `register shows 150 rows + "Show more", totals cover all (${pg.rows})`);
  await page.click('#btn-show-more-docs');
  check(await page.evaluate(() => document.querySelectorAll('#invoices-list-tbody tr:not(.show-more-row):not(.month-row)').length === 300), 'Show more adds the next page');
  await page.evaluate(() => { state.invoices = state.invoices.filter(d => !d.id.startsWith('X')); saveState(); renderAll(); });
  // revision number increases with every save
  const r1 = await page.evaluate(() => state.ui.rev); await page.evaluate(() => saveState());
  check(await page.evaluate(r => state.ui.rev === r + 1 && JSON.parse(localStorage.getItem('hgi_billing_v7_prod')).ui.rev === r + 1, r1), 'each save stamps a higher revision');
  // unreadable stored data is kept, not overwritten
  await page.evaluate(() => localStorage.setItem('hgi_billing_v7_prod', '{"company": broken'));
  await page.reload(); await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 20000 });
  check(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('hgi_billing_v7_prod_unreadable_') && localStorage.getItem(k).includes('broken'))), 'unreadable saved data is preserved as a recovery copy');
  check(errors.length === 0, `no JavaScript errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await ctx.close();
}
await browser.close(); server.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
