#!/usr/bin/env node
// The real web app (www/) in Chromium talking to the FREE server: the Google Apps Script bundle (gas/dist/Code.js, built
// from the same server modules) in the local Apps Script stand-in (backend/test/gas-sim.js) on the Sheets stand-in.
// Checks the app's Apps Script transport: one text/plain POST envelope per call, no CORS pre-flight, answers {status, body}.
// Two browser contexts = two phones on one account.
import { fillSignIn, TEST_PASSWORD } from './lib/accounts.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WWW = path.join(root, 'www'), OUT = path.join(root, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const { build } = await import(path.join(root, 'tools', 'build-gas.mjs'));
build();
const { FakeSheets } = require('../backend/test/fake-sheets.js');
const { GasSim } = require('../backend/test/gas-sim.js');

let failures = 0, passes = 0;
const check = (cond, msg) => { if (cond) { passes++; console.log('   ✓', msg); } else { failures++; console.log('   ✗', msg); } };

const fake = new FakeSheets();
const sheetId = fake.create('HGI Billing data');
const sim = new GasSim({ fake, spreadsheetId: sheetId, props: { PBKDF2_ITER: '20000' } });
const gasSrv = await sim.listen();
const preflights = [];
gasSrv.prependListener('request', req => { if (req.method === 'OPTIONS') preflights.push(req.url); });

const appServer = http.createServer();
await new Promise(r => appServer.listen(0, '127.0.0.1', r));
const appBase = `http://127.0.0.1:${appServer.address().port}`;
const gasOrigin = new URL(sim.url).origin;
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', png: 'image/png', svg: 'image/svg+xml', json: 'application/json' };
appServer.on('request', (req, res) => {
  const u = new URL(req.url, 'http://x').pathname;
  if (u === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(`window.HGI_CONFIG = ${JSON.stringify({ auth: 'test', syncUrl: sim.url, transport: 'gas' })};`); }
  const p = path.join(WWW, decodeURIComponent(u.replace(/^\/$/, '/index.html')));
  if (p.endsWith('index.html')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(p, 'utf8').replace("connect-src 'self'", "connect-src 'self' " + gasOrigin)); }
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});

const browser = await chromium.launch();
const errors = [];
async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource|ERR_|net::/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  page.on('dialog', d => d.accept());
  return page;
}
const open = async page => { await page.goto(appBase + '/'); await page.waitForFunction(() => window.HGI_READY === true || window.HGI_SIGNIN_READY === true, null, { timeout: 20000 }); };
async function signIn(page, user, mode) {
  await fillSignIn(page, user + '@x', { mode });
  const nav = page.waitForEvent('load', { timeout: 30000 });
  await page.click('#si-go');
  await nav.catch(async () => { throw new Error(`no reload after sign-in: "${await page.textContent('#si-msg').catch(() => '?')}"`); });
  await page.waitForFunction(() => window.HGI_READY === true && !document.getElementById('signin-screen'), null, { timeout: 30000 });
}
const syncNow = page => page.evaluate(() => HGI_SYNC._syncNow().then(() => HGI_SYNC.status()));

