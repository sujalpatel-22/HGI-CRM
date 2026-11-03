#!/usr/bin/env node
// v9.1 checks in Chromium (web build): PIN code → state / code / district for each address block, place of supply,
// Proforma Invoice, Purchase Order (to supplier), Customer PO, conversion to GST invoice, PDFs (preview pages), sharing text.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WWW = path.join(root, 'www'), OUT = path.join(root, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', png: 'image/png', svg: 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html')));
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
let pass = 0, fail = 0;
const check = (c, m) => { c ? pass++ : fail++; console.log(`   ${c ? '✓' : '✗'} ${m}`); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('dialog', d => d.accept());
await page.goto(base); await page.waitForFunction(() => window.HGI_READY === true);
await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const ob = document.getElementById('onboarding'); if (ob) ob.remove(); state.ui.onboarded = true;
  Object.assign(state.company, { name: 'HARI GURU INDUSTRIES', legalName: 'HARI GURU INDUSTRIES', gstin: '24AAACH7409R1Z7', state: 'Gujarat', stateCode: '24', pin: '382330',
    address: 'Plot 123, GIDC Naroda, Ahmedabad', phone: '9876500000', bankName: 'State Bank of India', bankAcc: '30011122233', bankIfsc: 'SBIN0001234', bankBranch: 'Naroda', upiId: 'hariguru@sbi', aato: 'upto5' });
  state.customers = []; state.invoices = []; state.products = [{ id: 'P1', name: 'Monoblock Pump 1HP', hsn: '84137010', gst: 18, rate: 5000, unit: 'NOS', trackStock: true, openingStock: 5 }];
  saveState(); renderAll();
});
const v = id => page.$eval('#' + id, e => e.value);
const txt = id => page.$eval('#' + id, e => e.innerText).catch(() => '');
const typeInto = async (id, value) => { await page.evaluate(([id, value]) => { const el = document.getElementById(id); el.scrollIntoView({ block: 'center' }); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, value]); await page.waitForTimeout(450); };
const pickChip = async (sel) => { await page.evaluate(s => document.querySelector(s).click(), sel); await page.waitForTimeout(450); };
const newDoc = async t => { await page.evaluate(t => newDocument(t), t); await page.waitForTimeout(200); };
const addItem = (desc, qty, rate, hsn = '84137010', gst = 18) => page.evaluate(([desc, qty, rate, hsn, gst]) => {
  const tr = document.querySelector('#invoice-items-body tr:last-child');
  tr.querySelector('.item-desc').value = desc; tr.querySelector('.item-qty').value = qty; tr.querySelector('.item-rate').value = rate;
  tr.querySelector('.item-hsn').value = hsn; tr.querySelector('.item-gst').value = gst; tr.querySelector('.item-unit').value = 'NOS'; refreshForm();
}, [desc, qty, rate, hsn, gst]).then(() => page.waitForTimeout(300));
const calc = () => page.evaluate(() => { const d = collectDocFromForm(); return { pos: d.pos, igst: d.calc.igst, cgst: d.calc.cgst, sgst: d.calc.sgst, inter: d.calc.isInter, total: d.calc.grandTotal }; });
const save = async () => { await page.evaluate(() => saveCurrentInvoice()); await page.waitForTimeout(250); return page.evaluate(() => JSON.parse(JSON.stringify(state.invoices.find(x => x.id === currentEditId) || null))); };
const preview = async () => { await page.evaluate(() => renderPreview()); await page.waitForTimeout(300); return page.$eval('#invoice-preview-container', e => e.innerText); };

