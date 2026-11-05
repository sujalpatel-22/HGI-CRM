#!/usr/bin/env node
'use strict';
/**
 * Live check of a deployed HGI Billing service against the REAL Google Spreadsheet — run once after every deployment:
 *
 *   node scripts/verify-deployment.js https://hgi-sync-xxxxx.a.run.app
 *
 * It creates a throw-away account (verify-<random>), then checks, through the public API only:
 *   sign-up, log-in, a wrong password, log-out (the session really ends), a second device's session,
 *   upload of a company profile, buyer, product and invoices with lines and payments, including texts that look like
 *   formulas, texts with apostrophes, unicode, long texts and a 120 KB logo, then reads everything back and compares it
 *   byte-for-byte; a duplicate invoice number; an edit conflict; numbers check; finally deletes the account.
 * It prints PASS / FAIL per check and exits 1 on any failure. Nothing else in the spreadsheet is touched; the test
 * account's rows are removed at the end (the Users row stays, marked "deleted").
 */
const crypto = require('crypto');
const base = String(process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) { console.error('usage: node scripts/verify-deployment.js https://<service url>'); process.exit(2); }
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${!c && extra ? '\n      ' + extra : ''}`); };
async function call(method, p, { body, token } = {}) {
  const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: r.status, json, text };
}
(async () => {
  const h = await call('GET', '/healthz');
  ok(h.status === 200 && h.json.ok === true && h.json.storage === 'google-sheets', 'service is up and opened the spreadsheet', h.text.slice(0, 300));
  if (h.json) console.log(`      quote mode: ${h.json.quoteMode} · cells used: ${h.json.cells} of ${h.json.cellLimit}`);
  const user = 'verify-' + crypto.randomBytes(4).toString('hex'), pw = 'Verify-' + crypto.randomBytes(9).toString('base64url');
  const su = await call('POST', '/v1/auth/signup', { body: { username: user, password: pw, device: 'verify-deployment' } });
  ok(su.status === 201 && /^hgi1\./.test(su.json && su.json.session), 'sign-up', su.text.slice(0, 300));
  if (su.status !== 201) return done();
  const T = su.json.session;
  ok((await call('POST', '/v1/auth/login', { body: { username: user, password: 'wrong-' + pw } })).status === 401, 'wrong password refused');
  const li = await call('POST', '/v1/auth/login', { body: { username: user.toUpperCase(), password: pw } });
  ok(li.status === 200, 'log-in (user name in another case)'); const T2 = li.json && li.json.session;
  const tricky = ['=IMPORTXML("http://example.com","//a")', '+91 98765 43210', '-5', '@SUM(A1)', "'apostrophe", "''two", 'ગુજરાત ₹ 🧾', 'two\nlines', ' spaced ', '0012', '1e5', 'x'.repeat(45000)];
  const logo = 'data:image/png;base64,' + crypto.randomBytes(90 * 1024).toString('base64');
  const inv = (id, num, o = {}) => ({ id, docType: 'INV', num, date: '2026-11-06', supplyType: 'B2B', pos: '24', buyerName: tricky[0], buyerGstin: '', buyerAddress: tricky.join('|').slice(0, 3000), discount: 0, pfCharges: 0,
    items: [{ desc: tricky[1], hsn: '8413', qty: 2, unit: 'NOS', rate: 1234.56, gst: 18 }, { desc: tricky[4], hsn: '', qty: 0.25, unit: 'KGS', rate: 0, gst: 0, taxability: 'exempt' }],
    payments: [{ id: 'PAY-' + id, date: '2026-11-06', amount: 500, tds: 0, mode: 'UPI', ref: tricky[2] }], edoc: { note: null, list: [1, 'a', {}] }, cancelled: false, grandTotal: 2913.56, ...o });
  const recs = [
    ['company', 'main', { name: 'Verify Co', gstin: '24AAACH7409R1Z7', address: tricky[7], logo, showLogo: true, prefixes: { INV: '' } }],
    ['settings', 'main', { ui: { invoiceStyle: 'modern', onboarded: true } }],
    ['customer', 'VC1', { id: 'VC1', name: tricky[3], phone: tricky[1], city: tricky[5], state: tricky[6], email: '', creditLimit: 0 }],
    ['product', 'VP1', { id: 'VP1', name: tricky[8], hsn: tricky[9], rate: 1e5, gst: 18, unit: 'NOS', specs: tricky[11] }],
    ['invoice', 'VD1', inv('VD1', 'V/1')], ['invoice', 'VD2', inv('VD2', 'V/2', { items: [] })]
  ];
  const sent = new Map(recs.map(([k, id, o]) => [k + '/' + id, JSON.stringify(o)]));
  const p = await call('POST', '/v1/sync/push', { token: T, body: { device: 'verify', records: recs.map(([kind, id, o]) => ({ kind, id, baseRev: 0, data: JSON.stringify(o), modifiedAt: new Date().toISOString() })) } });
  ok(p.status === 200 && p.json.results.every(x => x.status === 'ok'), 'upload of company, settings, buyer, product, 2 invoices', p.text.slice(0, 400));
  const pull = await call('GET', '/v1/sync/pull?since=0&limit=300', { token: T2 });
  const got = new Map(((pull.json && pull.json.records) || []).map(r => [r.kind + '/' + r.id, r.data]));
  for (const [k, text] of sent) ok(got.get(k) === text, `read back byte-for-byte from the spreadsheet: ${k}`, got.has(k) ? `sent ${text.slice(0, 120)}…\n      got  ${String(got.get(k)).slice(0, 120)}…` : 'missing');
  const dup = await call('POST', '/v1/sync/push', { token: T2, body: { device: 'verify-2', records: [{ kind: 'invoice', id: 'VD3', baseRev: 0, data: JSON.stringify(inv('VD3', 'v/1')) }] } });
  ok(dup.json && dup.json.results[0].status === 'number_taken', 'duplicate invoice number refused');
  const stale = await call('POST', '/v1/sync/push', { token: T2, body: { device: 'verify-2', records: [{ kind: 'customer', id: 'VC1', baseRev: 0, data: JSON.stringify({ id: 'VC1', name: 'changed' }) }] } });
  ok(stale.json && stale.json.results[0].status === 'conflict', 'stale edit gets a conflict');
  ok((await call('POST', '/v1/numbers/check', { token: T, body: { docType: 'INV', num: 'V/1', docId: 'X' } })).json.free === false, 'number check');
  ok((await call('POST', '/v1/auth/logout', { token: T2 })).status === 200 && (await call('GET', '/v1/me', { token: T2 })).status === 401, 'log-out ends the session on the server');
  const del = await call('DELETE', '/v1/account', { token: T, body: { password: pw } });
  ok(del.status === 200, 'test account deleted', del.text.slice(0, 200));
  ok((await call('GET', '/v1/me', { token: T })).status === 401, 'deleted account\'s session no longer works');
  done();
})().catch(e => { console.error(e); process.exit(1); });
function done() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