try {
  console.log('▶ Free server (Apps Script stand-in): sign-up, invoice, second phone');
  const A = await device('A'); await open(A);
  check(await A.isVisible('#signin-screen'), 'sign-in screen shown');
  await signIn(A, 'gasfree', 'signup');
  check(await A.evaluate(() => /^hgi_billing_u_[a-f0-9]{24}$/.test(STORAGE_KEY)), 'account created through the Apps Script server');
  await A.evaluate(() => {
    state.company = Object.assign(state.company || {}, { name: 'Free Server Traders', gstin: '24AAPFU0939F1Z1', address: 'Ahmedabad', state: 'Gujarat', stateCode: '24' });
    state.customers.push({ id: 'C-GAS-1', name: "=HYPERLINK(\"x\") 'quoted' ગુજરાત", gstin: '' });
    state.invoices.unshift({ id: 'D-GAS-1', docType: 'INV', num: 'FREE/1', date: '2026-11-15', buyerName: 'Walk-in', items: [{ desc: 'Item', qty: 2, rate: 500, gst: 18 }], grandTotal: 1180, payments: [] });
    saveState();
  });
  const st = await syncNow(A);
  await A.waitForFunction(() => HGI_SYNC.status().pending === 0 && HGI_SYNC.status().status === 'ok', null, { timeout: 20000 }).catch(() => null);
  const s2 = await A.evaluate(() => HGI_SYNC.status());
  check(s2.status === 'ok' && s2.pending === 0, `phone A uploaded everything (status ${s2.status}, pending ${s2.pending}${s2.error ? ', ' + s2.error : ''})`);
  const inv = fake.dump(sheetId, 'Invoices'); const h = inv[0] || [];
  check(inv.slice(1).some(r => r[h.indexOf('num')] === 'FREE/1'), 'the invoice is a row in the Invoices tab');
  const users = fake.dump(sheetId, 'Users'), uh = users[0];
  check(users.slice(1).some(r => /^pbkdf2\$1\$/.test(String(r[uh.indexOf('passwordHash')]))) && !JSON.stringify(users).includes(TEST_PASSWORD), 'Users tab: PBKDF2 hash only, no password text');

  const B = await device('B'); await open(B);
  await signIn(B, 'gasfree', 'login');
  await B.waitForFunction(() => state.invoices.some(d => d.num === 'FREE/1'), null, { timeout: 20000 }).catch(() => null);
  const got = await B.evaluate(() => ({ inv: JSON.stringify(state.invoices.find(d => d.id === 'D-GAS-1') || null), cust: (state.customers.find(c => c.id === 'C-GAS-1') || {}).name, co: state.company.name }));
  const sent = await A.evaluate(() => JSON.stringify(state.invoices.find(d => d.id === 'D-GAS-1')));
  // phone B's app adds the computed totals to this bare test invoice (as it does for every invoice); what A saved must be identical
  const sa = JSON.parse(sent), sb = JSON.parse(got.inv || 'null') || {};
  check(Object.keys(sa).every(k => JSON.stringify(sa[k]) === JSON.stringify(sb[k])), 'phone B got the invoice with every field exactly as saved on phone A');
  check(got.cust === "=HYPERLINK(\"x\") 'quoted' ગુજરાત" && got.co === 'Free Server Traders', 'buyer (formula-like, apostrophes, unicode) and company profile came back unchanged');
  // an edit on B reaches A
  await B.evaluate(() => { const d = state.invoices.find(x => x.id === 'D-GAS-1'); d.notes = 'edited on B'; saveState(); });
  await syncNow(B); await syncNow(A);
  check(await A.evaluate(() => (state.invoices.find(x => x.id === 'D-GAS-1') || {}).notes === 'edited on B'), 'an edit on phone B reaches phone A');
  check(preflights.length === 0, `no CORS pre-flight requests (Apps Script cannot answer them): ${preflights.length}`);
  // log-out ends the session on the server
  const tok = await B.evaluate(() => JSON.parse(localStorage.getItem('hgi_account')).session);
  await B.evaluate(() => { HGI_SYNC.signOut(); }); await B.waitForSelector('.acct-dlg');
  await B.evaluate(() => document.querySelector('.acct-dlg .acct-btn-primary').click());   // layout is covered by sync-e2e
  await B.waitForFunction(() => window.HGI_SIGNIN_READY === true && !localStorage.getItem('hgi_account'), null, { timeout: 30000 })
    .catch(async () => {
      const info = await B.evaluate(() => ({ acct: !!localStorage.getItem('hgi_account'), signin: window.HGI_SIGNIN_READY, dlg: (document.querySelector('.acct-dlg') || {}).textContent })).catch(x => String(x));
      throw new Error('log-out did not finish: ' + JSON.stringify(info));
    });
  await new Promise(r => setTimeout(r, 1500));
  check(sim.post({ m: 'GET', p: '/v1/me', t: tok }).status === 401, 'log-out on phone B ended its session on the server');
  await A.screenshot({ path: path.join(OUT, 'gas-web-A.png') });
} catch (e) { failures++; console.log('   ✗ aborted:', String(e.stack || e).split('\n').slice(0, 16).join(' / ')); }
check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close(); gasSrv.close(); appServer.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
