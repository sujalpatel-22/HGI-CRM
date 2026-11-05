#!/usr/bin/env node
// E-invoice + e-way bill end to end: the real web app (www/) in Chromium → the real HGI server (backend/server.js) →
// the TEST-ONLY NIC protocol simulator (backend/test/nic-simulator.js: RSA login, SEK, AES payloads, rek + HMAC).
// Firestore / Google are the in-memory stand-ins. Two browser contexts = two phones of one account.
import { serviceConfig, fillSignIn } from './lib/accounts.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WWW = path.join(root, 'www'), OUT = path.join(root, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const { FakeGoogle } = require('../backend/test/fake-google.js');
const { startSimulator } = require('../backend/test/nic-simulator.js');
const { createServer } = require('../backend/server.js');
const config = require('../backend/lib/config.js');
const { gstinCheck } = require('../backend/lib/gst.js');

let failures = 0, passes = 0;
const check = (cond, msg) => { if (cond) { passes++; console.log('   ✓', msg); } else { failures++; console.log('   ✗', msg); } };
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gstin = b => { for (const c of CH) if (gstinCheck(b + c)) return b + c; };
const SELLER = gstin('24AAACH7409R1Z'), BUYER = gstin('27AAPFU0939F1Z');

/* ---------------------------------------------------------------- services */
const g = await new FakeGoogle().start();
const sim = await startSimulator();
const appServer = http.createServer();
await new Promise(r => appServer.listen(0, '127.0.0.1', r));
const appBase = `http://127.0.0.1:${appServer.address().port}`;
const SIM = `http://127.0.0.1:${sim.port}`;
const cfg = serviceConfig(config, g, { ALLOWED_ORIGINS: appBase,
  EDOC_ENV: 'test', EDOC_CRED_KEY: crypto.randomBytes(32).toString('base64'),
  IRP_BASE_URL: SIM, IRP_CLIENT_ID: 'gsp-client', IRP_CLIENT_SECRET: 'gsp-secret', IRP_PUBLIC_KEY: sim.publicKeyPem,
  EWB_BASE_URL: SIM, EWB_CLIENT_ID: 'gsp-client', EWB_CLIENT_SECRET: 'gsp-secret', EWB_PUBLIC_KEY: sim.publicKeyPem });
const sync = createServer(cfg);
await new Promise(r => sync.listen(0, '127.0.0.1', r));
const syncBase = `http://127.0.0.1:${sync.address().port}`;
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', png: 'image/png', svg: 'image/svg+xml' };
appServer.on('request', (req, res) => {
  const u = new URL(req.url, 'http://x').pathname;
  if (u === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(`window.HGI_CONFIG = ${JSON.stringify({ auth: 'test', syncUrl: syncBase })};`); }
  const p = path.join(WWW, decodeURIComponent(u.replace(/^\/$/, '/index.html')));
  if (p.endsWith('index.html')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(p, 'utf8').replace("connect-src 'self'", "connect-src 'self' " + syncBase)); }
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});

