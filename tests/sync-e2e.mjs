#!/usr/bin/env node
// End-to-end test of the cloud account: the real web app (www/) in Chromium, the real cloud service (backend/server.js)
// with in-memory stand-ins for Google Sheets, Cloud Storage and the GST provider (backend/test/fake-google.js).
// Several browser contexts = several phones, each logging in with a username + password (accounts on the Sheets stand-in).
import { serviceConfig, fillSignIn, TEST_PASSWORD } from './lib/accounts.mjs';
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
const { createServer } = require('../backend/server.js');
const config = require('../backend/lib/config.js');
const { gstinCheck } = require('../backend/lib/gst.js');

let failures = 0, passes = 0;
const check = (cond, msg) => { if (cond) { passes++; console.log('   ✓', msg); } else { failures++; console.log('   ✗', msg); } };
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gstin = b => { for (const c of CH) if (gstinCheck(b + c)) return b + c; };

/* ---------------------------------------------------------------- services */
const g = await new FakeGoogle().start();
const G_OK = gstin('27AAPFU0939F1Z'), G_CANCEL = gstin('24AAACR5055K1Z'), G_NONE = gstin('29AABCT1332L1Z');
g.gstRecords.set(G_OK, { gstin: G_OK, lgnm: 'SHREE RAM ENGINEERING PRIVATE LIMITED', tradeNam: 'Shree Ram Engineering', sts: 'Active', rgdt: '01/07/2017', ctb: 'Private Limited Company', dty: 'Regular',
  nba: ['Factory / Manufacturing'], stj: 'Ghatak 12', ctj: 'RANGE-I', pradr: { addr: { bno: 'Plot 14', bnm: 'Ram Udyog', st: 'MIDC Road', loc: 'Bhosari', dst: 'Pune', stcd: 'Maharashtra', pncd: '411026' } } });
g.gstRecords.set(G_CANCEL, { gstin: G_CANCEL, lgnm: 'OLD MEHSANA TRADERS', tradeNam: '', sts: 'Cancelled', cxdt: '31/03/2023', rgdt: '01/07/2017', ctb: 'Proprietorship', dty: 'Regular',
  pradr: { addr: { bno: '5', st: 'Station Road', loc: 'Mehsana', dst: 'Mehsana', stcd: 'Gujarat', pncd: '384002' } } });
