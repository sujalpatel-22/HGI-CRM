#!/usr/bin/env node
// End-to-end test of sign-in + automatic cloud sync: the real web app (www/) in Chromium, the real sync service
// (backend/server.js) and an in-memory stand-in for Google Drive/Sheets (backend/test/fake-google.js).
// The app runs with the TEST sign-in (test accounts @example.com) — the Google sign-in itself is covered by the
// backend tests (token verification) and needs a real device + Google project.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WWW = path.join(root, 'www');
const OUT = path.join(root, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const { FakeGoogle } = require('../backend/test/fake-google.js');
const { createServer } = require('../backend/server.js');
const config = require('../backend/lib/config.js');

let failures = 0, passes = 0;
const check = (cond, msg) => { if (cond) { passes++; console.log('   ✓', msg); } else { failures++; console.log('   ✗', msg); } };

/* ---------------------------------------------------------------- services */
const g = await new FakeGoogle().start();
const appServer = http.createServer();
await new Promise(r => appServer.listen(0, '127.0.0.1', r));
const appBase = `http://127.0.0.1:${appServer.address().port}`;
const cfg = config.load({ GOOGLE_CLIENT_IDS: 'test-web-client.apps.googleusercontent.com', SESSION_SECRET: 'x'.repeat(40), DRIVE_FOLDER_ID: 'hgi-folder', DRIVE_AUTH: 'metadata',
  HGI_ALLOW_TEST_LOGIN: '1', ALLOWED_ORIGINS: appBase });
cfg.endpoints = g.endpoints();
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
  res.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

/* ---------------------------------------------------------------- helpers */
const browser = await chromium.launch();
const errors = [];
async function device(name, storage) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, storageState: storage });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  page.on('dialog', d => d.accept());
  page.ctx = ctx; page.label = name;
  return page;
}
const open = async page => { await page.goto(appBase + '/'); await page.waitForFunction(() => window.HGI_READY === true || window.HGI_SIGNIN_READY === true, null, { timeout: 20000 }); };
async function signIn(page, email) {
  await page.waitForSelector('#signin-screen #si-go', { timeout: 15000 });
  await page.fill('#si-email', email);
  const nav = page.waitForEvent('load', { timeout: 20000 }).catch(() => null);
  await page.click('#si-go');
  // the choice dialog (phone data vs cloud) may appear before the reload
  return nav;
}
const afterReload = page => page.waitForFunction(() => window.HGI_READY === true && !document.getElementById('signin-screen'), null, { timeout: 20000 })
  .catch(async e => { console.log('   … diagnostics:', JSON.stringify(await page.evaluate(() => ({ msg: (document.getElementById('si-msg') || {}).textContent, ready: window.HGI_READY, acct: localStorage.getItem('hgi_account') }))), errors.slice(-5)); throw e; });
const syncNow = page => page.evaluate(() => HGI_SYNC._syncNow().then(() => HGI_SYNC.status()));
const st = page => page.evaluate(() => ({ inv: state.invoices.length, cust: state.customers.length, co: state.company.name, key: STORAGE_KEY, acct: window.HGI_ACCOUNT, sync: HGI_SYNC.status() }));
const finishOnboarding = page => page.evaluate(name => { const ob = document.getElementById('onboarding'); if (ob) ob.remove(); state.ui.onboarded = true; state.company.name = name; saveState(); }, 'Test Co');
async function addDoc(page, num, buyer = 'Ravi Pumps') {
  await page.evaluate(([num, buyer]) => {
    state.invoices.unshift({ id: 'INV-' + num + '-' + Math.random().toString(36).slice(2, 7), docType: 'INV', num, date: '2026-10-20', buyerName: buyer, buyerGstin: '24AAPFU0939F1Z1', pos: '24',
      items: [{ desc: 'Monoblock pump 1HP', hsn: '8413', gst: 18, qty: 2, unit: 'NOS', rate: 5000 }], payments: [], taxable: 10000, cgst: 900, sgst: 900, igst: 0, grandTotal: 11800 });
    if (!state.customers.some(c => c.name === buyer)) state.customers.push({ id: 'C-' + buyer, name: buyer, gstin: '24AAPFU0939F1Z1' });
    saveState(); renderAll();
  }, [num, buyer]);
}
const sheetOf = key => g.spreadsheetOf(key);
const shot = (page, n) => page.screenshot({ path: path.join(OUT, `sync-${n}.png`) });

/* ---------------------------------------------------------------- 1. first start: sign-in required */
console.log('\n▶ First start');
const A1 = await device('phoneA');
await open(A1);
check(await A1.isVisible('#signin-screen'), 'sign-in screen shown before anything else');
check(!(await A1.isVisible('#app-container')) && !(await A1.isVisible('#login-overlay')), 'app and old login hidden until signed in');
check(await A1.evaluate(() => typeof state === 'undefined' || !(state.invoices || []).length), 'no business data reachable while signed out');
await shot(A1, '01-signin');