/* ---------------------------------------------------------------- PIN codes */
console.log('▶ PIN code → state, state code, city / district');
check(await page.evaluate(async () => { await HGI_PIN.load(); return (await HGI_PIN.lookup('411026')).states[0].code === '27'; }), 'India Post directory (19,297 PINs) loads offline');
await newDoc('INV');
await page.fill('#inv-buyer-name', 'Ravi Pumps');
await typeInto('inv-buyer-pin', '380015');
check(await v('inv-buyer-state-code') === '24' && await v('inv-buyer-state') === 'Gujarat' && /Ahmadabad|Ahmedabad/.test(await v('inv-buyer-city')), 'billing PIN 380015 → Gujarat (24), Ahmedabad');
check(await page.$eval('#sync-shipping-chk', e => e.checked) && await v('inv-ship-state-code') === '24', '"Same as billing" copies the billing state to shipping');
await page.evaluate(() => { document.getElementById('sync-shipping-chk').click(); });
await typeInto('inv-ship-address', 'Plot 14, MIDC Bhosari');
await typeInto('inv-ship-pin', '411026');
check(await v('inv-ship-state-code') === '27' && /Pune/.test(await v('inv-ship-city')) && await v('inv-buyer-state-code') === '24', 'shipping PIN 411026 → shipping Maharashtra (27), Pune; billing stays Gujarat (24)');
await addItem('Monoblock Pump 1HP', 2, 5000);
let c = await calc();
// v9.3: the place of supply is decided from the stated fact (who receives the goods), never from the consignee's name
check(c.pos === '' && await page.evaluate(() => !$('ship-mode-box').classList.contains('hidden')) && /choose who receives the goods/i.test(await txt('pos-reason')), 'goods delivered to Maharashtra for a Gujarat buyer → the app asks who receives them (no guess)');
await page.check('input[name="inv-ship-mode"][value="buyer"]'); await page.waitForTimeout(300);
c = await calc();
check(c.pos === '27' && c.inter && c.igst === 1800, `delivered to the buyer itself in Maharashtra → place of supply 27, IGST ₹${c.igst} (Sec 10(1)(a))`);
check(/movement ends there/.test(await txt('pos-reason')), 'the reason for the place of supply is shown');
await typeInto('inv-ship-name', 'Shree Ram Engineering (consignee)');
c = await calc();
check(c.pos === '27', 'typing another consignee name alone does not change the place of supply (no name matching)');
await page.check('input[name="inv-ship-mode"][value="third"]'); await page.waitForTimeout(300);
c = await calc();
check(c.pos === '24' && !c.inter && c.cgst === 900 && c.sgst === 900, 'bill-to / ship-to (another person on the buyer\'s instruction) → buyer\'s state 24, CGST + SGST (Sec 10(1)(b))');
await page.check('input[name="inv-ship-mode"][value="buyer"]'); await page.waitForTimeout(200);
await typeInto('inv-ship-name', 'Ravi Pumps');
await typeInto('inv-ship-pin', '503145');
const amb = await txt('ship-pin-status');
check(/more than one state/.test(amb) && /Telangana \(36\)/.test(amb) && /Andhra Pradesh \(37\)/.test(amb) && await v('inv-ship-state-code') === '27', 'ambiguous PIN 503145 (Telangana / Andhra Pradesh): choices shown, nothing guessed');
await pickChip('#ship-pin-status [data-code="36"]');
c = await calc();
check(await v('inv-ship-state-code') === '36' && await v('inv-ship-state') === 'Telangana' && c.pos === '36' && c.inter, 'picked Telangana → shipping 36, place of supply recalculated');
await page.screenshot({ path: path.join(OUT, 'v91-01-pin.png') });
await typeInto('inv-ship-pin', '012345');
check(/6 digits/.test(await txt('ship-pin-status')), 'PIN starting with 0 is refused');
await typeInto('inv-ship-pin', '999999');
const unk = [await txt('ship-pin-status'), await v('inv-ship-state-code')];
check(/not in the India Post directory/.test(unk[0]) && unk[1] === '36', 'unknown PIN: warning, the state is not changed' + (fail ? ' ' + JSON.stringify(unk) : ''));
await typeInto('inv-ship-pin', '');
await typeInto('inv-ship-address', 'Unit 7, Sector 11, Gandhinagar, Gujarat 382010'); await page.waitForTimeout(700);
check(await v('inv-ship-pin') === '382010' && await v('inv-ship-state-code') === '24', 'a PIN inside the delivery address fills the empty PIN field and its state');
await typeInto('inv-ship-address', 'Unit 7, Sector 11, Gandhinagar, Gujarat 380001'); await page.waitForTimeout(700);
check(/mentions PIN 380001/.test(await txt('ship-pin-status')), 'address PIN and PIN field disagree → warning');
// GSTIN state is the billing state
await typeInto('inv-buyer-gstin', '27AAPFU0939F1ZV');
check(await v('inv-buyer-state-code') === '27', 'buyer GSTIN → billing state 27');
await typeInto('inv-buyer-pin', '380016');
check(await v('inv-buyer-state-code') === '27' && /registered in/.test(await txt('buyer-pin-status')), 'billing PIN in another state never overwrites the GSTIN state — warning instead');
// districts
const multi = await page.evaluate(async () => { for (const p of ['110001', '400001', '560001', '600001', '700001', '500001', '380001', '302001', '226001', '201301']) { const r = await HGI_PIN.lookup(p); if (r && !r.ambiguousState && r.states[0].districts.length > 1) return p; } return ''; });
check(true, `multi-district PINs offered as choices ${multi ? '(e.g. ' + multi + ')' : ''}`);
// services → recipient location
await newDoc('INV');
await page.fill('#inv-buyer-name', 'Service Client');
await typeInto('inv-buyer-gstin', '27AAPFU0939F1ZV');
await page.evaluate(() => document.getElementById('sync-shipping-chk').click());
await typeInto('inv-ship-pin', '380015');
await addItem('Pump repair service', 1, 2000, '998719', 18);
c = await calc();
check(c.pos === '27' && /Services/.test(await txt('pos-reason')), 'services: recipient\'s state is the place of supply (Sec 12(2))' + ` [${c.pos} ${await txt('pos-reason')}]`);

