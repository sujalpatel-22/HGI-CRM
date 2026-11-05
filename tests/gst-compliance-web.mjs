#!/usr/bin/env node
// v9.3 GST compliance — end-to-end through the real invoice editor, saved records, printed page and returns.
// Each scenario states its legal basis and the expected figures are worked out by hand (comments), not read from the app.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WWW = path.join(root, 'www'), OUT = path.join(root, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
let failures = 0, passes = 0; const lines = [];
const check = (cond, msg) => { const l = `${cond ? '✓' : '✗'} ${msg}`; lines.push(l); if (cond) passes++; else failures++; console.log('   ' + l); };
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', png: 'image/png', svg: 'image/svg+xml', json: 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html')));
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const errors = [];

// synthetic GSTINs with valid check digits (no real taxpayer data)
const SUP = '24AAPFU0939F1Z1', BUY = '24AAACR5055K1ZD', BUY_RJ = '08AAACR5055K1Z7', SUP_UT = '04AAPFU0939F1Z3', BUY_UT = '04AAACR5055K1ZF', BUY_MH = '27AAPFU0939F1ZV';
const COMPANY = { name: 'Test Industries', legalName: 'Test Industries', gstin: SUP, pan: 'AAPFU0939F', state: 'Gujarat', stateCode: '24', pin: '382330', address: 'Plot 1, GIDC Naroda\nAhmedabad',
  phone: '9876500000', email: 'a@b.in', bankName: 'PNB', bankAcc: '21380021000086', bankIfsc: 'PUNB0213800', aato: 'upto5', scheme: 'regular', prefixes: { INV: '' } };

async function openApp(company = COMPANY, invoices = []) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const seed = { credentials: { username: 'admin', password: '123' }, company, customers: [], products: [], invoices, ui: { onboarded: true, rev: 5 } };
  await ctx.addInitScript(sd => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('hgi_billing_v7_prod', sd); sessionStorage.setItem('__seeded', '1'); } }, JSON.stringify(seed));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(base); await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 30000 });
  if (await page.isVisible('#login-username')) { await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]'); await page.waitForTimeout(300); }
  // test helpers: fill the editor the way a user does (fields + the same input handlers), then refresh synchronously
  await page.evaluate(() => {
    window.__fill = (o) => {
      newDocument(o.docType || 'INV', true);
      if (o.date) { $('inv-date').value = o.date; updateAutoInvoiceNumber(); }
      if (o.num) $('inv-num').value = o.num;
      const set = (id, v) => { if (v !== undefined) $(id).value = v; };
      set('inv-buyer-name', o.buyerName || 'Buyer Pvt Ltd'); set('inv-buyer-gstin', o.buyerGstin || ''); if (o.buyerGstin) onBuyerGstinInput();
      set('inv-buyer-address', o.buyerAddress || 'Ring Road, Surat'); set('inv-buyer-pin', o.buyerPin || '395002');
      if (o.buyerStateCode) { $('inv-buyer-state-code').value = o.buyerStateCode; onBuyerStateCodeInput(); }
      if (o.ship) {
        $('sync-shipping-chk').checked = false;
        set('inv-ship-name', o.ship.name); set('inv-ship-gstin', o.ship.gstin || ''); set('inv-ship-address', o.ship.address || 'Site office'); set('inv-ship-pin', o.ship.pin || '');
        $('inv-ship-state-code').value = o.ship.stateCode; onShipStateCodeInput();
      }
      if (o.supplyType) $('inv-supply-type').value = o.supplyType;
      if (o.rcm) $('inv-rcm').value = 'Y';
      $('invoice-items-body').innerHTML = '';
      (o.items || [{ desc: 'MS Structure', hsn: '730890', gst: 18, qty: 1, rate: 1000, unit: 'NOS' }]).forEach(it => addInvoiceRow(it));
      if (o.discount) $('inv-discount').value = o.discount;
      if (o.shipMode) setShipMode(o.shipMode);
      if (o.ref) { populateRefInvoices(); $('inv-ref-id').value = o.ref; onRefInvoiceChange && onRefInvoiceChange(); }
      doRefreshForm();
      return collectDocFromForm();
    };
    window.__checks = () => runChecks(collectDocFromForm());
    window.__blocks = () => blockingOf(window.__checks()).map(x => x.msg);
    window.__closeDlg = () => document.querySelectorAll('.acct-dlg').forEach(e => e.remove());
    window.__save = () => { const r = saveCurrentInvoice(); window.__closeDlg(); return r; };
    window.__page = (d) => { const div = document.createElement('div'); div.innerHTML = renderDocPage({ ...d, calc: computeDoc(d) }, 'classic', 'ORIGINAL FOR RECIPIENT'); return div.textContent.replace(/\s+/g, ' '); };
  });
  return page;
}

