#!/usr/bin/env node
// v8.3 smart product search: real app (www/) in Chromium, phone + desktop, with a catalogue of 100+ products in
// categories and sizes, plus a 5,000-product speed test. Screenshots → tests/out/picker-*.png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WWW = path.join(root, 'www'), OUT = path.join(root, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', png: 'image/png', svg: 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html')));
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
let pass = 0, fail = 0;
const check = (c, m) => { c ? pass++ : fail++; console.log(`   ${c ? '✓' : '✗'} ${m}`); };

// ---------------------------------------------------------------- catalogue (built in the page)
function catalogue() {
  const P = [];
  let n = 0;
  const add = (category, group, sizes, o) => sizes.forEach(([size, rate], i) => P.push({ id: 'P' + (++n), name: `${group} ${size}`, category, group, size, rate, hsn: o.hsn, gst: o.gst ?? 18, unit: o.unit || 'NOS',
    sku: o.sku ? `${o.sku}-${String(size).replace(/[^0-9a-z.]/gi, '').toUpperCase()}` : '', specs: o.specs || '', trackStock: !!o.stock, openingStock: o.stock ? o.stock + i * 10 : 0, minStock: o.stock ? 5 : 0 }));
  add('Pipes', 'DWC Pipe', [['110mm', 340], ['40mm', 120], ['63mm', 180], ['90mm', 260], ['160mm', 520], ['200mm', 780]], { hsn: '39172390', unit: 'MTR', sku: 'DWC', specs: 'HDPE double wall corrugated, IS 16205', stock: 100 });
  add('Pipes', 'PVC Pipe', [['20mm', 45], ['25mm', 60], ['32mm', 82], ['40mm', 110], ['50mm', 150], ['63mm', 210], ['75mm', 290], ['90mm', 380], ['110mm', 520]], { hsn: '39172310', unit: 'MTR', sku: 'PVC', specs: '6 kg/cm², ISI marked' });
  add('Pipes', 'HDPE Pipe', [['20mm', 30], ['25mm', 42], ['32mm', 66], ['40mm', 98], ['50mm', 140], ['63mm', 205], ['90mm', 410], ['110mm', 600]], { hsn: '39172190', unit: 'MTR', sku: 'HDPE', specs: 'PE100, PN10' });
  add('Pipes', 'GI Pipe', [['1/2 inch', 210], ['3/4 inch', 270], ['1 inch', 380], ['1.5 inch', 560], ['2 inch', 720]], { hsn: '73063090', unit: 'MTR', sku: 'GI', specs: 'Medium class' });
  for (const f of ['Elbow 90°', 'Equal Tee', 'Coupler', 'Reducer', 'End Cap']) add('Fittings', `PVC ${f}`, [['20mm', 12], ['25mm', 16], ['32mm', 24], ['40mm', 35], ['50mm', 52], ['63mm', 80]], { hsn: '39174000', sku: 'F' + f.slice(0, 2).toUpperCase(), specs: 'Solvent weld' });
  add('Valves', 'Ball Valve', [['15mm', 180], ['20mm', 230], ['25mm', 310], ['32mm', 450], ['40mm', 620], ['50mm', 840]], { hsn: '84818030', sku: 'BV', specs: 'Brass, full bore', stock: 20 });
  add('Valves', 'Gate Valve', [['50mm', 1450], ['80mm', 2600], ['100mm', 3900]], { hsn: '84818030', sku: 'GV', specs: 'CI body, PN16' });
  add('Valves', 'Butterfly Valve', [['80mm', 2100], ['100mm', 2850], ['150mm', 4700]], { hsn: '84818090', sku: 'BFV', specs: 'Wafer type' });
  add('Pumps', 'Monoblock Pump', [['0.5 HP', 4200], ['1 HP', 5600], ['1.5 HP', 7400], ['2 HP', 9100], ['3 HP', 12800], ['5 HP', 19500]], { hsn: '84137010', sku: 'MB', specs: 'Single phase up to 1.5 HP', stock: 3 });
  add('Pumps', 'Submersible Pump', [['1 HP', 11800], ['1.5 HP', 14200], ['2 HP', 17600]], { hsn: '84137010', sku: 'SUB', specs: 'V4 borewell' });
  for (const f of ['Elbow 90°', 'Equal Tee', 'Coupler', 'Female Adapter', 'Union']) add('Fittings', `CPVC ${f}`, [['15mm', 18], ['20mm', 24], ['25mm', 33], ['32mm', 52], ['40mm', 78], ['50mm', 115]], { hsn: '39174000', sku: 'C' + f.slice(0, 2).toUpperCase(), specs: 'SDR 11, hot & cold' });
  add('Electricals', 'Copper Cable', [['1 sqmm', 1150], ['1.5 sqmm', 1650], ['2.5 sqmm', 2600], ['4 sqmm', 4100], ['6 sqmm', 6000]], { hsn: '85444999', unit: 'ROL', sku: 'CU', specs: 'FR, 90 m coil' });
  P.push({ id: 'L1', name: 'MS Flange 2 Inch', hsn: '73079190', gst: 18, unit: 'NOS', rate: 260 });         // older product: no category/size fields
  P.push({ id: 'L2', name: 'Teflon Tape', hsn: '39199090', gst: 18, unit: 'NOS', rate: 15 });
  P.push({ id: 'L3', name: 'Pipe Clamp 110 mm', hsn: '73269099', gst: 18, unit: 'NOS', rate: 22 });
  return P;
}