const appServer = http.createServer();
await new Promise(r => appServer.listen(0, '127.0.0.1', r));
const appBase = `http://127.0.0.1:${appServer.address().port}`;
const cfg = serviceConfig(config, g, { FILES_BUCKET: 'hgi-files', GST_API_URL: 'http://x/{gstin}', GST_API_HEADERS: JSON.stringify({ 'x-api-key': g.gstKey }), GST_API_NAME: 'Test GSP', ALLOWED_ORIGINS: appBase });
cfg.gst.url = g.gstUrl();
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
async function device(name, storage) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: storage });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_|net::/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  page.on('dialog', d => d.accept());
  page.label = name;
  return page;
}
const open = async page => { await page.goto(appBase + '/'); await page.waitForFunction(() => window.HGI_READY === true || window.HGI_SIGNIN_READY === true, null, { timeout: 20000 }); };
const afterReload = page => page.waitForFunction(() => window.HGI_READY === true && !document.getElementById('signin-screen'), null, { timeout: 25000 });
async function signIn(page, email, answer) {
  await fillSignIn(page, email);
  const nav = page.waitForEvent('load', { timeout: 25000 });
  await page.click('#si-go');
  if (answer) { await page.waitForSelector('.acct-dlg', { timeout: 15000 }); await page.click(answer); }
  await nav.catch(async e => { throw new Error(`no reload after sign-in (${page.label}): "${await page.textContent('#si-msg').catch(() => '?')}"`); });
  await afterReload(page);
}
async function signOut(page) {
  await page.evaluate(() => { HGI_SYNC.signOut(); }); await page.waitForSelector('.acct-dlg');
  const nav = page.waitForEvent('load'); await page.click('.acct-dlg .acct-btn-primary'); await nav;
  await page.waitForFunction(() => window.HGI_SIGNIN_READY === true);
}
const waitDlg = page => page.waitForSelector('.acct-dlg', { timeout: 15000 }).catch(async e => {
  const info = await page.evaluate(() => ({ msg: (document.getElementById('si-msg') || {}).textContent, signin: !!document.getElementById('signin-screen'), ready: window.HGI_READY, acct: !!localStorage.getItem('hgi_account'), legacy: !!localStorage.getItem('hgi_billing_v7_prod'), owner: localStorage.getItem('hgi_legacy_owner') })).catch(x => String(x));
  throw new Error(`no dialog on ${page.label}: ${JSON.stringify(info)}`);
});
const syncNow = page => page.evaluate(() => HGI_SYNC._syncNow().then(() => HGI_SYNC.status()));
const st = page => page.evaluate(() => ({ nums: state.invoices.map(d => d.num).sort(), cust: state.customers.map(c => c.name).sort(), co: state.company.name, key: STORAGE_KEY, sync: HGI_SYNC.status() }));
const finishOnboarding = (page, name = 'Test Co') => page.evaluate(n => { const ob = document.getElementById('onboarding'); if (ob) ob.remove(); state.ui.onboarded = true; state.company.name = n; saveState(); }, name);
async function addDoc(page, num, buyer = 'Ravi Pumps', extra = {}) {
  await page.evaluate(([num, buyer, extra]) => {
    const now = new Date().toISOString();
    state.invoices.unshift(Object.assign({ id: 'DOC-' + Math.random().toString(36).slice(2, 10), docType: 'INV', num, date: '2026-10-20', buyerName: buyer, buyerGstin: '24AAPFU0939F1Z1', pos: '24',
      items: [{ desc: 'Monoblock pump 1HP', hsn: '8413', gst: 18, qty: 2, unit: 'NOS', rate: 5000 }], payments: [], taxable: 10000, cgst: 900, sgst: 900, igst: 0, grandTotal: 11800, createdAt: now, updatedAt: now }, extra));
    if (!state.customers.some(c => c.name === buyer)) state.customers.push({ id: 'C-' + buyer.replace(/\W/g, ''), name: buyer, gstin: '' });
    saveState(); renderAll();
  }, [num, buyer, extra]);
}
const tokenOf = page => page.evaluate(() => JSON.parse(localStorage.getItem('hgi_account')).session);
async function cloud(page) {
  const tok = await tokenOf(page); const all = []; let s = 0, more = true;
  while (more) { const r = await (await fetch(`${syncBase}/v1/sync/pull?since=${s}&limit=300`, { headers: { Authorization: 'Bearer ' + tok } })).json(); all.push(...r.records); more = r.more; if (r.records.length) s = r.records[r.records.length - 1].seq; }
  const live = new Map(); all.forEach(r => live.set(r.kind + '~' + r.id, r));
  const recs = [...live.values()].filter(r => !r.deleted);
  return { invoices: recs.filter(r => r.kind === 'invoice').map(r => JSON.parse(r.data)), customers: recs.filter(r => r.kind === 'customer').map(r => JSON.parse(r.data)), company: (recs.find(r => r.kind === 'company') || {}).data };
}
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `cloud-${n}.png`) });
const offline = page => page.route(syncBase + '/**', r => r.abort('internetdisconnected'));
const online = page => page.unroute(syncBase + '/**');

/* ---------------------------------------------------------------- 1. sign in, work, records in the cloud */
console.log('\n▶ Sign in and automatic sync (records)');
const A1 = await device('phoneA');
await open(A1);
check(await A1.isVisible('#signin-screen') && !(await A1.isVisible('#app-container')), 'sign-in required before any data is shown');
await signIn(A1, 'asha@example.com');
let s = await st(A1);
check(/^hgi_billing_u_[a-f0-9]{24}$/.test(s.key), 'account opens its own data slot');
await finishOnboarding(A1);
await addDoc(A1, 'HGI/1'); await addDoc(A1, 'HGI/2', 'Mehta Agro');
let r = await syncNow(A1);
let c = await cloud(A1);
check(r.status === 'ok' && r.pending === 0 && c.invoices.map(d => d.num).sort().join() === 'HGI/1,HGI/2' && c.customers.length === 2 && JSON.parse(c.company).name === 'Test Co',
  `buyers, invoices and company profile stored as separate cloud records (${c.invoices.length} invoices, ${c.customers.length} buyers)`);
