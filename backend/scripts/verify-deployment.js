#!/usr/bin/env node
'use strict';
/**
 * Live check of a deployed HGI Billing service against the REAL Google Spreadsheet. Uses the public API only and needs
 * no secret: it makes its own throw-away accounts (verify-<random>) with random passwords that are never printed.
 *
 *   node scripts/verify-deployment.js https://hgi-sync-xxxxx.a.run.app                 one run, cleans up after itself
 *   node scripts/verify-deployment.js https://… --keep  /tmp/hgi-verify.json            phase 1: keeps the test account
 *   (restart the service: a new revision — deploy/verify-live.sh does this for you)
 *   node scripts/verify-deployment.js https://… --resume /tmp/hgi-verify.json           phase 2: a NEW instance must
 *                                                   serve the same data from the spreadsheet; then deletes the account
 *
 * Checks: sign-up; duplicate user name refused (in another letter case); weak password refused; wrong password refused;
 * log-in; upload of a company profile, settings, buyer, product and invoices with lines and payments, including texts
 * that look like formulas, apostrophes, unicode, a 45,000-character text and a 90 KB logo; read back byte-for-byte on a
 * second device; a second account sees none of the first account's data, cannot change it, and can reuse the same
 * invoice number and record IDs for itself; duplicate number and edit conflict within one account; log-out ends the
 * session, and the data is still there after logging in again; account deletion.
 * Prints PASS / FAIL per check and exits 1 on any failure.
 */