/* ------------------------------------------------------------ 1. the user's case: Gujarat → Gujarat buyer, goods to a Rajasthan site */
console.log('\n▶ Bill-to / ship-to (IGST Act s.10(1)(a) vs 10(1)(b)) — the 62/26-27 scenario');
{
  const page = await openApp();
  const order = { buyerName: 'Buyer Energy Pvt Ltd', buyerGstin: BUY, ship: { name: 'Buyer Energy Pvt Ltd', gstin: '', address: 'Project site, Devikot, Jaisalmer', pin: '345001', stateCode: '08' },
    items: [{ desc: 'MS Structure', hsn: '730890', gst: 18, qty: 1, rate: 107499, unit: 'NOS' }] };
  // a) consignee typed as the buyer itself (same name) — v9.2 picked 10(1)(a) from the name; now the app must ask
  let d = await page.evaluate(o => __fill(o), order);
  const q = await page.evaluate(() => ({ box: !$('ship-mode-box').classList.contains('hidden'), pos: $('inv-pos').value, blocks: __blocks() }));
  check(q.box && q.pos === '' && q.blocks.some(m => /Choose who receives the goods/.test(m)), 'delivery state ≠ buyer state → the editor asks who receives the goods; no place of supply is guessed');
  const n0 = await page.evaluate(() => state.invoices.length);
  check(await page.evaluate(() => __save()) === false && await page.evaluate(() => state.invoices.length) === n0, 'saving is refused while the fact is missing (no "save anyway")');
  // b) third person on the buyer's instruction → POS = buyer's state (24) → CGST 9 % + SGST 9 % on 1,07,499 = 9,674.91 each; total 1,26,849
  d = await page.evaluate(o => __fill({ ...o, shipMode: 'third' }), order);
  check(d.pos === '24' && d.posRule === '10(1)(b)' && d.cgst === 9674.91 && d.sgst === 9674.91 && d.igst === 0 && d.grandTotal === 126849, `bill-to/ship-to → POS 24, CGST 9,674.91 + SGST 9,674.91, total 1,26,849 (${d.pos} ${d.cgst}/${d.sgst}/${d.igst}/${d.grandTotal})`);
  check(await page.evaluate(() => __save()) === true, 'invoice saves once the fact is recorded');
  const saved = await page.evaluate(() => state.invoices.find(x => x.buyerName === 'Buyer Energy Pvt Ltd'));
  check(saved.shipMode === 'third' && saved.posRule === '10(1)(b)' && saved.rulesVersion, 'saved record keeps the fact, the rule applied and the rule-book version');
  let txt = await page.evaluate(sd => __page(sd), saved);
  check(/Section 10\(1\)\(b\), IGST Act/.test(txt) && /CGST @ 9%/.test(txt) && /SGST @ 9%/.test(txt) && !/IGST @/.test(txt), 'printed invoice: CGST + SGST and the Section 10(1)(b) bill-to/ship-to note');
  // c) delivery to the buyer's own site → POS = delivery state (08) → IGST 18 % = 19,349.82, plus the ITC warning
  d = await page.evaluate(o => __fill({ ...o, shipMode: 'buyer' }), order);
  const w = await page.evaluate(() => __checks().filter(x => x.lvl === 'warn').map(x => x.msg));
  check(d.pos === '08' && d.posRule === '10(1)(a)' && d.igst === 19349.82 && d.cgst === 0, `buyer's own site → POS 08, IGST 19,349.82 (${d.pos} ${d.igst})`);
  check(w.some(m => /GSTR-2B will normally show this IGST as ITC not available/.test(m)), 'warns that a Gujarat-registered buyer will not get ITC of IGST with POS Rajasthan');
  txt = await page.evaluate(dd => __page(dd), d);
  check(!/Section 10\(1\)\(b\)/.test(txt) && /IGST @ 18%/.test(txt), 'no bill-to/ship-to note when it does not apply');
  // d) delivery inside the buyer's state to another person: same POS either way → no question, no note
  d = await page.evaluate(o => __fill({ ...o, ship: { name: 'Sub-contractor', address: 'Hazira', pin: '394270', stateCode: '24' } }), order);
  check(await page.evaluate(() => $('ship-mode-box').classList.contains('hidden')) && d.pos === '24' && !/Section 10\(1\)\(b\)/.test(await page.evaluate(dd => __page(dd), d)), 'ship-to in the buyer\'s state: no question asked, no note printed');
  // e) contradiction: consignee GSTIN of Gujarat with a Rajasthan delivery address
  await page.evaluate(o => __fill({ ...o, shipMode: 'third', ship: { ...o.ship, gstin: '24AAACR5055K1ZD' } }), order);
  check((await page.evaluate(() => __blocks())).some(m => /Consignee GSTIN is registered in Gujarat .* but the delivery address is in Rajasthan/.test(m)), 'consignee GSTIN state ≠ delivery state is a blocking contradiction');
  // f) POS changed by hand against the rule: blocked without a reason, accepted (with a warning) with one
  await page.evaluate(o => { __fill({ ...o, shipMode: 'third' }); posManual = true; $('inv-pos').value = '08'; doRefreshForm(); }, order);
  check((await page.evaluate(() => __blocks())).some(m => /contradicts the rule/.test(m)) && await page.evaluate(() => !$('pos-override-box').classList.contains('hidden')), 'manual POS against the rule blocks and asks for a reason');
  await page.evaluate(() => { $('inv-pos-reason').value = 'Adviser opinion dated 01-11-2026'; doRefreshForm(); });
  check(!(await page.evaluate(() => __blocks())).length && (await page.evaluate(() => collectDocFromForm().posReason)) === 'Adviser opinion dated 01-11-2026', 'with a recorded reason it is a warning, and the reason is kept');
  // g) services: recipient's location (Sec 12(2)) — no delivery question
  d = await page.evaluate(o => __fill({ ...o, buyerGstin: '27AAPFU0939F1ZV', ship: undefined, items: [{ desc: 'Erection service', hsn: '995461', gst: 18, qty: 1, rate: 10000, unit: 'OTH' }] }), order);
  check(d.pos === '27' && d.igst === 1800 && await page.evaluate(() => $('ship-mode-box').classList.contains('hidden')), 'services: POS = recipient\'s state 27 (Sec 12(2)) → IGST 1,800');
  await page.context().close();
}

