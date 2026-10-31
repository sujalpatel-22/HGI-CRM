#!/usr/bin/env node
// v8.2 checks in Chromium (web build): no login flash for a logged-in session, start-up cover, WhatsApp message text,
// bulk-export filters. Native parts (PDF ZIP, WhatsApp intent, Android logout) are covered by tests/android-smoke.mjs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const WWW = path.join(root, 'www');
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', png: 'image/png', svg: 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html')));
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  // slow scripts a little, like a phone: makes a login flash observable if it exists
  const delay = /mobile\.js|studio\.js/.test(p) ? 600 : 0;
  setTimeout(() => { res.writeHead(200, { 'Content-Type': TYPES[p.split('.').pop()] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); }, delay);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
let pass = 0, fail = 0;
const check = (c, m) => { c ? pass++ : fail++; console.log(`   ${c ? '✓' : '✗'} ${m}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
// sample the screen from the very first script: is the login form ever visible (not covered by the start-up cover)?
await page.addInitScript(() => {
  window.__frames = [];
  const tick = () => {
    const lo = document.getElementById('login-overlay'), bs = document.getElementById('boot-splash');
    const loVis = !!lo && getComputedStyle(lo).display !== 'none';
    const covered = !!bs && getComputedStyle(bs).display !== 'none';
    window.__frames.push({ loVis, covered });
    if (!window.HGI_READY || window.__frames.length < 400) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

console.log('▶ First start (not logged in)');
await page.goto(base); await page.waitForFunction(() => window.HGI_READY === true);
let fr = await page.evaluate(() => window.__frames);
check(fr.length > 0 && fr[0].covered, `start-up cover shown from the first frame (${fr.length} frames sampled)`);
check(await page.isVisible('#login-overlay'), 'not logged in: login screen shown after start-up');
await page.fill('#login-username', 'admin'); await page.fill('#login-password', '123'); await page.click('#login-overlay button[type=submit]');
await page.waitForTimeout(300);
await page.evaluate(() => { const ob = document.getElementById('onboarding'); if (ob) ob.remove(); state.ui.onboarded = true; state.company.name = 'Flash Test Co'; state.company.phone = '9876543210'; saveState(); });

console.log('▶ Re-open while logged in');
for (let i = 1; i <= 3; i++) {
  await page.reload(); await page.waitForFunction(() => window.HGI_READY === true);
  await page.waitForTimeout(300);
  fr = await page.evaluate(() => window.__frames);
  const flash = fr.filter(f => f.loVis && !f.covered).length;
  check(flash === 0 && !(await page.evaluate(() => window.__hgiLoginShown)) && await page.isVisible('#app-container'), `open #${i}: dashboard directly, login screen visible in ${flash} of ${fr.length} frames`);
}

console.log('▶ WhatsApp message');
const wa = await page.evaluate(() => {
  state.invoices.push({ id: 'W1', docType: 'INV', num: 'HGI/77', date: todayISO(), buyerName: 'Ravi Pumps', buyerPhone: '98765 43210', creditDays: 30,
    items: [{ desc: 'Pump', hsn: '8413', gst: 18, qty: 1, unit: 'NOS', rate: 1000 }], payments: [], grandTotal: 1180, taxable: 1000 });
  state.company.bankAcc = '123456'; state.company.bankIfsc = 'PUNB0213800'; state.company.bankName = 'PNB'; saveState();
  const d = state.invoices.find(x => x.id === 'W1');
  const urls = []; const o = window.open; window.open = u => { urls.push(decodeURIComponent(String(u))); return null; }; shareWhatsApp('W1'); window.open = o;
  return { att: whatsAppText(d, true), web: urls[0] || '', phone: whatsAppPhone(d) };
});
check(/^Dear Ravi Pumps,/.test(wa.att) && /Please find attached our \*Tax Invoice No\. HGI\/77\*/.test(wa.att) && /Balance due:\* ₹/.test(wa.att) && /IFSC: PUNB0213800/.test(wa.att) && /Regards,\n\*Flash Test Co\*/.test(wa.att), 'message with attached PDF: greeting, document, amount, balance, bank details, sign-off');
check(!/shared separately/.test(wa.att) && /shared separately/.test(wa.web), 'attached version does not say "shared separately"; the web (text-only) version does');
check(wa.phone === '919876543210' && wa.web.startsWith('https://wa.me/919876543210?text='), 'buyer phone normalised to 91XXXXXXXXXX');

console.log('▶ Bulk export filters');
const bm = await page.evaluate(() => {
  const mk = (id, type, num, date, buyer, extra = {}) => ({ id, docType: type, num, date, buyerName: buyer, items: [{ desc: 'x', hsn: '8413', gst: 18, qty: 1, unit: 'NOS', rate: 100 }], payments: [], grandTotal: 118, ...extra });
  state.invoices = [mk('a', 'INV', '1', '2026-04-05', 'Alpha'), mk('b', 'INV', '2', '2026-05-10', 'Beta'), mk('c', 'INV', '3', '2026-06-15', 'Alpha'),
    mk('d', 'INV', '4', '2026-06-20', 'Alpha', { cancelled: true }), mk('e', 'CRN', 'CN/1', '2026-06-21', 'Alpha'), mk('f', 'QUO', 'QT/1', '2026-06-22', 'Beta'), mk('g', 'INV', '5', '2025-12-01', 'Beta')];
  const n = f => HGI_M.bulkMatches(f).map(d => d.num).join(',');
  return { all: n({ type: 'INV' }), range: n({ type: 'INV', from: '2026-05-01', to: '2026-06-30' }), alpha: n({ type: 'INV', buyer: 'alpha ' }),
    canc: n({ type: 'INV', buyer: 'Alpha', cancelled: true }), notes: n({ type: 'NOTES' }), quo: n({ type: 'QUO' }), every: n({ type: 'ALL', from: '2026-06-01' }) };
});
check(bm.all === '5,1,2,3', `tax invoices, oldest first, cancelled left out (${bm.all})`);
check(bm.range === '2,3', `date range 01-05-2026 … 30-06-2026 (${bm.range})`);
check(bm.alpha === '1,3', `buyer filter (case/space-insensitive) (${bm.alpha})`);
check(bm.canc === '1,3,4', `"include cancelled" adds the cancelled invoice (${bm.canc})`);
check(bm.notes === 'CN/1' && bm.quo === 'QT/1' && bm.every === '3,CN/1,QT/1', `document type filter (notes ${bm.notes}, quotations ${bm.quo}, all since June ${bm.every})`);
check(await page.evaluate(() => !document.getElementById('btn-bulk-export')), 'web build: no bulk PDF button (needs the Android PDF engine)');

check(errors.length === 0, 'no JavaScript errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