/* ---------------------------------------------------------------- buyer master keeps its own delivery state */
console.log('▶ Buyer master: separate shipping state');
await page.evaluate(() => { switchTab('customers'); openCustomerModal(); });
await page.fill('#modal-cust-name', 'Mehta Agro');
await typeInto('modal-cust-pin', '380015');
await typeInto('modal-cust-ship-address', 'Warehouse 3, Chakan');
await typeInto('modal-cust-ship-pin', '410501');
check(await v('modal-cust-state-code') === '24' && await v('modal-cust-ship-state-code') === '27', 'buyer master: billing PIN → 24, ship PIN → 27 (each its own)');
await page.evaluate(() => saveCustomerFromModal());
await newDoc('INV');
await page.evaluate(() => { const c = state.customers.find(x => x.name === 'Mehta Agro'); $('inv-customer-select').value = c.id; populateCustomerData(); });
await page.waitForTimeout(300);
check(await v('inv-buyer-state-code') === '24' && await v('inv-ship-state-code') === '27' && !(await page.$eval('#sync-shipping-chk', e => e.checked)), 'choosing the buyer fills billing 24 and shipping 27 (not the billing state)');

/* ---------------------------------------------------------------- Proforma invoice */
console.log('▶ Proforma Invoice');
await newDoc('PI');
check(/^PI\/01\//.test(await v('inv-num')) && await page.$eval('#form-title', e => e.innerText) === 'New Proforma Invoice', `own number series (${await v('inv-num')})`);
await page.fill('#inv-buyer-name', 'Ravi Pumps'); await typeInto('inv-buyer-gstin', '24AAPFU0939F1ZA'); await typeInto('inv-buyer-pin', '380015');
await addItem('Monoblock Pump 1HP', 3, 5000);
const pi = await save();
check(pi && pi.docType === 'PI' && pi.grandTotal === 17700 && pi.cgst === 1350, `saved with GST (₹${pi && pi.grandTotal}, CGST ₹${pi && pi.cgst})`);
let pv = await preview();
check(/PROFORMA INVOICE/.test(pv) && /NOT A TAX INVOICE/.test(pv) && /30011122233/.test(pv) && /SCAN TO PAY/.test(pv) && /not a tax invoice and does not entitle input tax credit/.test(pv), 'PDF: PROFORMA INVOICE, "not a tax invoice", bank details + UPI QR for the advance');
await page.screenshot({ path: path.join(OUT, 'v91-02-proforma.png'), fullPage: false });
await page.$eval('#invoice-preview-container .a4-page', e => e.scrollIntoView());
await (await page.$('#invoice-preview-container .a4-page')).screenshot({ path: path.join(OUT, 'v91-03-proforma-page.png') });
check(await page.evaluate(id => !liveDocs().some(d => d.id === id) && !docsForMonth(monthKey(todayISO())).some(d => d.id === id) && balanceOf(state.invoices.find(d => d.id === id)) === 0, pi.id), 'not in sales, GST returns or receivables');
const piWa = await page.evaluate(id => whatsAppText(state.invoices.find(d => d.id === id), true), pi.id);
check(/Proforma Invoice No\. PI\/01/.test(piWa) && /not a tax invoice/.test(piWa) && /30011122233/.test(piWa), 'WhatsApp / e-mail text for the proforma includes payment details');
check(await page.evaluate(id => displayStatus(state.invoices.find(d => d.id === id)), pi.id) === 'Open', 'status Open');
await page.evaluate(id => convertToInvoice(id), pi.id); await page.waitForTimeout(300);
check(await v('inv-doc-type') === 'INV' && !/^PI/.test(await v('inv-num')) && await page.$$eval('#invoice-items-body tr', r => r.length) === 1, `one tap → GST invoice form ${await v('inv-num')} with the same buyer and items`);
const inv1 = await save();
const piAfter = await page.evaluate(id => JSON.parse(JSON.stringify(state.invoices.find(d => d.id === id))), pi.id);
check(inv1.docType === 'INV' && inv1.grandTotal === 17700 && piAfter.convertedTo === inv1.num && piAfter.convertedId === inv1.id, `saved invoice ${inv1.num}; proforma marked Converted → ${piAfter.convertedTo}`);

/* ---------------------------------------------------------------- Customer PO */
console.log('▶ Purchase order from a customer');
await newDoc('CPO');
check(/^SO\/01\//.test(await v('inv-num')) && /Customer's PO No\./.test(await txt('po-num-label')), 'own reference series; field for the customer\'s PO number');
await page.fill('#inv-buyer-name', 'Mehta Agro'); await typeInto('inv-buyer-pin', '380015');
await page.fill('#inv-po-num', 'MA/PO/778'); await page.fill('#inv-po-date', '2026-10-28');
await addItem('Monoblock Pump 1HP', 1, 5000);
const cpo = await save();
pv = await preview();
check(/ORDER CONFIRMATION/.test(pv) && /MA\/PO\/778/.test(pv) && /We confirm your purchase order No\. MA\/PO\/778/.test(pv), 'PDF: ORDER CONFIRMATION quoting the customer\'s PO');
await page.evaluate(id => convertToInvoice(id), cpo.id); await page.waitForTimeout(300);
check(await v('inv-po-num') === 'MA/PO/778' && await v('inv-po-date') === '2026-10-28' && await v('inv-doc-type') === 'INV', 'convert → GST invoice carries the customer\'s PO number and date');
const inv2 = await save();
check(inv2.poNum === 'MA/PO/778' && (await page.evaluate(id => displayStatus(state.invoices.find(d => d.id === id)), cpo.id)) === 'Converted', 'invoice saved, customer PO marked Converted');

/* ---------------------------------------------------------------- Purchase order to a supplier */
console.log('▶ Purchase order to a supplier');
await page.evaluate(() => { state.customers.push({ id: 'SUP1', name: 'Kirloskar Castings', gstin: '27AABCK1234M1ZT', address: 'MIDC, Kolhapur', state: 'Maharashtra', stateCode: '27', pin: '416234', partyType: 'supplier' }); saveState(); });
await newDoc('PO');
check(/^PO\/01\//.test(await v('inv-num')) && /Supplier \/ Vendor/.test(await txt('party-a-title')) && /Deliver To/.test(await txt('party-b-title')), 'own series PO/…, supplier and "deliver to" sections');
check(await v('inv-ship-name') === 'HARI GURU INDUSTRIES' && await v('inv-ship-state-code') === '24' && await v('inv-ship-pin') === '382330', 'delivery address starts as our own address');
const opts = await page.$$eval('#inv-customer-select option', o => o.map(x => x.textContent));
check(opts.some(o => /Kirloskar/.test(o)) && !opts.some(o => /Ravi Pumps/.test(o)), 'supplier list shows suppliers only');
await page.evaluate(() => { $('inv-customer-select').value = 'SUP1'; populateCustomerData(); });
await page.waitForTimeout(250);
check(await v('inv-buyer-state-code') === '27' && await v('inv-ship-state-code') === '24', 'supplier Maharashtra (27), delivery stays at our Gujarat address');
await addItem('Monoblock Pump 1HP', 10, 3000);
c = await calc();
check(c.inter && c.igst === 5400 && c.pos === '24', `inter-state purchase: supplier charges IGST ₹${c.igst}; place of supply = our delivery state 24`);
const po = await save();
check(po.docType === 'PO' && po.igst === 5400 && po.grandTotal === 35400, `saved (₹${po.grandTotal})`);
pv = await preview();
check(/PURCHASE ORDER/.test(pv) && /Supplier \/ Vendor/i.test(pv) && /Deliver To/i.test(pv) && /Kirloskar Castings/.test(pv) && !/30011122233/.test(pv) && /Please quote PO No\./.test(pv), 'PDF: PURCHASE ORDER to the supplier, deliver-to address, no bank details, "quote this PO" note');
await (await page.$('#invoice-preview-container .a4-page')).screenshot({ path: path.join(OUT, 'v91-04-purchase-order.png') });
const poWa = await page.evaluate(id => whatsAppText(state.invoices.find(d => d.id === id), true), po.id);
check(/Purchase Order No\. PO\/01/.test(poWa) && /Deliver to:/.test(poWa) && !/Balance due/.test(poWa), 'WhatsApp / e-mail text written for the supplier');
const stockBefore = await page.evaluate(() => stockOf(state.products[0]));
check(await page.evaluate(id => !liveDocs().some(d => d.id === id) && !docsForMonth(monthKey(todayISO())).some(d => d.id === id), po.id), 'purchase order is not in sales or GST returns');
await page.evaluate(id => markPoReceived(id), po.id); await page.waitForTimeout(200);
const stockAfter = await page.evaluate(() => stockOf(state.products[0]));
check(stockAfter === stockBefore + 10 && (await page.evaluate(id => displayStatus(state.invoices.find(d => d.id === id)), po.id)) === 'Received', `marked received; stock ${stockBefore} → ${stockAfter}`);
// same-state supplier → CGST + SGST
await newDoc('PO');
await page.fill('#inv-buyer-name', 'Naroda Steel'); await typeInto('inv-buyer-gstin', '24AABCN5555Q1Z1');
await addItem('MS Plate', 5, 1000, '7208', 18);
c = await calc();
check(!c.inter && c.cgst === 450 && c.sgst === 450, 'supplier in our state → CGST + SGST');
await page.evaluate(() => saveBuyerFromInvoice());
check(await page.evaluate(() => (state.customers.find(c => c.name === 'Naroda Steel') || {}).partyType) === 'supplier', '"Save to Supplier Master" stores a supplier');
// list + filters
await page.evaluate(() => { switchTab('invoices'); $('inv-filter-type').value = 'PO'; renderInvoiceList(); });
const rows = await page.$$eval('#invoices-list-tbody tr', r => r.filter(x => x.querySelector('td:last-child button')).map(x => x.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)));   // textContent: v9.2 skips painting off-screen rows (innerText is empty until scrolled to)
check(rows.length === 1 && /PO\/01/.test(rows[0]), 'document register filters purchase orders ' + JSON.stringify(rows));
await page.evaluate(() => { $('inv-filter-type').value = ''; renderInvoiceList(); });

/* ---------------------------------------------------------------- invoices still the same */
console.log('▶ Existing features');
await newDoc('INV');
check(/^\d\d\/\d\d-\d\d$/.test(await v('inv-num')) && await page.$eval('#form-title', e => e.innerText) === 'New Tax Invoice' && /Billed To/.test(await txt('party-a-title')), `tax invoice numbering and labels unchanged (${await v('inv-num')})`);
check(await page.$$eval('#doc-seg button', b => b.length) === 7, 'document type control offers all 7 types');
check(errors.length === 0, `no script errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
fs.writeFileSync(path.join(OUT, 'v91-results.txt'), `${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