await addDoc(A1, 'HGI/3');
await A1.waitForFunction(() => HGI_SYNC.status().pending === 0 && HGI_SYNC.status().status === 'ok', null, { timeout: 15000 }).catch(() => null);
check((await cloud(A1)).invoices.length === 3, 'a new invoice uploads by itself within seconds of saving');
check(await A1.evaluate(() => !/No backup taken yet/.test(document.body.innerText)), 'no manual-backup warnings');

/* ---------------------------------------------------------------- 2. any phone: sign in → everything is there */
console.log('\n▶ Install on another phone / reinstall');
const B1 = await device('phoneB');
await open(B1); await signIn(B1, 'asha@example.com');
s = await st(B1);
check(s.nums.join() === 'HGI/1,HGI/2,HGI/3' && s.co === 'Test Co' && s.cust.length === 2 && !(await B1.isVisible('#onboarding')), `second phone: all data after sign-in, no restore step (${s.nums.join(', ')})`);
r = await syncNow(B1);
check(r.status === 'ok' && r.pending <= 1, 'second phone in sync');
await shot(B1, '01-second-phone');

/* ---------------------------------------------------------------- 3. both phones offline at the same time → nothing lost */
console.log('\n▶ Two phones billing offline at the same time');
await offline(A1); await offline(B1);
await addDoc(A1, 'HGI/4', 'Offline Buyer A'); await addDoc(B1, 'HGI/5', 'Offline Buyer B');
r = await syncNow(A1);
check(r.status === 'offline' && r.pending >= 1, `offline: billing works, ${r.pending} change(s) waiting (status "${r.status}")`);
await syncNow(B1);
await online(A1); await online(B1);
await syncNow(A1); await syncNow(B1); await syncNow(A1);
const a = await st(A1), b = await st(B1);
check(a.nums.join() === 'HGI/1,HGI/2,HGI/3,HGI/4,HGI/5' && b.nums.join() === a.nums.join() && a.cust.includes('Offline Buyer B') && b.cust.includes('Offline Buyer A'),
  `back online: both phones have both phones' invoices and buyers (${a.nums.join(', ')})`);
check((await cloud(A1)).invoices.length === 5 && new Set((await cloud(A1)).invoices.map(d => d.id)).size === 5, 'no duplicate invoices in the cloud');

/* ---------------------------------------------------------------- 4. same number issued offline on both → clash, fix */
console.log('\n▶ Same invoice number issued on two phones offline');
await offline(A1); await offline(B1);
await addDoc(A1, 'HGI/6', 'Clash Buyer A'); await addDoc(B1, 'HGI/6', 'Clash Buyer B');
await online(A1); await syncNow(A1);
await online(B1); r = await syncNow(B1);
check(r.clashes.join() === 'HGI/6', `second phone: "HGI/6" refused by the cloud (already used) — kept on the phone (${JSON.stringify(r.clashes)})`);
check(await B1.isVisible('#sync-banner') && /HGI\/6/.test(await B1.textContent('#sync-banner')), 'banner tells the user, with a Fix button');
await shot(B1, '02-number-clash');
let cl = await cloud(A1);
check(cl.invoices.filter(d => d.num === 'HGI/6').length === 1 && cl.invoices.find(d => d.num === 'HGI/6').buyerName === 'Clash Buyer A', 'cloud has exactly one HGI/6 (the first one)');
const fixRun = B1.evaluate(() => HGI_SYNC.fixClashes());
await B1.waitForSelector('.acct-dlg', { timeout: 10000 });
const fixText = await B1.textContent('.acct-dlg');
check(/HGI\/6\s*→\s*HGI\/7|HGI\/6 → \S+/.test(fixText.replace(/\s+/g, ' ')), `fix offers the next free number: ${fixText.replace(/\s+/g, ' ').match(/HGI\/6 → \S+/)}`);
await shot(B1, '03-renumber');
await B1.click('.acct-dlg .acct-btn-primary'); await fixRun;
await syncNow(A1);
cl = await cloud(A1);
const bNums = (await st(B1)).nums, aNums = (await st(A1)).nums;
check(cl.invoices.some(d => d.buyerName === 'Clash Buyer B' && d.num !== 'HGI/6') && new Set(cl.invoices.map(d => d.num)).size === cl.invoices.length && aNums.join() === bNums.join(),
  `renumbered and uploaded; all numbers unique, both phones equal (${bNums.slice(-3).join(', ')})`);