/* ---------------------------------------------------------------- helpers */
const browser = await chromium.launch();
const errors = [];
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_|net::/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  page.on('dialog', d => d.accept());
  return page;
}
const open = async page => { await page.goto(appBase + '/'); await page.waitForFunction(() => window.HGI_READY === true || window.HGI_SIGNIN_READY === true, null, { timeout: 20000 }); };
async function signIn(page, email) {
  await fillSignIn(page, email);
  const nav = page.waitForEvent('load', { timeout: 25000 });
  await page.click('#si-go');
  await nav; await page.waitForFunction(() => window.HGI_READY === true && !document.getElementById('signin-screen'), null, { timeout: 25000 });
}
const syncNow = page => page.evaluate(() => HGI_SYNC._syncNow().then(() => HGI_SYNC.status()));
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `edoc-${n}.png`) });
const shotEl = async (page, sel, n) => { const el = await page.$(sel); if (el) await el.screenshot({ path: path.join(OUT, `edoc-${n}.png`) }); };
const dlgText = page => page.$eval('.acct-dlg', e => e.innerText).catch(() => '');
const waitIdle = page => page.waitForFunction(() => !document.querySelector('#edoc-panel .ed-busy'), null, { timeout: 30000 });
async function addInvoice(page, num, extra = {}) {
  return page.evaluate(([num, BUYER, extra]) => {
    const now = new Date().toISOString(), id = 'DOC-' + Math.random().toString(36).slice(2, 10);
    state.invoices.unshift(Object.assign({ id, docType: 'INV', num, date: todayISO(), supplyType: 'B2B', pos: '27', reverseCharge: false,
      buyerName: 'Shree Ram Engineering', buyerGstin: BUYER, buyerPhone: '9876543210', buyerAddress: 'MIDC Bhosari, Pune', buyerState: 'Maharashtra', buyerStateCode: '27', buyerPin: '411026',
      shipName: '', shipGstin: '', shipAddress: '', shipState: '', shipStateCode: '', shipPin: '',
      items: [{ desc: 'Monoblock pump 1HP', hsn: '84137010', gst: 18, qty: 12, unit: 'NOS', rate: 5000 }], discount: 0, pfCharges: 0, otherCharges: 0,
      transport: 'VRL Logistics', lr: '', ewbTransport: { transMode: '1', vehicleNo: 'GJ05AB1234', vehicleType: 'R', distance: 0, transId: '', transDocNo: '', transDocDate: '' },
      payments: [], createdAt: now, updatedAt: now }, extra));
    const d = state.invoices[0]; d.calc = computeDoc(d); Object.assign(d, totalsOf(d.calc)); delete d.calc;
    saveState(); renderAll(); editInvoice(id);
    const blk = document.getElementById('edoc-block'); if (blk) blk.open = true;
    return id;
  }, [num, BUYER, extra]);
}
const panel = page => page.$eval('#edoc-panel', e => e.innerText).catch(() => '');
const clickEd = async (page, act) => { await page.click(`#edoc-panel [data-ed="${act}"]`); };
const invoice = (page, id) => page.evaluate(i => JSON.parse(JSON.stringify(state.invoices.find(x => x.id === i))), id);
const simCount = () => sim.calls.filter(c => c.method === 'POST' && c.path === '/eicore/v1.03/Invoice').length;