const crypto = require('crypto');
const fs = require('fs');
const args = process.argv.slice(2);
const base = String(args[0] || '').replace(/\/$/, '');
const flag = (n) => { const i = args.indexOf(n); return i > 0 ? args[i + 1] : null; };
const keepFile = flag('--keep'), resumeFile = flag('--resume');
if (!/^https?:\/\//.test(base) || (args.includes('--keep') && !keepFile) || (args.includes('--resume') && !resumeFile)) {
  console.error('usage: node scripts/verify-deployment.js https://<service url> [--keep <state file> | --resume <state file>]'); process.exit(2);
}
let pass = 0, fail = 0;
const ok = (c, m, extra = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${m}${!c && extra ? '\n      ' + extra : ''}`); return c; };
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
async function call(method, p, { body, token } = {}, waited = 0) {
  const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  if (r.status === 429 && waited < 2) {          // the service's own per-network sign-up / log-in limit: wait, don't fail
    console.log('      (the service\'s rate limit answered "wait a minute" — waiting 65 s, as an app user would)');
    await new Promise(res => setTimeout(res, 65000)); return call(method, p, { body, token }, waited + 1);
  }
  return { status: r.status, json, text };
}
const signup = (username, password) => call('POST', '/v1/auth/signup', { body: { username, password, device: 'verify-deployment' } });
const login = (username, password, device = 'verify-deployment') => call('POST', '/v1/auth/login', { body: { username, password, device } });
async function pullAll(token) {
  const out = new Map(); let since = 0;
  for (let i = 0; i < 50; i++) {
    const r = await call('GET', `/v1/sync/pull?since=${since}&limit=300`, { token });
    if (r.status !== 200) throw new Error('pull failed: ' + r.status + ' ' + r.text.slice(0, 200));
    for (const x of r.json.records || []) out.set(x.kind + '/' + x.id, x);
    const list = r.json.records || [];
    if (!r.json.more || !list.length) break; since = list[list.length - 1].seq;
  }
  return out;
}
const push = (token, records, device = 'verify') => call('POST', '/v1/sync/push', { token, body: { device, records } });
function compare(sentHashes, got, label) {
  for (const [k, h] of Object.entries(sentHashes)) {
    const r = got.get(k);
    ok(r && !r.deleted && sha(r.data) === h, `${label}: ${k}`, r ? `stored text differs (${String(r.data).slice(0, 120)}…)` : 'missing');
  }
}
async function health(label) {
  const h = await call('GET', '/healthz');
  ok(h.status === 200 && h.json && h.json.ok === true && h.json.storage === 'google-sheets', `${label}: service is up and opened the spreadsheet`, h.text.slice(0, 300));
  if (h.json && h.json.ok) console.log(`      quote mode: ${h.json.quoteMode} · cells used: ${h.json.cells} of ${h.json.cellLimit} · instance started ${h.json.startedAt}`);
  return h.json || {};
}
async function deleteAccount(token, password, label) {
  const del = await call('DELETE', '/v1/account', { token, body: { password } });
  ok(del.status === 200, `${label} deleted`, del.text.slice(0, 200));
  ok((await call('GET', '/v1/me', { token })).status === 401, `${label}: its session no longer works`);
}

async function fullRun() {
  const h = await health('start');
  if (!h.ok) return;
  const rnd = () => crypto.randomBytes(4).toString('hex');
  const user = 'verify-' + rnd(), pw = 'Verify-' + crypto.randomBytes(12).toString('base64url');
  const su = await signup(user, pw);
  if (!ok(su.status === 201 && /^hgi1\./.test(su.json && su.json.session), 'sign-up', su.text.slice(0, 300))) return;
  const T = su.json.session, uid = su.json.user && su.json.user.key;
  ok((await signup(user.toUpperCase(), 'Other-' + pw)).status === 409, 'the same user name (in capitals) cannot be taken again');
  ok((await signup('verify-' + rnd(), 'password')).status === 400, 'a weak password is refused at sign-up');
  ok((await login(user, 'wrong-' + pw)).status === 401, 'wrong password refused');
  const li = await login(user.toUpperCase(), pw, 'verify-device-2');
  ok(li.status === 200 && li.json.user && li.json.user.key === uid, 'log-in on a second device (user name in another case) reaches the same account');
  const T2 = li.json && li.json.session;

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
  const sentHashes = Object.fromEntries(recs.map(([k, id, o]) => [k + '/' + id, sha(JSON.stringify(o))]));
  const p = await push(T, recs.map(([kind, id, o]) => ({ kind, id, baseRev: 0, data: JSON.stringify(o), modifiedAt: new Date().toISOString() })));
  ok(p.status === 200 && p.json.results.every(x => x.status === 'ok'), 'upload of company, settings, buyer, product, 2 invoices', p.text.slice(0, 400));
  compare(sentHashes, await pullAll(T2), 'second device reads it back byte-for-byte');

  // ── a second account: separate data, no access to the first one's
  const userB = 'verify-' + rnd(), pwB = 'Verify-' + crypto.randomBytes(12).toString('base64url');
  const sb = await signup(userB, pwB);
  if (ok(sb.status === 201, 'second account signs up', sb.text.slice(0, 200))) {
    const TB = sb.json.session;
    const seenByB = await pullAll(TB);
    ok(![...seenByB.keys()].some(k => k in sentHashes), 'second account sees none of the first account\'s records', [...seenByB.keys()].join(', '));
    const bWrite = await push(TB, [{ kind: 'customer', id: 'VC1', baseRev: 0, data: JSON.stringify({ id: 'VC1', name: 'B own buyer' }) }, { kind: 'invoice', id: 'VD9', baseRev: 0, data: JSON.stringify(inv('VD9', 'V/1')) }], 'verify-b');
    ok(bWrite.json && bWrite.json.results.every(x => x.status === 'ok'), 'second account can use the same record ID and invoice number for itself', bWrite.text.slice(0, 300));
    const aAfter = await pullAll(T);
    ok(aAfter.get('customer/VC1') && sha(aAfter.get('customer/VC1').data) === sentHashes['customer/VC1'] && !aAfter.has('invoice/VD9'), 'the first account\'s buyer is unchanged and it does not see the second account\'s invoice');
    ok(![...(await pullAll(TB)).keys()].some(k => k === 'invoice/VD1' || k === 'company/main'), 'second account still sees only its own records');
    await deleteAccount(TB, pwB, 'second test account');
  }

  const dup = await push(T2, [{ kind: 'invoice', id: 'VD3', baseRev: 0, data: JSON.stringify(inv('VD3', 'v/1')) }], 'verify-2');
  ok(dup.json && dup.json.results[0].status === 'number_taken', 'duplicate invoice number refused within one account');
  const stale = await push(T2, [{ kind: 'customer', id: 'VC1', baseRev: 0, data: JSON.stringify({ id: 'VC1', name: 'changed' }) }], 'verify-2');
  ok(stale.json && stale.json.results[0].status === 'conflict', 'stale edit gets a conflict');
  ok((await call('POST', '/v1/numbers/check', { token: T, body: { docType: 'INV', num: 'V/1', docId: 'X' } })).json.free === false, 'number check');
  ok((await call('POST', '/v1/auth/logout', { token: T2 })).status === 200 && (await call('GET', '/v1/me', { token: T2 })).status === 401, 'log-out ends the session on the server');
  const again = await login(user, pw, 'verify-device-3');
  if (ok(again.status === 200, 'log-in again after log-out')) compare(sentHashes, await pullAll(again.json.session), 'after log-out and log-in, data still there');

  if (keepFile) {
    fs.writeFileSync(keepFile, JSON.stringify({ base, user, pw, uid, sentHashes, startedAt: h.startedAt, at: new Date().toISOString() }), { mode: 0o600 });
    console.log(`\nKept the test account ${user} for the restart check. State (with its random test password) is in ${keepFile} —`);
    console.log('restart the service (new revision), then run this script again with --resume ' + keepFile + '. It deletes the account and the file.');
  } else await deleteAccount(T, pw, 'test account');
}

async function resume() {
  let st;
  try { st = JSON.parse(fs.readFileSync(resumeFile, 'utf8')); } catch (e) { console.error('cannot read ' + resumeFile + ': ' + e.message); process.exit(2); }
  if (st.base !== base) { console.error(`the state file is for ${st.base}, not ${base}`); process.exit(2); }
  const h = await health('after restart');
  ok(h.startedAt && h.startedAt !== st.startedAt && h.startedAt > st.at, 'a NEW instance is serving (started after phase 1), so everything below comes from the spreadsheet',
    `instance started ${h.startedAt}; phase 1 ran ${st.at} on an instance started ${st.startedAt} — restart the service first`);
  const li = await login(st.user, st.pw, 'verify-after-restart');
  if (ok(li.status === 200 && li.json.user && li.json.user.key === st.uid, 'log-in after the restart (password hash read back from the Users tab)', li.text.slice(0, 200))) {
    compare(st.sentHashes, await pullAll(li.json.session), 'after restart, read back byte-for-byte from the spreadsheet');
    await deleteAccount(li.json.session, st.pw, 'test account');
  }
  try { fs.unlinkSync(resumeFile); } catch (e) { /* already gone */ }
}

(keepFile && resumeFile ? Promise.reject(new Error('use --keep or --resume, not both')) : resumeFile ? resume() : fullRun())
  .then(done).catch(e => { console.error('ERROR ' + e.message); fail++; done(); });
function done() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