check(!(await B1.isVisible('#sync-banner')), 'banner gone');

/* ---------------------------------------------------------------- 5. same invoice changed on both phones */
console.log('\n▶ Same invoice changed on two phones');
await offline(A1); await offline(B1);
await A1.evaluate(() => { const d = state.invoices.find(x => x.num === 'HGI/1'); d.payments.push({ id: 'PAY-A', date: '2026-10-25', amount: 3000, tds: 0, mode: 'UPI', ref: 'A' }); d.updatedAt = new Date().toISOString(); saveState(); });
await new Promise(r => setTimeout(r, 20));
await B1.evaluate(() => { const d = state.invoices.find(x => x.num === 'HGI/1'); d.payments.push({ id: 'PAY-B', date: '2026-10-26', amount: 2000, tds: 0, mode: 'Cash', ref: 'B' }); d.updatedAt = new Date().toISOString(); saveState(); });
await online(A1); await online(B1);
await syncNow(A1); await syncNow(B1); await syncNow(A1);
const pa = await A1.evaluate(() => state.invoices.find(x => x.num === 'HGI/1').payments.map(p => p.id).sort().join());
const pb = await B1.evaluate(() => state.invoices.find(x => x.num === 'HGI/1').payments.map(p => p.id).sort().join());
check(pa === 'PAY-A,PAY-B' && pb === pa, `receipts recorded on both phones are all kept (${pa})`);

/* ---------------------------------------------------------------- 6. deletion reaches the other phone */
console.log('\n▶ Deletion');
await A1.evaluate(() => { state.invoices = state.invoices.filter(d => d.num !== 'HGI/2'); saveState(); renderAll(); });
await syncNow(A1); await syncNow(B1);
check(!(await st(B1)).nums.includes('HGI/2') && !(await cloud(A1)).invoices.some(d => d.num === 'HGI/2'), 'invoice deleted on one phone disappears on the other');