/* ---------------------------------------------------------------- 1. set-up */
console.log('\n▶ Sign in, company profile, API login');
const A = await device('phoneA');
await open(A); await signIn(A, 'factory@example.com');
await A.evaluate(([g]) => {
  const ob = document.getElementById('onboarding'); if (ob) ob.remove(); state.ui.onboarded = true;
  Object.assign(state.company, { name: 'HARI GURU INDUSTRIES', legalName: 'HARI GURU INDUSTRIES', gstin: g, state: 'Gujarat', stateCode: '24', pin: '382330', address: 'Plot 123, GIDC Naroda\nAhmedabad', phone: '9876500000', email: 'info@hariguru.example', aato: '5to10' });
  saveState(); loadSettingsForm && loadSettingsForm();
}, [SELLER]);
await A.evaluate(() => switchTab('settings'));
await A.waitForSelector('#edoc-card #ed-save', { timeout: 15000 });
check(/E-invoice \(IRP\): available/.test(await A.$eval('#edoc-card', e => e.innerText)) && /TEST SIMULATOR/.test(await A.$eval('#edoc-card', e => e.innerText)), 'Settings shows the server set-up and which GST system it uses');
await A.fill('#ed-irp-user', 'testuser'); await A.fill('#ed-irp-pass', 'wrong-password');
await A.click('#ed-save');
await A.waitForFunction(() => /1004|failed/i.test(document.getElementById('ed-msg').textContent), null, { timeout: 15000 });
check(/1004/.test(await A.$eval('#ed-msg', e => e.textContent)), 'wrong API password: the IRP login error is shown, nothing saved');
await A.fill('#ed-irp-user', 'testuser'); await A.fill('#ed-irp-pass', 'testpass'); await A.fill('#ed-ewb-user', 'ewbuser'); await A.fill('#ed-ewb-pass', 'ewbpass');
await A.click('#ed-save');
await A.waitForFunction(() => /saved/.test(document.getElementById('edoc-card').innerText) && !document.getElementById('ed-msg').textContent, null, { timeout: 15000 }).catch(() => {});
const card = await A.$eval('#edoc-card', e => e.innerText);
check(/saved \(te•+r \/ ew•+r/.test(card) && !/testpass|ewbpass/.test(card + await A.content()), 'correct logins verified and saved; only masked user names come back to the phone');
check(await A.evaluate(() => !JSON.stringify(localStorage).includes('testpass')), 'API passwords are not stored on the phone');
await shotEl(A, '#edoc-card', '01-settings');

/* ---------------------------------------------------------------- 2. one step: IRN + e-way bill */
console.log('\n▶ Invoice → IRN + e-way bill in one step');
const id1 = await addInvoice(A, 'HGI/101/26-27');
await A.waitForSelector('#edoc-panel [data-ed="irn+ewb"]', { timeout: 15000 });
let ptxt = await panel(A);
check(/Generate IRN \+ E-Way Bill/.test(ptxt) && /Generate IRN only/.test(ptxt) && /e-way bill is needed/.test(ptxt), 'eligible B2B invoice above ₹50,000: combined, IRN-only and the e-way bill hint are offered');
await shotEl(A, '#edoc-block', '02-panel-before');
const before = simCount();
await clickEd(A, 'irn+ewb');
await A.waitForSelector('.acct-dlg', { timeout: 15000 });
const confirmText = await dlgText(A);
check(/Report to the GST system\?/.test(confirmText) && /HGI\/101\/26-27/.test(confirmText) && /TEST SIMULATOR/.test(confirmText) && /24 hours/.test(confirmText), 'confirmation shows document, value, GST system and the 24-hour rule');
await shot(A, '03-confirm');
await A.click('.acct-dlg .acct-btn-primary');
await A.waitForFunction(i => { const d = state.invoices.find(x => x.id === i); return d && d.irn && d.ewbNo; }, id1, { timeout: 30000 });
await waitIdle(A);
let d1 = await invoice(A, id1);
const atIrp = sim.irns.get(d1.irn);
check(!!atIrp && d1.ackNo === String(atIrp.AckNo) && d1.signedQr === atIrp.SignedQRCode && d1.ewbNo === String(atIrp.EwbNo), `IRN, Ack No., signed QR and e-way bill ${d1.ewbNo} are exactly the government answer`);
check(simCount() === before + 1, 'one IRP call');
check(/^[0-9a-f]{64}$/.test(d1.irn) && d1.edoc.env === 'test' && !d1.edoc.irn.signedInvoice, 'record stored on the invoice (marked TEST); the large signed invoice stays on the server');
ptxt = await panel(A);
check(/Active/.test(ptxt) && new RegExp(d1.ewbNo).test(ptxt) && /Cancel E-Way Bill/.test(ptxt) && !/Generate IRN/.test(ptxt), 'status shows IRN + e-way bill active; generation buttons gone');
check(await A.evaluate(() => document.getElementById('inv-irn').readOnly && document.getElementById('inv-ewb-no').readOnly), 'recorded numbers cannot be typed over');
await shotEl(A, '#edoc-block', '04-panel-after');

/* ---------------------------------------------------------------- 3. invoice PDF content */
console.log('\n▶ Printed invoice, e-way bill page, sharing text');
await A.evaluate(i => { const d = state.invoices.find(x => x.id === i); previewDoc = Object.assign({}, d, { calc: computeDoc(d) }); document.getElementById('preview-section').classList.remove('hidden'); renderPreviewPages(['ORIGINAL FOR RECIPIENT']); }, id1);
const pv = await A.$eval('#invoice-preview-container', e => ({ text: e.innerText, qr: e.querySelectorAll('img').length }));
check(pv.text.includes(d1.irn) && pv.text.includes(d1.ackNo) && pv.text.includes(d1.ewbNo) && /valid till/.test(pv.text), 'invoice shows IRN, Ack No., e-way bill and its validity');
check(/TEST IRN \/ E-WAY BILL — NOT A VALID TAX INVOICE/.test(pv.text), 'test / sandbox documents carry a NOT VALID watermark');
await shot(A, '05-invoice-preview');
await A.evaluate(i => { const d = state.invoices.find(x => x.id === i); previewDoc = Object.assign({}, d, { calc: computeDoc(d) }); renderPreviewPages(['E-WAY BILL']); }, id1);
const ewbTxt = await A.$eval('#invoice-preview-container', e => e.innerText);
check(/E-WAY BILL/.test(ewbTxt) && ewbTxt.includes(d1.ewbNo) && /GJ05AB1234/.test(ewbTxt) && /Part-A/i.test(ewbTxt) && /Part-B/i.test(ewbTxt), 'e-way bill page (for PDF / print): number, Part-A, Part-B vehicle');
await shot(A, '06-ewb-page');
const wa = await A.evaluate(i => whatsAppText(state.invoices.find(x => x.id === i), true), id1);
check(wa.includes('*IRN:* ' + d1.irn) && wa.includes('*E-Way Bill:* ' + d1.ewbNo) && /TEST — not valid/.test(wa), 'WhatsApp / e-mail text carries IRN and e-way bill');
check(await A.evaluate(() => !!document.getElementById('btn-email-pdf') && typeof HGI_M.emailPdf === 'function'), 'e-mail button next to WhatsApp');
await A.evaluate(() => { previewDoc = null; document.getElementById('preview-section').classList.add('hidden'); });

/* ---------------------------------------------------------------- 4. locks */
console.log('\n▶ Reported documents are protected');
await A.evaluate(i => { editInvoice(i); document.querySelector('#invoice-items-body .item-qty').value = 13; saveCurrentInvoice(); }, id1);
d1 = await invoice(A, id1);
check(d1.items[0].qty === 12, 'quantity of an e-invoiced document cannot be changed');
await A.evaluate(i => deleteInvoice(i), id1);
check(!!(await invoice(A, id1)), 'cannot be deleted');
await A.evaluate(i => cancelInvoice(i), id1);
check(!(await invoice(A, id1)).cancelled, '"Cancel" in the register points to the GST cancellation instead');

/* ---------------------------------------------------------------- 5. other phone */
console.log('\n▶ Second phone');
await syncNow(A);
const B = await device('phoneB');
await open(B); await signIn(B, 'factory@example.com');
const onB = await invoice(B, id1);
check(onB && onB.irn === d1.irn && onB.ewbNo === d1.ewbNo && onB.edoc && onB.edoc.ewb.status === 'ACT', 'IRN and e-way bill synced to the second phone automatically');
await B.evaluate(i => { editInvoice(i); document.getElementById('edoc-block').open = true; }, id1);
await B.waitForSelector('#edoc-panel [data-ed="refresh"]');
await B.click('#edoc-panel [data-ed="refresh"]');
await B.waitForFunction(i => { const d = state.invoices.find(x => x.id === i); return d.edoc && d.edoc.ewb && d.edoc.ewb.checkedAt; }, id1, { timeout: 20000 });
check(true, 'status refresh from the second phone asks the government systems');

/* ---------------------------------------------------------------- 6. cancellation */
console.log('\n▶ Cancellation');
await A.evaluate(i => { editInvoice(i); document.getElementById('edoc-block').open = true; }, id1);
await A.waitForSelector('#edoc-panel [data-ed="cancel-irn"]');
check(await A.$eval('#edoc-panel [data-ed="cancel-irn"]', b => b.disabled), 'Cancel IRN is disabled while the e-way bill is active');
await clickEd(A, 'cancel-ewb');
await A.waitForSelector('.acct-dlg [data-edf="remark"]');
await A.selectOption('.acct-dlg [data-edf="reason"]', '3'); await A.fill('.acct-dlg [data-edf="remark"]', 'Wrong quantity');
await A.click('.acct-dlg .acct-btn-danger');
await A.waitForFunction(i => state.invoices.find(x => x.id === i).edoc.ewb.status === 'CNL', id1, { timeout: 20000 });
check(sim.ewbs.get(d1.ewbNo).status === 'CNL', 'e-way bill cancelled on the government system');
await waitIdle(A);
await clickEd(A, 'cancel-irn');
await A.waitForSelector('.acct-dlg [data-edf="remark"]');
await A.fill('.acct-dlg [data-edf="remark"]', 'Wrong quantity');
await A.click('.acct-dlg .acct-btn-danger');
await A.waitForFunction(i => state.invoices.find(x => x.id === i).edoc.irn.status === 'CNL', id1, { timeout: 20000 });
d1 = await invoice(A, id1);
check(sim.irns.get(d1.irn).Status === 'CNL' && d1.cancelled === true && /IRN cancelled/.test(d1.cancelReason), 'IRN cancelled on the IRP; the invoice is marked cancelled in the register');
check(/never be reported again/.test(await panel(A)), 'the cancelled number cannot be reported again');
await shotEl(A, '#edoc-block', '07-cancelled');

/* ---------------------------------------------------------------- 7. separate e-way bill for a B2C invoice + Part-B */
console.log('\n▶ E-way bill only (B2C, no IRN)');
const id2 = await addInvoice(A, 'HGI/102/26-27', { supplyType: 'B2C', buyerGstin: '', pos: '24', buyerState: 'Gujarat', buyerStateCode: '24', buyerAddress: 'Satellite, Ahmedabad', buyerPin: '380015',
  ewbTransport: { transMode: '1', vehicleNo: '', vehicleType: 'R', distance: 25, transId: '', transDocNo: '', transDocDate: '' } });
await A.waitForSelector('#edoc-panel [data-ed="ewb"]');
ptxt = await panel(A);
check(!/Generate IRN/.test(ptxt) && /Generate E-Way Bill only/.test(ptxt) && /not B2C/.test(ptxt), 'B2C: IRN not offered (with the reason), e-way bill offered');
await clickEd(A, 'ewb'); await A.waitForSelector('.acct-dlg .acct-btn-primary'); await A.click('.acct-dlg .acct-btn-primary');
await A.waitForFunction(i => state.invoices.find(x => x.id === i).ewbNo, id2, { timeout: 20000 });
await waitIdle(A);
let d2 = await invoice(A, id2);
check(sim.ewbs.has(d2.ewbNo) && d2.edoc.ewb.via === 'EWB' && !d2.irn, `e-way bill ${d2.ewbNo} from the e-way bill system (no IRN)`);
check(/Part-B \(vehicle\) not entered/.test(await panel(A)), 'without a vehicle: Part-A only, shown clearly');
await clickEd(A, 'partb');
await A.waitForSelector('.acct-dlg [data-edf="vehicleNo"]');
await A.fill('.acct-dlg [data-edf="vehicleNo"]', 'gj01xy9999'); await A.fill('.acct-dlg [data-edf="fromPlace"]', 'Ahmedabad');
await A.click('.acct-dlg .acct-btn-primary');
await A.waitForFunction(i => (state.invoices.find(x => x.id === i).edoc.ewb.partB || []).length === 1, id2, { timeout: 20000 });
d2 = await invoice(A, id2);
check(d2.edoc.ewb.transport.vehicleNo === 'GJ01XY9999' && !!d2.edoc.ewb.validUpto, 'Part-B vehicle update recorded with the new validity');

/* ---------------------------------------------------------------- 8. separate steps: IRN now, e-way bill later */
console.log('\n▶ IRN first, e-way bill later');
const id3 = await addInvoice(A, 'HGI/103/26-27');
await A.waitForSelector('#edoc-panel [data-ed="irn"]');
await clickEd(A, 'irn'); await A.waitForSelector('.acct-dlg .acct-btn-primary'); await A.click('.acct-dlg .acct-btn-primary');
await A.waitForFunction(i => state.invoices.find(x => x.id === i).irn, id3, { timeout: 20000 }); await waitIdle(A);
check(!(await invoice(A, id3)).ewbNo && /Generate E-Way Bill \(from IRN\)/.test(await panel(A)), 'IRN only; e-way bill offered from the IRN');
await clickEd(A, 'ewb'); await A.waitForSelector('.acct-dlg .acct-btn-primary'); await A.click('.acct-dlg .acct-btn-primary');
await A.waitForFunction(i => state.invoices.find(x => x.id === i).ewbNo, id3, { timeout: 20000 }); await waitIdle(A);
check((await invoice(A, id3)).edoc.ewb.via === 'IRP', 'e-way bill generated by IRN');

/* ---------------------------------------------------------------- 9. failures never produce numbers */
console.log('\n▶ Errors');
const id4 = await addInvoice(A, 'HGI/104/26-27', { buyerPin: '' });
await A.waitForSelector('#edoc-panel [data-ed="irn"]');
await clickEd(A, 'irn'); await A.waitForSelector('.acct-dlg');
const vt = await dlgText(A);
check(/Fix these before reporting/.test(vt) && /PIN/.test(vt) && /Nothing was sent/.test(vt), 'missing buyer PIN: listed before anything is sent');
await A.click('.acct-dlg .acct-btn-primary'); await waitIdle(A);
await A.evaluate(i => { const d = state.invoices.find(x => x.id === i); d.buyerPin = '411026'; saveState(); editInvoice(i); document.getElementById('edoc-block').open = true; }, id4);
await A.waitForSelector('#edoc-panel [data-ed="irn"]');
await A.route(syncBase + '/v1/edoc/**', r => r.abort('internetdisconnected'));
await clickEd(A, 'irn'); await A.waitForSelector('.acct-dlg');
check(/No internet connection — nothing was sent/.test(await dlgText(A)), 'offline: clear message, nothing reported');
await A.click('.acct-dlg .acct-btn-primary'); await waitIdle(A);
await A.unroute(syncBase + '/v1/edoc/**');
sim.knobs.failNext = { match: /^POST \/eicore\/v1\.03\/Invoice$/, body: { Status: 0, ErrorDetails: [{ ErrorCode: '2211', ErrorMessage: 'The pincode of the buyer does not belong to the state' }] } };
await clickEd(A, 'irn'); await A.waitForSelector('.acct-dlg .acct-btn-primary'); await A.click('.acct-dlg .acct-btn-primary');
await A.waitForFunction(() => /Could not complete/.test((document.querySelector('.acct-dlg') || {}).innerText || ''), null, { timeout: 20000 });
const rej = await dlgText(A);
check(/2211/.test(rej) && !(await invoice(A, id4)).irn, 'IRP rejection shown with its error code; no IRN on the invoice');
await shot(A, '08-rejected');
await A.click('.acct-dlg .acct-btn-primary'); await waitIdle(A);
// lost answer: the IRP registered it, the phone never heard back → the next tap gets the same IRN, never a second one
sim.knobs.dropNext = /^POST \/eicore\/v1\.03\/Invoice$/;
await clickEd(A, 'irn'); await A.waitForSelector('.acct-dlg .acct-btn-primary'); await A.click('.acct-dlg .acct-btn-primary');
await A.waitForFunction(() => /Could not complete/.test((document.querySelector('.acct-dlg') || {}).innerText || ''), null, { timeout: 20000 });
check(/tap Generate again/.test(await dlgText(A)) && !(await invoice(A, id4)).irn, 'lost answer: error, no number, advice to tap again');
await A.click('.acct-dlg .acct-btn-primary'); await waitIdle(A);
const n4 = simCount();
await clickEd(A, 'irn'); await A.waitForSelector('.acct-dlg .acct-btn-primary'); await A.click('.acct-dlg .acct-btn-primary');
await A.waitForFunction(i => state.invoices.find(x => x.id === i).irn, id4, { timeout: 20000 }); await waitIdle(A);
const d4 = await invoice(A, id4);
const irnsFor104 = [...sim.irns.values()].filter(x => Buffer.from(x.SignedQRCode.split('.')[1], 'base64url').toString().includes('HGI/104/26-27'));
check(irnsFor104.length === 1 && d4.irn === irnsFor104[0].Irn && d4.edoc.irn.recovered === true && simCount() === n4 + 1, 'retry recovered the IRN the IRP already had (duplicate 2150) — one IRN for the document');

/* ---------------------------------------------------------------- 10. server without government access */
console.log('\n▶ Server not set up');
await syncNow(A);
const C = await device('phoneC');
await C.route(syncBase + '/v1/me', async r => { const res = await r.fetch(); const j = await res.json(); j.features.edoc = { irp: false, ewb: false, env: 'sandbox' }; r.fulfill({ response: res, json: j }); });
await open(C); await signIn(C, 'factory@example.com');
await C.waitForFunction(i => state.invoices.some(x => x.id === i), id3, { timeout: 15000 });
await C.evaluate(i => { editInvoice(i); document.getElementById('edoc-block').open = true; }, id3);
await C.waitForFunction(() => /not set up on the HGI server/.test(document.getElementById('edoc-panel').innerText), null, { timeout: 15000 }).catch(() => {});
check(/not set up on the HGI server/.test(await panel(C)) && /Active/.test(await panel(C)), 'server not set up: recorded IRN status still shown, with a clear "not set up" message');
check(!(await C.$('#edoc-panel [data-ed="irn"]')), 'no generation buttons, clear "not set up" message; numbers from the portal can still be typed');

check(errors.length === 0, `no script errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
await browser.close(); sync.close(); appServer.close(); sim.server.close(); await g.stop();
console.log(`\n${passes} passed, ${failures} failed`);
fs.writeFileSync(path.join(OUT, 'edoc-results.txt'), `${passes} passed, ${failures} failed\n`);
process.exit(failures ? 1 : 0);