/* ------------------------------------------------------------ 2. UTGST */
console.log('\n▶ UTGST (Union territory without legislature)');
{
  const page = await openApp({ ...COMPANY, gstin: SUP_UT, state: 'Chandigarh', stateCode: '04', address: 'Industrial Area, Chandigarh', pin: '160002' });
  const d = await page.evaluate(b => __fill({ buyerGstin: b, buyerAddress: 'Sector 17, Chandigarh', buyerPin: '160017' }), BUY_UT);
  // 1,000 × 9 % = 90 CGST + 90 UTGST
  check(d.cgst === 90 && d.sgst === 90 && d.calc.stLabel === 'UTGST', 'Chandigarh → Chandigarh: CGST 90 + UTGST 90');
  const t = await page.evaluate(dd => __page(dd), d);
  check(/UTGST @ 9%/.test(t) && !/SGST @/.test(t) && /UTGST/.test(await page.evaluate(() => $('form-summary').textContent)), 'invoice and editor say UTGST, not SGST');
  await page.context().close();
}

/* ------------------------------------------------------------ 3. composition */
console.log('\n▶ Composition taxpayer (Sec 10 CGST, Rule 5)');
{
  const page = await openApp({ ...COMPANY, scheme: 'composition' });
  await page.evaluate(() => __fill({ items: [{ desc: 'Bricks', hsn: '6901', gst: 18, qty: 10, rate: 100, unit: 'NOS' }] }));
  check((await page.evaluate(() => __blocks())).some(m => /composition scheme .* cannot charge GST/.test(m)), 'charging GST under composition is blocked');
  let d = await page.evaluate(() => __fill({ items: [{ desc: 'Bricks', hsn: '6901', gst: 0, qty: 10, rate: 100, unit: 'NOS' }] }));
  check(!(await page.evaluate(() => __blocks())).length && d.grandTotal === 1000, 'bill of supply without tax is accepted (total 1,000)');
  const t = await page.evaluate(dd => __page(dd), d);
  check(/BILL OF SUPPLY/.test(t) && /composition taxable person, not eligible to collect tax on supplies/.test(t), 'prints "BILL OF SUPPLY" with the composition declaration');
  await page.evaluate(b => __fill({ buyerGstin: b, items: [{ desc: 'Bricks', hsn: '6901', gst: 0, qty: 10, rate: 100, unit: 'NOS' }] }), BUY_MH);
  check((await page.evaluate(() => __blocks())).some(m => /cannot make inter-State outward supplies of goods/.test(m)), 'inter-state sale of goods under composition is blocked (Sec 10(2)(d))');
  await page.context().close();
}