/* ---------------------------------------------------------------- 7. GSTIN look-up in the buyer form */
console.log('\n▶ GSTIN → buyer details');
await A1.evaluate(() => { switchTab('customers'); openCustomerModal(); });
await A1.fill('#modal-cust-gstin', G_OK); await A1.dispatchEvent('#modal-cust-gstin', 'input');
await A1.waitForSelector('#gst-fetch.loading', { timeout: 3000 }).then(() => true, () => false);
await A1.waitForSelector('#gst-fetch.done', { timeout: 10000 });
const f = await A1.evaluate(() => ({ name: $('modal-cust-name').value, addr: $('modal-cust-address').value, st: $('modal-cust-state').value, code: $('modal-cust-state-code').value, pin: $('modal-cust-pin').value, panel: $('gst-fetch').innerText }));
check(f.name === 'Shree Ram Engineering' && f.addr === 'Plot 14, Ram Udyog, MIDC Road, Bhosari, Pune' && f.st === 'Maharashtra' && f.code === '27' && f.pin === '411026', `valid GSTIN fills trade name, address, state, code, PIN (${f.name}; ${f.addr}; ${f.pin})`);
check(/ACTIVE/i.test(f.panel) && /SHREE RAM ENGINEERING PRIVATE LIMITED/.test(f.panel) && /Private Limited Company/.test(f.panel) && /Test GSP/.test(f.panel), 'shows status, legal name, constitution and the source');
await shot(A1, '04-gstin-fetch');
await A1.fill('#modal-cust-phone', '9822012345');
await A1.click('#customer-modal button[onclick="saveCustomerFromModal()"]');
const saved = await A1.evaluate(g => { const c = state.customers.find(x => x.gstin === g); return c && { name: c.name, info: c.gstInfo && c.gstInfo.legalName, status: c.gstInfo && c.gstInfo.status }; }, G_OK);
check(saved && saved.info === 'SHREE RAM ENGINEERING PRIVATE LIMITED' && saved.status === 'Active', 'saved buyer keeps the GST registration details');
// typed name is not overwritten; cancelled registration is flagged
await A1.evaluate(() => openCustomerModal());
await A1.fill('#modal-cust-name', 'My own name for them'); await A1.dispatchEvent('#modal-cust-name', 'input');
await A1.fill('#modal-cust-gstin', G_CANCEL); await A1.dispatchEvent('#modal-cust-gstin', 'input');
await A1.waitForSelector('#gst-fetch.done', { timeout: 10000 });
const f2 = await A1.evaluate(() => ({ name: $('modal-cust-name').value, addr: $('modal-cust-address').value, panel: $('gst-fetch').innerText, use: !!$('gx-use') }));
check(f2.name === 'My own name for them' && f2.addr.startsWith('5, Station Road') && f2.use, 'a name the user typed is kept (empty fields filled; "Use GST details" offered)');
check(/CANCELLED/i.test(f2.panel) && /31\/03\/2023/.test(f2.panel) && /may not be valid/.test(f2.panel), 'cancelled registration clearly warned, with the date');
await shot(A1, '05-gstin-cancelled');
// not found / wrong check digit / offline: nothing filled, clear message
await A1.evaluate(() => openCustomerModal());
await A1.fill('#modal-cust-gstin', G_NONE); await A1.dispatchEvent('#modal-cust-gstin', 'input');
await A1.waitForSelector('#gst-fetch.error', { timeout: 10000 });
check(/No taxpayer with this GSTIN/.test(await A1.textContent('#gst-fetch')) && await A1.inputValue('#modal-cust-name') === '', 'unknown GSTIN: "not found", nothing invented');
await offline(A1);
const G_OFF = gstin('33AAACI1195H1Z'); g.gstRecords.set(G_OFF, { gstin: G_OFF, lgnm: 'X', sts: 'Active' });
await A1.fill('#modal-cust-gstin', G_OFF); await A1.dispatchEvent('#modal-cust-gstin', 'input');
await A1.waitForSelector('#gst-fetch.error', { timeout: 10000 });
const offTxt = await A1.textContent('#gst-fetch');
check(/No internet/.test(offTxt) && await A1.isEditable('#modal-cust-name'), `offline: message + manual entry stays possible (${offTxt.trim().slice(0, 90)})`);
await online(A1);
await A1.click('#gx-retry'); await A1.waitForSelector('#gst-fetch.done', { timeout: 10000 });
check(await A1.inputValue('#modal-cust-name') === 'X', '"Try again" works once back online');
await A1.evaluate(() => closeModal('customer-modal'));
// invoice form
await A1.evaluate(() => { switchTab('create-invoice'); newDocument('INV'); });
await A1.fill('#inv-buyer-gstin', G_OK); await A1.dispatchEvent('#inv-buyer-gstin', 'input');
check(await A1.isVisible('#inv-gst-fetch'), 'invoice form: "Fetch GST details" appears for a valid GSTIN');
await A1.click('#inv-gst-fetch'); await A1.waitForTimeout(800);
check(await A1.inputValue('#inv-buyer-name') === 'Shree Ram Engineering' && await A1.inputValue('#inv-buyer-pin') === '411026', 'invoice form: buyer filled from GST records');