const browser = await chromium.launch();
async function run(vp) {
  console.log(`\n▶ ${vp.name}`);
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(base); await page.waitForFunction(() => window.HGI_READY === true);
  await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]');
  await page.waitForTimeout(300);
  const P = catalogue();
  await page.evaluate(products => {
    const ob = document.getElementById('onboarding'); if (ob) ob.remove();
    Object.assign(state.company, { name: 'Shree Pipes & Pumps', gstin: '24AAPFU0939F1Z1', stateCode: '24', state: 'Gujarat', address: 'Naroda GIDC', pin: '382330' });
    state.ui.onboarded = true; state.products = products;
    // history: Ball Valve 25mm billed 4×, PVC Pipe 63mm 2×, DWC Pipe 110mm 1× (stock 100 − 7 = 93)
    const doc = (n, date, items) => ({ id: 'H' + n, docType: 'INV', num: 'H/' + n, date, buyerName: 'Old Buyer', buyerGstin: '24AAPFU0939F1Z1', pos: '24', items, payments: [], grandTotal: 0, taxable: 0 });
    const it = (desc, qty, rate) => ({ desc, hsn: '84818030', gst: 18, qty, unit: 'NOS', rate });
    state.invoices = [doc(1, '2026-10-01', [it('Ball Valve 25mm', 1, 310)]), doc(2, '2026-10-03', [it('Ball Valve 25mm', 2, 310), it('PVC Pipe 63mm', 10, 210)]),
      doc(3, '2026-10-05', [it('Ball Valve 25mm', 1, 310), it('DWC Pipe 110mm', 7, 340)]), doc(4, '2026-10-06', [it('Ball Valve 25mm', 1, 310), it('PVC Pipe 63mm', 5, 210)])];
    saveState(); refreshProductDatalist(); renderAll(); newDocument('INV');
  }, P);
  check(P.length >= 100 && new Set(P.map(p => p.category).filter(Boolean)).size === 5, `catalogue: ${P.length} products, 5 categories, sizes per product`);
  const q = '#pk-q';
  const ids = () => page.$$eval('#pk-results .pk-v', els => els.map(e => e.dataset.id));
  const name = id => P.find(p => p.id === id)?.name;
  const type = async text => { await page.fill(q, ''); await page.type(q, text, { delay: 5 }); await page.waitForTimeout(30); };

  // open from the description cell
  await page.evaluate(() => switchTab('create-invoice'));
  await page.click('#invoice-items-body tr:first-child .item-desc');
  check(await page.isVisible('#product-picker') && await page.evaluate(() => document.activeElement && document.activeElement.id === 'pk-q'), 'tapping the item description opens the product search with the cursor in the search box');
  const home = await page.$$eval('#pk-results .pk-sec-t', els => els.map(e => e.childNodes[0].textContent.trim()));
  check(home.includes('Recently used') && home.includes('Frequently billed') && home.includes('All products'), `start view: ${home.join(' · ')}`);
  const freqFirst = await page.$eval('#pk-results', r => { const s = [...r.querySelectorAll('.pk-sec')].find(x => /Frequently/.test(x.textContent)); return s ? s.querySelector('.pk-v').dataset.id : ''; });
  const recFirst = await page.$eval('#pk-results', r => { const s = [...r.querySelectorAll('.pk-sec')].find(x => /Recently/.test(x.textContent)); return s ? [...s.querySelectorAll('.pk-v')].map(v => v.dataset.id) : []; });
  check(recFirst.slice(0, 2).map(name).sort().join() === 'Ball Valve 25mm,PVC Pipe 63mm' && name(recFirst[2]) === 'DWC Pipe 110mm', `recently used from past invoices, newest first (${recFirst.slice(0, 3).map(name).join(', ')})`);
  check(name(freqFirst) === 'Ball Valve 25mm', `frequently billed: most billed first (${name(freqFirst)}, billed 4×)`);
  await page.screenshot({ path: path.join(OUT, `picker-${vp.name}-1-start.png`) });

  // grouping by category → product → sizes, sizes in numeric order
  await page.click('#pk-cats button[data-cat="Pipes"]');
  const dwc = await page.$eval('#pk-results', r => { const c = [...r.querySelectorAll('.pk-card')].find(x => (x.querySelector('.pk-g-name') || {}).textContent === 'DWC Pipe'); return c ? [...c.querySelectorAll('.pk-v-name')].map(x => x.textContent) : []; });
  check(dwc.join(',') === '40mm,63mm,90mm,110mm,160mm,200mm', `DWC Pipe grouped with its sizes in order: ${dwc.join(' · ')}`);
  const priceShown = await page.$eval('#pk-results', r => { const c = [...r.querySelectorAll('.pk-card')].find(x => (x.querySelector('.pk-g-name') || {}).textContent === 'DWC Pipe'); return c.querySelector('.pk-v').textContent.replace(/\s+/g, ' '); });
  check(/₹120\.00/.test(priceShown) && /MTR/.test(priceShown) && /in stock/.test(priceShown), `size shows price, unit and stock (${priceShown.trim().slice(0, 60)})`);
  await page.screenshot({ path: path.join(OUT, `picker-${vp.name}-2-category.png`) });
  await page.click('#pk-cats button[data-cat=""]');

  // search fields
  await type('dwc 110'); let r = await ids();
  check(name(r[0]) === 'DWC Pipe 110mm', `"dwc 110" → ${name(r[0])}`);
  await type('PVC-75MM'); r = await ids();
  check(name(r[0]) === 'PVC Pipe 75mm', `SKU "PVC-75MM" → ${name(r[0])}`);
  await type('63 mm'); const a63 = (await ids()).map(name); await type('63mm'); const b63 = (await ids()).map(name);
  check(a63.length >= 8 && a63.every(n => /63/.test(n)) && a63.join() === b63.join(), `"63 mm" and "63mm" find the same ${a63.length} products`);
  await type('pn10'); r = (await ids()).map(name);
  check(r.length === 8 && r.every(n => /^HDPE Pipe/.test(n)), `specification "PN10" → ${r.length} HDPE sizes`);
  await type('valves'); r = (await ids()).map(name);
  check(r.length === 12 && r.every(n => /Valve/.test(n)), `category "valves" → ${r.length} valves`);
  await type('flange'); const fl = await page.$eval('#pk-results', r => { const v = r.querySelector('.pk-v'); return v ? v.textContent.replace(/\s+/g, ' ').trim() : ''; });
  check(/MS Flange 2 Inch/.test(fl), 'older product without catalogue fields is still found');
  const det = await page.evaluate(() => { const e = HGI_PICKER.index().byId.get('L3'); return e.group + ' | ' + e.size; });
  check(det === 'Pipe Clamp | 110 mm', `size read from an older name ("Pipe Clamp 110 mm" → ${det})`);
  await type('zzzz-nothing'); check(await page.isVisible('#pk-results .pk-empty') && await page.isVisible('#pk-custom'), 'no match: friendly empty state + "use as typed"');

  // keyboard: type, ↓, Enter, Ctrl+Enter → row filled by the app's own rules
  await type('ball valve 25');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  check(await page.$eval('#pk-results .pk-v.act', e => e.classList.contains('on')), 'keyboard: ↓ highlights, Enter selects');
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(200);
  let rows = await page.$$eval('#invoice-items-body tr', trs => trs.map(tr => ({ d: tr.querySelector('.item-desc').value, h: tr.querySelector('.item-hsn').value, g: tr.querySelector('.item-gst').value, q: tr.querySelector('.item-qty').value, u: tr.querySelector('.item-unit').value, r: tr.querySelector('.item-rate').value })));
  check(!(await page.isVisible('#product-picker')) && rows.length === 1 && rows[0].d === 'Ball Valve 25mm' && rows[0].h === '84818030' && rows[0].g === '18' && rows[0].u === 'NOS' && Number(rows[0].r) === 310 && rows[0].q === '1',
    `Ctrl+Enter adds it: ${JSON.stringify(rows[0])}`);

  // multi-select with quantities from the "Search & add items" button
  await page.click('#btn-pick-items');
  await type('dwc pipe'); await page.click(`#pk-results .pk-v[data-id="${P.find(p => p.name === 'DWC Pipe 63mm').id}"]`);
  await page.click(`#pk-results .pk-v[data-id="${P.find(p => p.name === 'DWC Pipe 90mm').id}"]`);
  await type('monoblock 1 hp'); await page.click(`#pk-results .pk-v[data-id="${P.find(p => p.name === 'Monoblock Pump 1 HP').id}"]`);
  const id63 = P.find(p => p.name === 'DWC Pipe 63mm').id;
  await page.click(`#pk-tray [data-inc="${id63}"]`); await page.click(`#pk-tray [data-inc="${id63}"]`);
  await page.fill(`#pk-tray input[data-qty="${P.find(p => p.name === 'DWC Pipe 90mm').id}"]`, '12'); await page.dispatchEvent(`#pk-tray input[data-qty="${P.find(p => p.name === 'DWC Pipe 90mm').id}"]`, 'change');
  const tray = await page.textContent('#pk-tray .pk-sum');
  check(/3 items/.test(tray) && /₹9,260\.00/.test(tray), `tray: ${tray.replace(/\s+/g, ' ').trim()} (3×180 + 12×260 + 1×5,600)`);
  // tapping a selected size again unselects it — it never becomes two rows
  await type('dwc pipe 63'); await page.click(`#pk-results .pk-v[data-id="${id63}"]`); await page.click(`#pk-results .pk-v[data-id="${id63}"]`);
  check(await page.evaluate(id => HGI_PICKER._sel().get(id), id63) === 1, 'double tap = select / unselect, never a duplicate (quantity via the tray)');
  await page.click(`#pk-tray [data-inc="${id63}"]`); await page.click(`#pk-tray [data-inc="${id63}"]`);
  await page.screenshot({ path: path.join(OUT, `picker-${vp.name}-3-multi.png`) });
  await page.click('#pk-add'); await page.waitForTimeout(200);
  rows = await page.$$eval('#invoice-items-body tr', trs => trs.map(tr => [tr.querySelector('.item-desc').value, Number(tr.querySelector('.item-qty').value), Number(tr.querySelector('.item-rate').value), tr.querySelector('.item-unit').value]));
  const byName = Object.fromEntries(rows.map(r => [r[0], r]));
  check(rows.length === 4 && byName['DWC Pipe 63mm'][1] === 3 && byName['DWC Pipe 90mm'][1] === 12 && byName['Monoblock Pump 1 HP'][1] === 1 && byName['DWC Pipe 63mm'][3] === 'MTR' && byName['Monoblock Pump 1 HP'][2] === 5600,
    `3 items added in one go: ${rows.slice(1).map(r => r[0] + ' ×' + r[1]).join(', ')}`);

  // duplicate protection: picking an item already on the invoice raises its quantity
  await page.click('#btn-pick-items'); await type('ball valve 25');
  const badge = await page.$eval('#pk-results .pk-v', v => v.textContent);
  check(/On invoice × 1/.test(badge), 'items already on the invoice are marked "On invoice × 1"');
  await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  rows = await page.$$eval('#invoice-items-body tr', trs => trs.map(tr => [tr.querySelector('.item-desc').value, Number(tr.querySelector('.item-qty').value)]));
  check(rows.length === 4 && rows[0][1] === 2, `same item again → quantity 2 on the existing row, no second row (${rows.length} rows)`);

  // price / quantity still editable on the row, and GST maths unchanged
  const mbRow = await page.$$eval('#invoice-items-body tr', trs => trs.findIndex(tr => tr.querySelector('.item-desc').value === 'Monoblock Pump 1 HP') + 1);
  await page.fill(`#invoice-items-body tr:nth-child(${mbRow}) .item-rate`, '5500'); await page.dispatchEvent(`#invoice-items-body tr:nth-child(${mbRow}) .item-rate`, 'input');
  await page.fill('#inv-buyer-name', 'Patel Agro'); await page.fill('#inv-buyer-gstin', '24ABCDE1234F1Z5'); await page.dispatchEvent('#inv-buyer-gstin', 'input');
  await page.fill('#inv-buyer-address', 'Mehsana'); await page.fill('#inv-buyer-pin', '384002');
  await page.waitForTimeout(400);
  const doc = await page.evaluate(() => { const d = collectDocFromForm(); return { taxable: d.taxable, cgst: d.cgst, sgst: d.sgst, igst: d.igst, total: d.grandTotal }; });
  const taxable = 2 * 310 + 3 * 180 + 12 * 260 + 1 * 5500;
  check(doc.taxable === taxable && doc.cgst === Math.round(taxable * 0.09 * 100) / 100 && doc.sgst === doc.cgst && doc.igst === 0 && doc.total === Math.round(taxable * 1.18),
    `GST unchanged: taxable ₹${doc.taxable} (expected ₹${taxable}), CGST ${doc.cgst} + SGST ${doc.sgst}, total ₹${doc.total}`);
  check(await page.evaluate(() => saveCurrentInvoice()) === true, 'invoice with picked items saves');

  // stock shown = the app's stock figure; favourites persist; recent updated
  await page.evaluate(() => newDocument('INV'));
  await page.click('#invoice-items-body tr:first-child .item-desc'); await type('dwc 110');
  const st = await page.evaluate(() => { const p = state.products.find(x => x.name === 'DWC Pipe 110mm'); return { shown: document.querySelector('#pk-results .pk-v .pk-stock').textContent, real: stockOf(p) }; });
  check(st.shown.startsWith(String(st.real)) && st.real === 93, `stock shown "${st.shown}" = app stock ${st.real}`);
  await page.click('#pk-results .pk-v .pk-star');
  await page.fill(q, ''); await page.dispatchEvent(q, 'input');
  const favSec = await page.$eval('#pk-results', r => { const s = [...r.querySelectorAll('.pk-sec')].find(x => /Favourites/.test(x.textContent)); return s ? [...s.querySelectorAll('.pk-v-name')].map(x => x.textContent) : []; });
  const recNow = await page.$eval('#pk-results', r => { const s = [...r.querySelectorAll('.pk-sec')].find(x => /Recently/.test(x.textContent)); return s ? [...s.querySelectorAll('.pk-v-name')].map(x => x.textContent) : []; });
  check(favSec.join() === 'DWC Pipe 110mm', `star → Favourites: ${favSec.join()}`);
  check(recNow[0] === 'Ball Valve 25mm' && recNow.includes('Monoblock Pump 1 HP'), `recently used now: ${recNow.slice(0, 4).join(', ')}`);
  await page.keyboard.press('Escape');
  check(!(await page.isVisible('#product-picker')), 'Esc closes the search');
  await page.keyboard.press('Control+k');
  check(await page.isVisible('#product-picker'), 'Ctrl+K opens it from the invoice screen');
  await type('Labour charges'); await page.click('#pk-custom'); await page.waitForTimeout(100);
  check(await page.$eval('#invoice-items-body tr:first-child .item-desc', e => e.value) === 'Labour charges', 'free-text item still possible ("use as typed")');
  await page.reload(); await page.waitForFunction(() => window.HGI_READY === true);
  if (await page.isVisible('#login-overlay')) { await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]'); await page.waitForTimeout(200); }
  check(await page.evaluate(() => state.products.find(x => x.name === 'DWC Pipe 110mm').fav === true && true), 'favourite kept after restart');

  // product form: several sizes at once
  await page.evaluate(() => { switchTab('items'); openItemModal(); });
  await page.fill('#modal-item-category', 'Pipes'); await page.fill('#modal-item-group', 'SWR Pipe'); await page.fill('#modal-item-hsn', '39172390'); await page.fill('#modal-item-unit', 'MTR');
  await page.fill('#modal-item-multi', '75mm:150, 110mm:240'); await page.click('#item-modal button[onclick="saveItemFromModal()"]');
  const swr = await page.evaluate(() => state.products.filter(p => p.group === 'SWR Pipe').map(p => `${p.name}|${p.size}|${p.rate}|${p.category}`));
  check(swr.join(';') === 'SWR Pipe 75mm|75mm|150|Pipes;SWR Pipe 110mm|110mm|240|Pipes', `Items: "several sizes at once" creates ${swr.length} products`);

  if (vp.name === 'desktop-1366') {
    // speed with 5,000 products (not saved)
    const perf = await page.evaluate(() => {
      const keep = state.products;
      const big = [];
      for (let i = 0; i < 5000; i++) big.push({ id: 'X' + i, name: `Item ${i} Grade ${i % 40} ${10 + (i % 25) * 5}mm`, category: 'Cat ' + (i % 12), group: `Item ${i} Grade ${i % 40}`, size: `${10 + (i % 25) * 5}mm`, sku: 'SK' + i, specs: 'spec ' + (i % 300), rate: i, hsn: '8481', gst: 18, unit: 'NOS', trackStock: i % 3 === 0, openingStock: 50 });
      state.products = big;
      switchTab('create-invoice');
      const t0 = performance.now(); HGI_PICKER.open(null, ''); const openMs = performance.now() - t0;
      const q = document.getElementById('pk-q'); const times = [];
      let top = '';
      for (const s of ['i', 'it', 'ite', 'item 4', 'item 49', 'item 499', 'grade 7 45mm', 'spec 299', 'sk4321']) { const a = performance.now(); q.value = s; q.dispatchEvent(new Event('input')); times.push(performance.now() - a); }
      top = document.querySelector('#pk-results .pk-v') && document.querySelector('#pk-results .pk-v').dataset.id;
      HGI_PICKER.close(); state.products = keep;
      return { openMs, max: Math.max(...times), avg: times.reduce((a, b) => a + b, 0) / times.length, top };
    });
    check(perf.openMs < 400 && perf.max < 120, `5,000 products: open ${perf.openMs.toFixed(0)} ms, each keystroke ≤ ${perf.max.toFixed(0)} ms (avg ${perf.avg.toFixed(0)} ms, search + render)`);
    check(perf.top === 'X4321', `SKU search among 5,000 → exact item first (${perf.top})`);
  }
  check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await ctx.close();
}
await run({ name: 'phone-412', w: 412, h: 915, mobile: true });
await run({ name: 'desktop-1366', w: 1366, h: 900, mobile: false });
await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