/* ---------------------------------------------------------------- 2. sign in, work, auto-sync */
console.log('\n▶ Sign in and automatic sync');
await signIn(A1, 'asha@example.com'); await afterReload(A1);
let s = await st(A1);
check(s.acct && s.acct.email === 'asha@example.com', 'signed in as asha@example.com');
check(/^hgi_billing_u_[a-f0-9]{24}$/.test(s.key), `data opened in the account's own slot (${s.key})`);
check(s.inv === 0 && await A1.isVisible('#onboarding'), 'new account starts empty with the setup wizard');
await finishOnboarding(A1);
await addDoc(A1, 'HGI/1'); await addDoc(A1, 'HGI/2', 'Mehta Agro');
const r1 = await syncNow(A1);
check(r1.status === 'ok' && r1.sync.version >= 1, `synced automatically to the cloud (status ${r1.status}, version ${r1.sync.version})`);
const keyA = s.acct.key;
const sheetA = sheetOf(keyA);
check(!!sheetA && sheetA.parents[0] === 'hgi-folder', 'account spreadsheet created in the company Drive folder');
const invRows = sheetA ? g.rows(sheetA.id, 'Invoices') : [];
check(invRows.length === 3 && invRows.some(r => r[1] === 'HGI/2' && r[3] === 'Mehta Agro'), 'Invoices tab shows the two documents');
check(await A1.evaluate(() => !/No backup taken yet/.test(document.body.innerText)), 'no "take a backup" warning while cloud sync is on');
await A1.evaluate(() => switchTab('settings')); await A1.waitForTimeout(300);
const card = await A1.evaluate(() => { const c = document.getElementById('acct-card'); return c ? c.innerText : ''; });
check(/asha@example\.com/.test(card) && /Synced/.test(card), 'Settings → Account card shows the account and "Synced"');
await shot(A1, '02-account-card');

// a change is uploaded without pressing anything (debounced after save)
await addDoc(A1, 'HGI/3');
await A1.waitForFunction(() => HGI_SYNC.status().status === 'ok' && HGI_SYNC.status().sync.version >= 2, null, { timeout: 20000 }).catch(() => null);
check((await st(A1)).sync.sync.version >= 2 && g.rows(sheetOf(keyA).id, 'Invoices').length === 4, 'new document uploaded automatically after saving');

/* ---------------------------------------------------------------- 3. reinstall → sign in → restored */
console.log('\n▶ Reinstall (empty phone storage) and sign in again');
const A2 = await device('phoneA-reinstalled');
await open(A2); await signIn(A2, 'asha@example.com'); await afterReload(A2);
s = await st(A2);
check(s.inv === 3 && s.cust === 2 && s.co === 'Test Co', `all data restored after reinstall (${s.inv} documents, ${s.cust} buyers, company "${s.co}")`);
check(!(await A2.isVisible('#onboarding')), 'no setup wizard after a restore');
check(s.key === 'hgi_billing_u_' + keyA, 'same account → same data slot');
const r2 = await syncNow(A2);
check(r2.status === 'ok', 'restored phone is in sync (no conflict)');
await shot(A2, '03-restored');

/* ---------------------------------------------------------------- 4. second account on the same phone */
console.log('\n▶ Second account on the same phone');
await A2.evaluate(() => { HGI_SYNC.signOut(); });
await A2.waitForSelector('.acct-dlg'); await shot(A2, '04-signout-dialog');
const nav1 = A2.waitForEvent('load'); await A2.click('.acct-dlg .acct-btn-primary'); await nav1;
await A2.waitForFunction(() => window.HGI_SIGNIN_READY === true);
check(await A2.isVisible('#signin-screen'), 'after sign-out the sign-in screen is back');
await signIn(A2, 'bharat@example.com'); await afterReload(A2);
s = await st(A2);
check(s.inv === 0 && s.key !== 'hgi_billing_u_' + keyA, 'second account sees none of the first account\'s data');
await finishOnboarding(A2); await addDoc(A2, 'BS/1', 'Bharat Steel buyer'); await syncNow(A2);
const keyB = s.acct.key;
check(sheetOf(keyB) && sheetOf(keyB).id !== sheetOf(keyA).id, 'second account has its own spreadsheet');
check(!JSON.stringify(g.rows(sheetOf(keyB).id, 'Invoices')).includes('HGI/1') && !JSON.stringify(g.rows(sheetOf(keyA).id, 'Invoices')).includes('BS/1'), 'spreadsheets contain only their own account\'s documents');
// back to the first account on the same phone: its data is still here, offline-ready
await A2.evaluate(() => { HGI_SYNC.signOut(); }); await A2.waitForSelector('.acct-dlg');
const nav2 = A2.waitForEvent('load'); await A2.click('.acct-dlg .acct-btn-primary'); await nav2;
await signIn(A2, 'asha@example.com'); await afterReload(A2);
s = await st(A2);
check(s.inv === 3 && s.co === 'Test Co', 'first account\'s data is back when it signs in again');