/* ------------------------------------------------------------ 4. rates, cess, HSN, numbering, notes, exemptions */
console.log('\n▶ Rates (GST 2.0), cess, HSN, numbering, credit notes, 0 % lines');
{
  const oldInv = { id: 'OLD1', docType: 'INV', num: '05/25-26', date: '2025-05-10', supplyType: 'B2B', pos: '24', buyerName: 'Old Buyer', buyerGstin: BUY, buyerStateCode: '24', buyerAddress: 'Surat', buyerPin: '395002',
    items: [{ desc: 'Valve', hsn: '848180', gst: 12, qty: 10, rate: 1000, unit: 'NOS' }], payments: [], taxable: 10000, cgst: 600, sgst: 600, igst: 0, roundoff: 0, grandTotal: 11200 };
  const page = await openApp(COMPANY, [oldInv]);
  await page.evaluate(() => __fill({ items: [{ desc: 'Valve', hsn: '848180', gst: 12, qty: 1, rate: 1000, unit: 'NOS' }] }));
  check((await page.evaluate(() => __blocks())).some(m => /12% is not a GST rate on .*removed from 22-Sep-2025/.test(m)), '12 % on a document dated after 22-09-2025 is blocked');
  // credit note for 2 units of the pre-GST-2.0 invoice: keeps 12 %; dated 01-11-2026 (before 30-11-2026 deadline) → allowed
  await page.evaluate(() => { __fill({ docType: 'CRN', date: '2026-11-01', buyerName: 'Old Buyer', buyerGstin: '24AAACR5055K1ZD', items: [{ desc: 'Valve', hsn: '848180', gst: 12, qty: 2, rate: 1000, unit: 'NOS' }] }); $('inv-ref-id').value = 'OLD1'; $('inv-note-reason').value = 'Sales Return'; doRefreshForm(); });
  check(!(await page.evaluate(() => __blocks())).some(m => /not a GST rate/.test(m)), 'credit note against a pre-GST-2.0 invoice may use the original 12 %');
  await page.evaluate(() => { $('inv-date').value = '2026-12-01'; updateAutoInvoiceNumber(); doRefreshForm(); });
  check((await page.evaluate(() => __blocks())).some(m => /Credit note time limit crossed/.test(m)), 'credit note after 30-11-2026 for an FY 2025-26 invoice is blocked (Sec 34(2))');
  await page.evaluate(() => { $('inv-date').value = '2026-11-01'; updateAutoInvoiceNumber(); const r = document.querySelector('#invoice-items-body tr .item-gst'); setLineRate(r, 5); doRefreshForm(); });
  check((await page.evaluate(() => __blocks())).some(m => /differs from the 12% charged/.test(m)), 'credit note at a different rate from its invoice is blocked');
  await page.evaluate(() => __fill({ items: [{ desc: 'Cigarettes', hsn: '24022010', gst: 40, qty: 1, rate: 1000, unit: 'NOS' }] }));
  check((await page.evaluate(() => __blocks())).some(m => /compensation cess, which this app does not calculate/.test(m)), 'cess-attracting HSN is refused (no cess engine)');
  await page.evaluate(() => __fill({ buyerGstin: '24AAACR5055K1ZD', items: [{ desc: 'Bolt', hsn: '73', gst: 18, qty: 1, rate: 100, unit: 'NOS' }] }));
  check((await page.evaluate(() => __blocks())).some(m => /HSN needs at least 4 digits/.test(m)), 'B2B with a 2-digit HSN is blocked (Notfn 78/2020)');
  await page.evaluate(() => __fill({ items: [{ desc: 'Bolt', hsn: '', gst: 18, qty: 1, rate: 100, unit: 'NOS' }] }));
  const b2c = await page.evaluate(() => ({ b: __blocks(), w: __checks().filter(x => x.lvl === 'warn').map(x => x.msg) }));
  check(!b2c.b.some(m => /HSN/.test(m)) && b2c.w.some(m => /add the HSN\/SAC — GSTR-1 Table 12 needs it/.test(m)), 'B2C under ₹5 cr: HSN optional on the invoice, but flagged for GSTR-1');
  await page.evaluate(() => { __fill({}); $('inv-num').value = 'HGI/INV/2026-27/0001'; doRefreshForm(); });
  check((await page.evaluate(() => __blocks())).some(m => /max 16 allowed/.test(m)), 'invoice number over 16 characters is blocked (Rule 46(b))');
  // 0 % line must be classified (nil / exempt / non-GST) — offered in the rate list
  const opts = await page.evaluate(() => { __fill({}); return [...document.querySelector('#invoice-items-body tr .item-gst').options].map(o => o.value).filter(v => v.startsWith('0|')); });
  check(opts.join() === '0|nil,0|exempt,0|nongst', 'rate list offers 0 % nil-rated / exempt / non-GST');
  await page.context().close();
}

