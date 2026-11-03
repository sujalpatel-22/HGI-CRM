#!/usr/bin/env node
// v9.3 GST rule book + tax engine — unit tests (no browser).
// Expected values are worked out by hand in the comments (independent of the code under test), and the dated rules are
// checked against the effective dates of the notifications / advisories they cite (see src/gst-rules.js SOURCES).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(root, 'tests', 'out'); fs.mkdirSync(OUT, { recursive: true });
const sandbox = {}; vm.runInNewContext(fs.readFileSync(path.join(root, 'src/gst-rules.js'), 'utf8'), sandbox);
const G = sandbox.HGI_GST;
const calc = require('../backend/lib/gst-calc.js');
const mapper = require('../backend/lib/einvoice-mapper.js');

let pass = 0, fail = 0; const lines = [];
const check = (cond, msg) => { const l = `${cond ? '✓' : '✗'} ${msg}`; lines.push(l); cond ? pass++ : fail++; console.log('   ' + l); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n▶ Rule book: dated values switch on their effective dates');
check(G.at('b2clLimit', '2024-07-31') === 250000 && G.at('b2clLimit', '2024-08-01') === 100000, 'B2C (Large): ₹2.5 lakh up to 31-07-2024, ₹1 lakh from 01-08-2024 (Notfn 12/2024-CT)');
check(G.at('ewbMaxDocAgeDays', '2024-12-31') === null && G.at('ewbMaxDocAgeDays', '2025-01-01') === 180, 'e-way bill: 180-day document age limit from 01-01-2025 only');
check(G.at('einv30DayAatoCr', '2025-03-31') === 100 && G.at('einv30DayAatoCr', '2025-04-01') === 10, 'IRP 30-day limit: AATO ≥ ₹100 cr till 31-03-2025, ≥ ₹10 cr from 01-04-2025');
check(G.at('einvoiceAatoCr', '2023-07-31') === 10 && G.at('einvoiceAatoCr', '2023-08-01') === 5, 'e-invoicing threshold ₹10 cr → ₹5 cr from 01-08-2023 (Notfn 10/2023-CT)');
check(G.at('rates', '2025-09-21').includes(12) && G.at('rates', '2025-09-21').includes(28) && !G.at('rates', '2025-09-21').includes(40), 'before 22-09-2025: 12 % and 28 % valid, 40 % not');
check(!G.at('rates', '2025-09-22').includes(12) && !G.at('rates', '2025-09-22').includes(28) && G.at('rates', '2025-09-22').includes(40), 'from 22-09-2025 (GST 2.0): 12 % / 28 % gone, 40 % valid');
check(G.rateValid(0.25, '2026-01-01') && G.rateValid(3, '2026-01-01') && G.rateValid(1.5, '2026-01-01'), 'special rates 0.25 % / 1.5 % / 3 % stay valid');
check(G.creditNoteDeadline('2025-05-10') === '2026-11-30' && G.creditNoteDeadline('2026-03-31') === '2026-11-30' && G.creditNoteDeadline('2026-04-01') === '2027-11-30', 'credit note deadline: 30 November after the end of the invoice\'s FY (Sec 34(2))');
check(Object.keys(G.DATED).every(k => G.DATED[k].every((r, i, a) => i === 0 || r.from > a[i - 1].from)), 'every dated rule is in date order');
check(Object.values(G.DATED).flat().filter(r => r.src).every(r => G.SOURCES[r.src] && /^https:\/\//.test(G.SOURCES[r.src].url)), 'every cited source exists and has a link');

console.log('\n▶ Place of supply of goods: decided from the stated fact, never from names');
// supplier Gujarat (24). Mitarsh-type case: buyer Gujarat, goods to a Rajasthan (08) site.
check(eq(G.posForGoods({ supplierSC: '24', buyerSC: '24', shipSC: '08' }).need, 'shipMode'), 'buyer 24, delivery 08, fact missing → the app must ask (no guess)');
check(G.posForGoods({ supplierSC: '24', buyerSC: '24', shipSC: '08', shipMode: 'third' }).pos === '24', 'third person on the buyer\'s direction → POS = buyer\'s state 24 (Sec 10(1)(b)) → CGST + SGST');
check(G.posForGoods({ supplierSC: '24', buyerSC: '24', shipSC: '08', shipMode: 'buyer' }).pos === '08', 'buyer\'s own site → POS = delivery state 08 (Sec 10(1)(a)) → IGST');
check(G.posForGoods({ supplierSC: '24', buyerSC: '27', shipSC: '27' }).pos === '27' && !G.posForGoods({ supplierSC: '24', buyerSC: '27', shipSC: '27' }).need, 'delivery in the buyer\'s state → no question, POS = that state');
check(G.posForGoods({ supplierSC: '24', buyerSC: '27', shipSC: '24', shipMode: 'third' }).pos === '27', 'buyer 27 orders delivery to a third person in 24 → POS 27 → IGST (10(1)(b))');
check(G.posForGoods({ supplierSC: '24', buyerSC: '', shipSC: '08', shipMode: 'third' }).need === 'buyerState', 'bill-to / ship-to without the buyer\'s state → the app must ask');
check(G.posForGoods({ supplierSC: '24' }).assumed === true, 'no state at all → supplier\'s state, marked as an assumption');
check(G.isInterState({ supplierSC: '24', pos: '24', supplyType: 'SEZWP' }) && G.isInterState({ supplierSC: '24', pos: '96', supplyType: 'EXPWOP' }), 'SEZ and export supplies are always inter-State (IGST Act s.7(5))');

console.log('\n▶ UTGST, cess guard, HSN digits, e-invoice applicability');
check(['04', '26', '31', '35', '38'].every(c => G.stateTaxLabel(c, c) === 'UTGST'), 'intra-UT supply in Chandigarh / DNH&DD / Lakshadweep / A&N / Ladakh → UTGST');
check(['07', '34', '01', '24'].every(c => G.stateTaxLabel(c, c) === 'SGST') && G.stateTaxLabel('04', '24') === 'SGST', 'Delhi, Puducherry, J&K (legislatures) and states → SGST; inter-State → no UTGST');
check(G.cessRisk('24022010', '2026-01-01') === 'yes' && G.cessRisk('21069020', '2026-01-01') === 'yes' && G.cessRisk('2106', '2026-01-01') === 'maybe' && G.cessRisk('730890', '2026-01-01') === '', 'cess headings refused (tobacco, pan masala); a 4-digit HSN covering one is flagged');
check(G.cessRisk('87032291', '2025-09-01') === 'yes' && G.cessRisk('87032291', '2025-10-01') === '', 'motor cars: cess risk before GST 2.0 only');
check(G.hsnDigitsRequired('upto5', true) === 4 && G.hsnDigitsRequired('upto5', false) === 0 && G.hsnDigitsRequired('above5', false) === 6, 'HSN digits: ≤ ₹5 cr 4 on B2B / optional on B2C; > ₹5 cr 6 on all (Notfn 78/2020-CT)');
check(G.einvoiceApplies('upto5', '2026-11-04') === false && G.einvoiceApplies('5to10', '2026-11-04') === true && G.einvoiceApplies('5to10', '2022-11-01') === false && G.einvoiceApplies('above10', '2021-06-01') === null,
  'e-invoicing by band and date (unknown where the band is too coarse for that date\'s threshold)');

console.log('\n▶ Tax engine golden cases (server engine = app engine, parity tested elsewhere) — expected values worked by hand');
const r = (d, sc = '24') => calc.computeDoc(d, sc);
// G1 user's case 62/26-27 as one line: taxable 1,07,499.00; 9 % = 9,674.91 each half; 1,26,848.82 → 1,26,849 (round-off +0.18)
let c = r({ supplyType: 'B2B', pos: '24', items: [{ qty: 1, rate: 107499, gst: 18, hsn: '730890', unit: 'NOS' }] });
check(c.taxable === 107499 && c.cgst === 9674.91 && c.sgst === 9674.91 && c.igst === 0 && c.grandTotal === 126849 && c.roundoff === 0.18, `G1 bill-to/ship-to (POS 24): CGST 9,674.91 + SGST 9,674.91, total 1,26,849 (${c.cgst}/${c.sgst}/${c.grandTotal})`);
c = r({ supplyType: 'B2B', pos: '08', items: [{ qty: 1, rate: 107499, gst: 18, hsn: '730890', unit: 'NOS' }] });
check(c.igst === 19349.82 && c.cgst === 0 && c.grandTotal === 126849, `G1′ buyer's own site (POS 08): IGST 19,349.82, same total (${c.igst})`);
// G2 Sec 15: discount 600 / packing 300 spread pro-rata: line shares −250 / −50 → taxable 9,750 + 1,950 = 11,700; CGST 877.50 + 48.75 = 926.25; 13,552.50 → 13,553
c = r({ supplyType: 'B2B', pos: '24', items: [{ qty: 10, rate: 1000, gst: 18, hsn: '848390', unit: 'NOS' }, { qty: 5, rate: 400, gst: 5, hsn: '870899', unit: 'PCS' }], discount: 600, pfCharges: 300 });
check(c.taxable === 11700 && c.cgst === 926.25 && c.sgst === 926.25 && c.grandTotal === 13553 && c.roundoff === 0.5, 'G2 discount + packing, two rates: taxable 11,700, CGST 926.25, total 13,553');
// G3 export under LUT: no IGST; total = taxable
c = r({ supplyType: 'EXPWOP', pos: '96', items: [{ qty: 1, rate: 5000, gst: 18, hsn: '848390', unit: 'NOS' }] });
check(c.igst === 0 && c.grandTotal === 5000 && c.isInter, 'G3 export under LUT: IGST 0, total 5,000, inter-State');
// G4 reverse charge: tax shown (250 + 250) but not added to the total
c = r({ supplyType: 'B2B', pos: '24', reverseCharge: true, items: [{ qty: 1, rate: 10000, gst: 5, hsn: '996511', unit: 'OTH' }] });
check(c.cgst === 250 && c.sgst === 250 && c.grandTotal === 10000, 'G4 reverse charge: CGST/SGST 250 each shown, total 10,000');
// G5 rounding: 3 × 33.33 = 99.99; 9 % = 8.9991 → 9.00 each; 117.99 → 118 (+0.01)
c = r({ supplyType: 'B2C', pos: '24', items: [{ qty: 3, rate: 33.33, gst: 18, hsn: '8483', unit: 'NOS' }] });
check(c.taxable === 99.99 && c.cgst === 9 && c.grandTotal === 118 && c.roundoff === 0.01, 'G5 rounding: tax to the paisa per HSN line, invoice to the rupee');
// G6 special rate 0.25 % intra: 1,000 × 0.125 % = 1.25 each half
c = r({ supplyType: 'B2B', pos: '24', items: [{ qty: 1, rate: 1000, gst: 0.25, hsn: '7102', unit: 'NOS' }] });
check(c.cgst === 1.25 && c.sgst === 1.25 && c.grandTotal === 1003, 'G6 0.25 % rate: 1.25 + 1.25, total 1,003 (1,002.50 rounds up)');
// G7 UT (Chandigarh 04 → 04): same amounts as a state; only the label differs (checked in the app test)
c = r({ supplyType: 'B2B', pos: '04', items: [{ qty: 1, rate: 1000, gst: 18, hsn: '8483', unit: 'NOS' }] }, '04');
check(c.cgst === 90 && c.sgst === 90 && !c.isInter, 'G7 intra-UT: CGST 90 + UTGST 90');

console.log('\n▶ Server re-derives the place of supply and refuses unresolved facts');
const co = { name: 'Test Supplier', legalName: 'Test Supplier', gstin: '24AAPFU0939F1Z1', stateCode: '24', pin: '382330', address: 'Plot 1, GIDC Naroda\nAhmedabad', phone: '9876500000', email: 'a@b.in' };
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const base = { id: 'X', docType: 'INV', num: 'T1/26-27', date: today, supplyType: 'B2B', pos: '24', buyerName: 'Mitarsh-like Buyer Pvt Ltd', buyerGstin: '24AAACR5055K1ZD', buyerAddress: 'Ring Road\nSurat', buyerState: 'Gujarat', buyerStateCode: '24', buyerPin: '395002',
  shipName: 'Project Site', shipGstin: '', shipAddress: 'Village Devikot\nJaisalmer', shipState: 'Rajasthan', shipStateCode: '08', shipPin: '345001',
  items: [{ desc: 'Structure', hsn: '730890', gst: 18, qty: 1, unit: 'NOS', rate: 107499 }], transport: { transMode: '1', distance: 900, vehicleNo: 'GJ05AB1234', vehicleType: 'R' } };
base.grandTotal = r(base).grandTotal;
let m = mapper.buildEwbPayload({ ...base }, co, { cfgGstin: co.gstin });
check(m.errors.some(e => e.field === 'shipMode'), 'no recorded delivery fact → server refuses the e-way bill');
m = mapper.buildEwbPayload({ ...base, shipMode: 'third' }, co, { cfgGstin: co.gstin });
check(!m.errors.some(e => e.field === 'shipMode' || e.field === 'pos') && m.payload && m.payload.transactionType === 2 && m.payload.toStateCode === 24 && m.payload.actToStateCode === 8,
  `bill-to/ship-to recorded → accepted: transaction type 2, bill-to state 24, ship-to state 08 ${JSON.stringify(m.errors)}`);
m = mapper.buildEwbPayload({ ...base, shipMode: 'buyer' }, co, { cfgGstin: co.gstin });
check(m.errors.some(e => e.field === 'pos'), 'fact says "buyer itself" but POS 24 → server refuses (POS must be 08)');
const old = new Date(Date.now() - 200 * 86400e3).toISOString().slice(0, 10);
m = mapper.buildEwbPayload({ ...base, shipMode: 'third', date: old, num: 'T2/' + (Number(old.slice(5, 7)) < 4 ? `${old.slice(2, 4) - 1}-${old.slice(2, 4)}` : `${old.slice(2, 4)}-${Number(old.slice(2, 4)) + 1}`) }, co, { cfgGstin: co.gstin });
check(m.errors.some(e => /180 days/.test(e.message)), 'document 200 days old → server refuses the e-way bill (GSTN advisory, from 01-01-2025)');

console.log('\n▶ One rule book everywhere');
check(fs.readFileSync(path.join(root, 'src/gst-rules.js'), 'utf8') === fs.readFileSync(path.join(root, 'backend/lib/gst-rules.js'), 'utf8'), 'server copy backend/lib/gst-rules.js is identical to src/gst-rules.js');
const html = fs.readFileSync(path.join(root, 'src/app.template.html'), 'utf8');
check(html.indexOf('<script src="gst-rules.js">') > 0 && html.indexOf('<script src="gst-rules.js">') < html.indexOf('const GSTR = window.HGI_GST'), 'app loads the rule book before its tax engine');
check(!/B2CL_LIMIT\)/.test(html.replace(/const B2CL_LIMIT[^\n]*/, '')) && /b2clLimitOn\(d\.date\)/.test(html), 'returns use the B2CL limit of the document date, not a constant');

fs.writeFileSync(path.join(OUT, 'gst-rules-results.txt'), lines.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