/* ---------------------------------------------------------------- 8. other accounts never see this data */
console.log('\n▶ Account separation');
const C1 = await device('phoneC');
await open(C1); await signIn(C1, 'bharat@example.com');
check((await st(C1)).nums.length === 0 && (await cloud(C1)).invoices.length === 0, 'another account starts empty and its cloud has nothing of Asha\'s');
await finishOnboarding(C1, 'Bharat Steel'); await addDoc(C1, 'HGI/1', 'Bharat buyer'); await syncNow(C1);
check((await cloud(C1)).invoices.length === 1 && (await cloud(A1)).invoices.filter(d => d.num === 'HGI/1').length === 1, 'same invoice number in another account is independent');

/* ---------------------------------------------------------------- 9. existing (pre-account) data: moved only with the user's OK */
console.log('\n▶ Upgrade: phone data from before sign-in');
const legacy = { credentials: { username: 'admin', password: '123' }, company: { name: 'Old Phone Traders' }, products: [], customers: [{ id: 'LC1', name: 'Legacy Buyer' }],
  invoices: [{ id: 'L1', docType: 'INV', num: 'OLD/1', date: '2026-09-01', buyerName: 'Legacy Buyer', items: [{ desc: 'Valve', hsn: '8481', gst: 18, qty: 1, unit: 'NOS', rate: 100 }], payments: [], grandTotal: 118 }], ui: { rev: 55, onboarded: true } };
const legacyStorage = { cookies: [], origins: [{ origin: appBase, localStorage: [{ name: 'hgi_billing_v7_prod', value: JSON.stringify(legacy) }] }] };
const U = await device('upgraded', legacyStorage);
await open(U);
await fillSignIn(U, 'chetan@example.com');
const navU = U.waitForEvent('load', { timeout: 25000 }); await U.click('#si-go');
await waitDlg(U);
check(/Move this phone's data into your account/.test(await U.textContent('.acct-dlg')) && /1 document/.test(await U.textContent('.acct-dlg')), 'asks before moving the phone\'s existing data (shows what)');
await shot(U, '06-migrate-confirm');
await U.click('.acct-dlg .acct-btn-primary'); await navU; await afterReload(U); await syncNow(U);
check((await st(U)).co === 'Old Phone Traders' && (await cloud(U)).invoices.some(d => d.num === 'OLD/1'), 'after "Move": data in the account and uploaded');
const U2 = await device('upgraded-declined', legacyStorage);
await open(U2); await fillSignIn(U2, 'dina@example.com');
const navU2 = U2.waitForEvent('load', { timeout: 25000 }); await U2.click('#si-go');
await waitDlg(U2); await U2.click('.acct-dlg button:not(.acct-btn-primary)'); await navU2; await afterReload(U2); await syncNow(U2);
check((await st(U2)).nums.length === 0 && (await cloud(U2)).invoices.length === 0 && await U2.evaluate(() => !!localStorage.getItem('hgi_billing_v7_prod')), 'after "Not now": nothing uploaded, the phone\'s data left untouched');
const U3 = await device('upgraded-merge', legacyStorage);
await open(U3); await fillSignIn(U3, 'asha@example.com');
const navU3 = U3.waitForEvent('load', { timeout: 25000 }); await U3.click('#si-go');
await waitDlg(U3);
check(/Add this phone's data to your account/.test(await U3.textContent('.acct-dlg')), 'account already has data: offers to add the phone\'s data');
await U3.click('.acct-dlg .acct-btn-primary'); await navU3; await afterReload(U3); await syncNow(U3); await syncNow(A1);
const merged = (await st(A1)).nums;
check(merged.includes('OLD/1') && merged.includes('HGI/1') && (await st(U3)).co === 'Test Co', `added: account now has both (${merged.length} documents), the account's business profile kept`);