/* ---------------------------------------------------------------- 5. upgrade from v8.0 (data saved before accounts existed) */
console.log('\n▶ Upgrade from a version without sign-in');
const legacy = { credentials: { username: 'admin', password: '123' }, company: { name: 'Old Phone Traders', gstin: '24AAPFU0939F1Z1' }, products: [], customers: [{ id: 'C1', name: 'Legacy Buyer' }],
  invoices: [{ id: 'L1', docType: 'INV', num: 'OLD/1', date: '2026-09-01', buyerName: 'Legacy Buyer', items: [{ desc: 'Valve', hsn: '8481', gst: 18, qty: 1, unit: 'NOS', rate: 100 }], payments: [], grandTotal: 118 }],
  ui: { rev: 55, onboarded: true } };
const legacyStorage = { cookies: [], origins: [{ origin: appBase, localStorage: [{ name: 'hgi_billing_v7_prod', value: JSON.stringify(legacy) }] }] };
const U = await device('upgraded-phone', legacyStorage);
await open(U);
check(await U.isVisible('#signin-screen'), 'upgraded app also asks for sign-in first');
await signIn(U, 'chetan@example.com'); await afterReload(U);
s = await st(U);
check(s.inv === 1 && s.co === 'Old Phone Traders', 'data from before sign-in is kept and moved into the account');
const r5 = await syncNow(U);
check(r5.status === 'ok' && g.rows(sheetOf(s.acct.key).id, 'Invoices').some(r => r[1] === 'OLD/1'), 'and uploaded to the account\'s cloud copy');
check(await U.evaluate(() => localStorage.getItem('hgi_billing_v7_prod') === null && localStorage.getItem('hgi_legacy_owner') === HGI_ACCOUNT.key), 'old slot claimed by this account');
await U.evaluate(() => { HGI_SYNC.signOut(); }); await U.waitForSelector('.acct-dlg');
const nav3 = U.waitForEvent('load'); await U.click('.acct-dlg .acct-btn-primary'); await nav3;
await signIn(U, 'dina@example.com'); await afterReload(U);
check((await st(U)).inv === 0, 'another account on the upgraded phone does not get that data');

// legacy data AND an existing cloud copy → the user chooses; the other copy is kept as a safety copy
const U2 = await device('upgraded-phone-2', legacyStorage);
await open(U2);
await U2.fill('#si-email', 'asha@example.com');
const nav4 = U2.waitForEvent('load', { timeout: 20000 });
await U2.click('#si-go');
await U2.waitForSelector('.acct-dlg', { timeout: 15000 });
const dlg = await U2.evaluate(() => document.querySelector('.acct-dlg').innerText);
check(/Which data should this account use/.test(dlg) && /3 documents/.test(dlg) && /1 document,/.test(dlg), 'phone data vs cloud copy: user is asked, with counts of both');
await shot(U2, '05-choose-data');
await U2.click('.acct-dlg .acct-btn-primary');      // "Use cloud copy"
await nav4; await afterReload(U2);
s = await st(U2);
check(s.inv === 3 && s.co === 'Test Co', 'cloud copy opened');
check(await U2.evaluate(() => { const b = localStorage.getItem(STORAGE_KEY + '_before_restore'); return !!b && JSON.parse(b).company.name === 'Old Phone Traders'; }), 'phone data kept as safety copy (Undo restore)');

/* ---------------------------------------------------------------- 6. offline */
console.log('\n▶ Offline');
await A2.route(syncBase + '/**', r => r.abort('internetdisconnected'));
await addDoc(A2, 'HGI/4');
const off = await syncNow(A2);
check(off.status === 'offline', `no internet → change kept on the phone, status "${off.status}"`);
check((await st(A2)).inv === 4, 'document saved locally while offline');
await A2.unroute(syncBase + '/**');
const on = await syncNow(A2);
check(on.status === 'ok' && g.rows(sheetOf(keyA).id, 'Invoices').length === 5, 'back online → uploaded');