/* ------------------------------------------------------------ 5. returns */
console.log('\n▶ GSTR-1: B2CL threshold by date, Table 8, UTGST column');
{
  const mk = (id, num, date, total, extra = {}) => ({ id, docType: 'INV', num, date, supplyType: 'B2C', pos: '27', buyerName: 'Retail ' + id, buyerStateCode: '27', buyerAddress: 'Pune', buyerPin: '411001',
    items: [{ desc: 'Machine', hsn: '8483', gst: 18, qty: 1, rate: total, unit: 'NOS' }], payments: [], ...extra });
  const page = await openApp(COMPANY, [
    // ₹2,00,000 + 18 % = ₹2,36,000 inter-state B2C: below ₹2.5 lakh in July 2024 (B2CS), above ₹1 lakh in August 2024 (B2CL)
    mk('J', '10/24-25', '2024-07-15', 200000), mk('A', '20/24-25', '2024-08-15', 200000),
    { id: 'E', docType: 'INV', num: '30/26-27', date: '2026-10-05', supplyType: 'B2B', pos: '24', buyerName: 'Reg Buyer', buyerGstin: BUY, buyerStateCode: '24', buyerAddress: 'Surat', buyerPin: '395002',
      items: [{ desc: 'Fresh vegetables', hsn: '0701', gst: 0, taxability: 'exempt', qty: 1, rate: 5000, unit: 'KGS' }, { desc: 'Pump', hsn: '8413', gst: 18, qty: 1, rate: 10000, unit: 'NOS' }], payments: [] }]);
  const r = await page.evaluate(() => { state.invoices.forEach(d => Object.assign(d, totalsOf(computeDoc(d)))); const j = buildReturns('2024-07'), a = buildReturns('2024-08'), o = buildReturns('2026-10'); return { jb2cl: j.b2cl.length, jb2cs: Object.keys(j.b2cs).length, ab2cl: a.b2cl.length, nil: o.nil, b2bRates: o.b2b.map(x => x[8]) }; });
  check(r.jb2cl === 0 && r.jb2cs === 1 && r.ab2cl === 1, `₹2.36 lakh inter-state B2C: B2CS in July 2024, B2CL from August 2024 (${JSON.stringify(r).slice(0, 80)})`);
  check(r.nil.intraReg.exempt === 5000 && !r.b2bRates.includes('0'), 'exempt line reported in Table 8 (intra-state, registered: ₹5,000) and not in Table 4');
  await page.evaluate(() => { switchTab('returns'); $('ret-month').value = '2026-10'; renderReturns(); });
  check(await page.evaluate(() => /SGST\/UTGST/.test($('ret-sections').textContent) && /Nil-rated, exempt and non-GST/.test($('ret-sections').textContent)), 'returns screen shows Table 8 and the SGST/UTGST column');
  await page.context().close();
}