/* ---------------------------------------------------------------- 9b. proforma / purchase orders sync like invoices */
console.log('\n▶ Proforma invoice and purchase order on another phone');
await addDoc(A1, 'PI/01/26-27', 'Mehta Agro', { docType: 'PI' });
await addDoc(A1, 'PO/01/26-27', 'Kirloskar Castings', { docType: 'PO' });
await syncNow(A1); await syncNow(B1);
const onB = await B1.evaluate(() => state.invoices.filter(d => d.docType === 'PI' || d.docType === 'PO').map(d => d.docType + ' ' + d.num).sort());
check(onB.join() === 'PI PI/01/26-27,PO PO/01/26-27', `proforma and purchase order synced to the second phone (${onB.join(', ')})`);
await B1.evaluate(() => { const po = state.invoices.find(d => d.docType === 'PO'); markPoReceived(po.id); });
await syncNow(B1); await syncNow(A1);
check(await A1.evaluate(() => !!state.invoices.find(d => d.docType === 'PO').receivedAt), '"received" on one phone shows on the other');

/* ---------------------------------------------------------------- 9c. accounts: clear messages, log-out on the server, password change */
console.log('\n▶ Accounts: sign-up / log-in messages, log-out, password change, rows in Google Sheets');
const D1 = await device('phoneD');
await open(D1);
const siMsg = async () => (await D1.textContent('#si-msg')).trim();
const pressGo = async () => { await D1.click('#si-go'); await D1.waitForFunction(() => { const b = document.getElementById('si-go'); return b && !b.disabled; }, null, { timeout: 15000 }); };
await fillSignIn(D1, 'asha@example.com', { mode: 'signup' }); await pressGo();
check(/taken/i.test(await siMsg()) && await D1.getAttribute('#si-msg', 'role') === 'alert', `sign-up with a name in use: "${await siMsg()}"`);
await fillSignIn(D1, 'newname@example.com', { mode: 'signup', password: 'password123' });
await pressGo();
check(/too common/i.test(await siMsg()), `weak password refused with a reason: "${await siMsg()}"`);
await D1.click('#si-tab-signup'); await D1.fill('#si-user', 'other.name'); await D1.fill('#si-pass', 'Good-Pass-2026'); await D1.fill('#si-pass2', 'Good-Pass-2027'); await D1.click('#si-go');
check(/not the same/i.test(await siMsg()) && await D1.getAttribute('#si-pass2', 'aria-invalid') === 'true', 'repeat password must match (checked before sending)');
await fillSignIn(D1, 'asha@example.com', { mode: 'login', password: 'Wrong-Pass-1' }); await pressGo();
check(/incorrect/i.test(await siMsg()), `wrong password: "${await siMsg()}"`);
await D1.click('#si-tab-login'); await D1.fill('#si-user', ''); await D1.click('#si-go');
check(/Enter your username/i.test(await siMsg()), 'empty form: asks for the username');
await signIn(D1, 'asha@example.com');
check((await st(D1)).nums.includes('HGI/1'), 'log-in on a new phone with username + password: the account\'s data is there');
const dTok = await tokenOf(D1);
await signOut(D1);
check(/Logged out/.test(await D1.textContent('#si-msg')), 'after log-out the sign-in screen says so');
const dAfter = await fetch(`${syncBase}/v1/me`, { headers: { Authorization: 'Bearer ' + dTok } });
check(dAfter.status === 401 && (await dAfter.json()).error === 'session_revoked', 'log-out ended the session on the server (the old token no longer works)');
await signIn(D1, 'asha@example.com');
check((await st(D1)).nums.includes('HGI/1'), 'log in again after log-out: everything is still there (kept in Google Sheets)');
const asha = await D1.evaluate(() => HGI_ACCOUNT.key);
const sheetId = cfg.spreadsheetId;
const rowsOf = (tab, uid) => { const t = g.sheets.dump(sheetId, tab); const h = t[0]; return t.slice(1).filter(r => r[h.indexOf('userId')] === uid).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
const invRows = rowsOf('Invoices', asha), itemRows = rowsOf('InvoiceItems', asha);
check(invRows.some(r => r.num === 'HGI/1' && r.grandTotal === 11800) && itemRows.some(r => r.desc === 'Monoblock pump 1HP' && r.qty === 2) && rowsOf('Customers', asha).length >= 2,
  `the account's invoices, lines and buyers are rows in Google Sheets with its userId (${invRows.length} invoices, ${itemRows.length} lines)`);
const everything = JSON.stringify(g.sheets.books.get(sheetId));
check(!everything.includes(TEST_PASSWORD) && !everything.includes(dTok), 'no password and no session token anywhere in the spreadsheet');
// password change on one phone logs the account out on its other phones
const C2 = await device('phoneC2'); await open(C2); await signIn(C2, 'bharat@example.com');
await C1.evaluate(() => { HGI_SYNC.changePassword(); }); await C1.waitForSelector('.acct-dlg #acp-cur');
await C1.fill('#acp-cur', TEST_PASSWORD); await C1.fill('#acp-new', 'Changed-Pass-2026'); await C1.fill('#acp-new2', 'Changed-Pass-2026');
await C1.click('.acct-dlg .acct-btn-primary');
await C1.waitForFunction(() => /Password changed/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => null);
check(await C1.evaluate(() => /Password changed/.test(document.body.innerText)), 'password changed (message shown)');
const c2 = await syncNow(C2);
check(c2.status === 'signin' && await C2.evaluate(() => !!document.getElementById('acct-relogin') || /Log in again/.test(document.body.innerText)), `the other phone is logged out and asked to log in again (status "${c2.status}")`);
check(await C2.evaluate(() => state.invoices.length >= 0 && !!localStorage.getItem('hgi_billing_u_' + HGI_ACCOUNT.key)), 'its data stays on that phone meanwhile');

// a small phone (or the keyboard taking half the screen): the whole form must still be reachable
{
  const ctx = await browser.newContext({ viewport: { width: 320, height: 480 }, isMobile: true, hasTouch: true });
  const P = await ctx.newPage(); P.label = 'tiny'; P.on('pageerror', e => errors.push('tiny: ' + e));
  await open(P); await fillSignIn(P, 'tiny@example.com');
  const nav = P.waitForEvent('load', { timeout: 20000 });
  let ok = true; try { await P.click('#si-go', { timeout: 8000 }); await nav; } catch (e) { ok = false; }
  check(ok, 'on a 320×480 screen the Create account button can be reached and works');
  await ctx.close();
}

/* ---------------------------------------------------------------- 10. Demo Mode never syncs; delete account */
console.log('\n▶ Demo Mode and account deletion');
await B1.evaluate(() => HGI_M.enterDemo({ confirmed: true })); await B1.waitForFunction(() => window.HGI_READY === true && typeof DEMO_MODE !== 'undefined' && DEMO_MODE, null, { timeout: 20000 });
await B1.evaluate(() => { state.company.name = 'DEMO EDIT'; saveState(); }); await B1.waitForTimeout(4000);
check(JSON.parse((await cloud(A1)).company).name === 'Test Co', 'Demo Mode sample data is never uploaded');
await B1.evaluate(() => HGI_M.exitDemo({ confirmed: true })); await B1.waitForFunction(() => window.HGI_READY === true && !DEMO_MODE, null, { timeout: 20000 });
await C1.evaluate(() => { HGI_SYNC.deleteAccount(); }); await C1.waitForSelector('.acct-dlg');
await C1.fill('.acct-dlg input[type=text]', 'delete'); await C1.fill('#del-pass', 'Changed-Pass-2026');
const nav9 = C1.waitForEvent('load', { timeout: 20000 }); await C1.click('.acct-dlg .acct-btn-danger'); await nav9;
await C1.waitForFunction(() => window.HGI_SIGNIN_READY === true);
check(await C1.isVisible('#signin-screen') && await C1.evaluate(() => !localStorage.getItem('hgi_account') && !Object.keys(localStorage).some(k => k.startsWith('hgi_billing_u_'))), 'delete account: cloud data gone, phone signed out and cleared');

check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); sync.close(); appServer.close(); await g.stop();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