/* ---------------------------------------------------------------- 7. two phones, one account */
console.log('\n▶ Two phones with the same account');
// A1 has not pulled the latest yet; with no local edits it simply updates
const before = (await st(A1)).inv;
const p7 = await syncNow(A1);
s = await st(A1);
check(p7.status === 'ok' && s.inv === 4 && before === 3, `phone without local changes picks up the other phone's changes (${before} → ${s.inv})`);
// both edit before syncing → conflict → user picks; nothing silently lost
await A2.route(syncBase + '/**', r => r.abort('internetdisconnected'));
await addDoc(A2, 'HGI/5-phoneB'); await syncNow(A2);
await addDoc(A1, 'HGI/5-phoneA'); await syncNow(A1);
await A2.unroute(syncBase + '/**');
const conflictRun = A2.evaluate(() => HGI_SYNC._syncNow());
await A2.waitForSelector('.acct-dlg', { timeout: 15000 });
const cd = await A2.evaluate(() => document.querySelector('.acct-dlg').innerText);
check(/changed on two devices/i.test(cd), 'edits on both phones → conflict dialog, nothing overwritten silently');
await shot(A2, '06-conflict');
await A2.click('.acct-dlg button:not(.acct-btn-primary)');   // keep this phone's data
await conflictRun; await syncNow(A2);
s = await st(A2);
const cloudNow = JSON.stringify(g.rows(sheetOf(keyA).id, 'Invoices'));
check(s.inv === 5 && cloudNow.includes('HGI/5-phoneB') && !cloudNow.includes('HGI/5-phoneA'), 'kept this phone\'s data and uploaded it');
check(await A2.evaluate(() => (JSON.parse(localStorage.getItem(STORAGE_KEY + '_before_restore') || '{}').invoices || []).some(d => d.num === 'HGI/5-phoneA')), 'the other phone\'s version kept as safety copy');

/* ---------------------------------------------------------------- 8. Demo Mode is never synced */
console.log('\n▶ Demo Mode');
const v8 = (await st(A2)).sync.sync.version;
await A2.evaluate(() => HGI_M.enterDemo({ confirmed: true })); await A2.waitForFunction(() => window.HGI_READY === true && typeof DEMO_MODE !== 'undefined' && DEMO_MODE, null, { timeout: 20000 });
await A2.evaluate(() => { state.company.name = 'DEMO EDIT'; saveState(); });
await A2.waitForTimeout(5000);
check(!JSON.stringify(g.rows(sheetOf(keyA).id, 'Company')).includes('DEMO') && !(await A2.evaluate(() => HGI_SYNC.active())), 'sample data in Demo Mode is not uploaded');
await A2.evaluate(() => HGI_M.exitDemo({ confirmed: true })); await A2.waitForFunction(() => window.HGI_READY === true && !DEMO_MODE, null, { timeout: 20000 });
check((await st(A2)).inv === 5 && (await st(A2)).sync.sync.version === v8, 'real data unchanged after leaving Demo Mode');

/* ---------------------------------------------------------------- 9. delete account */
console.log('\n▶ Delete account');
const dk = (await st(U)).acct.key;
await syncNow(U);
check(!!sheetOf(dk), 'account to delete has a cloud spreadsheet');
await U.evaluate(() => { HGI_SYNC.deleteAccount(); }); await U.waitForSelector('.acct-dlg');
await shot(U, '07-delete');
await U.fill('.acct-dlg input[type=text]', 'delete');
const nav9 = U.waitForEvent('load', { timeout: 20000 }); await U.click('.acct-dlg .acct-btn-danger'); await nav9;
await U.waitForFunction(() => window.HGI_SIGNIN_READY === true);
check(await U.isVisible('#signin-screen'), 'after deletion the sign-in screen is shown');
check(!sheetOf(dk) && [...g.files.values()].some(f => f.appProperties.hgiDeletedUser === dk), 'account\'s cloud spreadsheet deleted');
check(await U.evaluate(k => localStorage.getItem('hgi_billing_u_' + k) === null && !localStorage.getItem('hgi_account'), dk), 'account data removed from the phone and signed out');
// deleted from the web page while another phone is still signed in → that phone stops and removes the data
await fetch(syncBase + '/v1/account', { method: 'DELETE', headers: { Authorization: 'Bearer ' + (await A1.evaluate(() => JSON.parse(localStorage.getItem('hgi_account')).session)) } });
const nav10 = A1.waitForEvent('load', { timeout: 20000 });
await A1.evaluate(() => HGI_SYNC._syncNow()).catch(() => null); await nav10;
await A1.waitForFunction(() => window.HGI_SIGNIN_READY === true, null, { timeout: 20000 });
check(await A1.evaluate(() => !Object.keys(localStorage).some(k => k.startsWith('hgi_billing_u_') && localStorage.getItem(k).includes('HGI/1'))), 'a phone signed in to a deleted account removes its copy and asks for sign-in');

check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); sync.close(); appServer.close(); await g.stop();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