/* ------------------------------------------------------------ 6. audit of existing records: flag, never change */
console.log('\n▶ Audit of saved invoices — flagged, not changed; correction history');
{
  // like the real 62/26-27: same-name consignee in Rajasthan, POS 08 / IGST chosen by v9.2, no delivery fact recorded
  const legacy = { id: 'L62', docType: 'INV', num: '62/26-27', date: '2026-11-03', supplyType: 'B2B', pos: '08', buyerName: 'Buyer Energy Pvt Ltd', buyerGstin: BUY, buyerStateCode: '24', buyerState: 'Gujarat', buyerAddress: 'Ring Road, Surat', buyerPin: '395002',
    shipName: 'Buyer Energy Pvt Ltd', shipGstin: BUY, shipStateCode: '08', shipState: 'Rajasthan', shipAddress: 'Project site, Devikot', shipPin: '345001',
    items: [{ desc: 'MS Structure', hsn: '730890', gst: 18, qty: 1, rate: 107499, unit: 'NOS' }], payments: [], taxable: 107499, cgst: 0, sgst: 0, igst: 19349.82, roundoff: 0.18, grandTotal: 126849 };
  // stored totals that no longer match the items (e.g. typed by an older version / imported)
  const drift = { id: 'DR1', docType: 'INV', num: '63/26-27', date: '2026-11-03', supplyType: 'B2B', pos: '24', buyerName: 'Drift Buyer', buyerGstin: BUY, buyerStateCode: '24', buyerAddress: 'Surat', buyerPin: '395002',
    items: [{ desc: 'Pump', hsn: '8413', gst: 18, qty: 2, rate: 1000, unit: 'NOS' }], payments: [], taxable: 2000, cgst: 170, sgst: 170, igst: 0, roundoff: 0, grandTotal: 2340 };
  const clean = { id: 'OK1', docType: 'INV', num: '64/26-27', date: '2026-11-03', supplyType: 'B2B', pos: '24', buyerName: 'Clean Buyer', buyerGstin: BUY, buyerStateCode: '24', buyerAddress: 'Surat', buyerPin: '395002',
    items: [{ desc: 'Pump', hsn: '8413', gst: 18, qty: 2, rate: 1000, unit: 'NOS' }], payments: [], taxable: 2000, cgst: 180, sgst: 180, igst: 0, roundoff: 0, grandTotal: 2360 };
  const page = await openApp(COMPANY, [legacy, drift, clean]);
  const before = await page.evaluate(() => JSON.stringify(state.invoices));
  check(await page.evaluate(() => state.invoices.find(d => d.id === 'DR1').cgst === 170), 'loading does not silently recompute stored totals (v9.2 did)');
  const res = await page.evaluate(() => runGstAudit());
  const after = await page.evaluate(() => JSON.stringify(state.invoices));
  check(before === after, 'audit leaves every saved document byte-for-byte unchanged');
  check(res.total === 3 && res.flagged === 2 && res.docs.L62 && res.docs.DR1 && !res.docs.OK1, `audit flags the bill-to/ship-to record and the total drift, passes the clean one (${res.flagged}/${res.total})`);
  check(res.docs.L62.msgs.some(m => /not based on a stated fact .*Confirm who received the goods/.test(m.msg)) && res.docs.DR1.msgs.some(m => /Saved CGST 170\.00 differs from today's tax engine \(180\.00\)/.test(m.msg)), 'findings say what is wrong and what to do');
  await page.evaluate(() => { switchTab('returns'); renderReturns(); });
  check(await page.evaluate(() => /2<\/strong> of 3 saved document/.test($('gst-audit-out').innerHTML) && /62\/26-27/.test($('gst-audit-out').textContent)), 'Returns screen lists the flagged documents with an Open button');
  await page.evaluate(() => { previewDoc = { ...state.invoices.find(d => d.id === 'L62') }; previewDoc.calc = computeDoc(previewDoc); renderPreviewPages(['ORIGINAL FOR RECIPIENT']); });
  check(await page.evaluate(() => !!document.querySelector('#invoice-preview-container .gst-flag.no-print') && !document.querySelector('#invoice-preview-container .gst-draft-mark')), 'opening a flagged saved invoice shows an on-screen review flag (not printed, record unchanged)');
  // correction: open, state the fact, save → previous version kept in history
  await page.evaluate(() => { editInvoice('L62'); setShipMode('third'); posManual = false; $('inv-ship-gstin').value = ''; doRefreshForm(); });
  check(await page.evaluate(() => __save()) === true, 'corrected invoice saves');
  const h = await page.evaluate(() => state.invoices.find(d => d.id === 'L62'));
  check(h.pos === '24' && h.cgst === 9674.91 && h.history && h.history.length === 1 && h.history[0].before.pos === '08' && h.history[0].before.igst === 19349.82 && h.history[0].changed.includes('pos'),
    'correction history keeps the version as issued (POS 08, IGST 19,349.82) and what changed');
  check(await page.evaluate(() => /issue a credit note|credit note \+ fresh invoice/i.test(JSON.stringify(state.gstAudit.docs.L62))), 'advice for an already-issued invoice is credit note + fresh invoice (taken with the adviser)');
  await page.context().close();
}

/* ------------------------------------------------------------ 7. drafts, e-way bill age, export */
console.log('\n▶ Draft marking, e-way bill age, export / LUT');
{
  const page = await openApp();
  await page.evaluate(b => { __fill({ buyerGstin: b, ship: { name: 'Site', address: 'Devikot', pin: '345001', stateCode: '08' } }); renderPreview(); }, BUY);
  check(await page.evaluate(() => !!document.querySelector('#invoice-preview-container .gst-draft-mark') && /NOT A VALID TAX INVOICE/.test(document.querySelector('#invoice-preview-container .gst-draft-mark').textContent)), 'preview of an unresolved draft is watermarked "DRAFT — not a valid tax invoice"');
  const old = await page.evaluate(() => { const dt = addDays(todayISO(), -200); __fill({ date: dt, items: [{ desc: 'Pump', hsn: '8413', gst: 18, qty: 1, rate: 60000, unit: 'NOS' }] }); return __checks().filter(x => x.lvl === 'warn').map(x => x.msg); });
  check(old.some(m => /more than 180 days old — the e-way bill portal will not generate/.test(m)), 'goods invoice > ₹50,000 dated 200 days ago: warns the e-way bill portal will refuse it');
  await page.evaluate(() => __fill({ supplyType: 'EXPWOP', buyerName: 'Overseas Co', buyerAddress: 'Dubai, UAE' }));
  check((await page.evaluate(() => __blocks())).some(m => /LUT ARN/.test(m)), 'export under LUT without an LUT ARN is blocked (Rule 96A)');
  await page.context().close();
}

{
  const page = await openApp();
  const csv = await page.evaluate(() => toCSV([['=HYPERLINK("x")', '-5', '+91 98765', '@SUM(A1)', 'normal', -3, '-12.50']]));
  check(csv.includes(`"'=HYPERLINK(""x"")"`) && csv.includes('"-5"') && csv.includes(`"'+91 98765"`) && csv.includes(`"'@SUM(A1)"`) && csv.includes('"-3"') && csv.includes('"-12.50"'), 'CSV export: formula-like text neutralised, numbers untouched');
  await page.context().close();
}
check(!errors.length, `no page errors${errors.length ? ' — ' + errors.slice(0, 3).join(' | ') : ''}`);
fs.writeFileSync(path.join(OUT, 'gst-compliance-results.txt'), lines.join('\n') + `\n\n${passes} passed, ${failures} failed\n`);
console.log(`\n${passes} passed, ${failures} failed`);
await browser.close(); server.close();
process.exit(failures ? 1 : 0);
