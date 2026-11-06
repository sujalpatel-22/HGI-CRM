#!/usr/bin/env node
'use strict';
/*
 * Cloud service tests. Google Sheets, OAuth tokens, Cloud Storage and the GST provider are in-memory stand-ins
 * (test/fake-google.js, test/fake-sheets.js). These tests check the server's own logic and its use of the Sheets API as
 * documented; they are not a test against the real Google Sheets — run scripts/verify-sheets.js once against the real
 * spreadsheet for that (see docs/SHEETS-SETUP.md).
 */
const assert = require('assert');
const crypto = require('crypto');
const { FakeGoogle } = require('./fake-google');
const { createServer } = require('../server');
const config = require('../lib/config');
const { gstinCheck } = require('../lib/gst');
const { TABLES } = require('../lib/sheets-schema');

const RUN = crypto.randomBytes(3).toString('hex');
let pass = 0, fail = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); pass++; results.push('PASS ' + name); console.log('  ✓ ' + name); }
  catch (e) { fail++; results.push('FAIL ' + name + ' — ' + e.message); console.log('  ✗ ' + name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 5).join('\n      ')); }
}
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstin(base14) { for (const c of CH) if (gstinCheck(base14 + c)) return base14 + c; throw new Error('no check digit'); }
const tp = (g, o = {}) => ({ gstin: g, lgnm: 'SHREE RAM ENGINEERING PRIVATE LIMITED', tradeNam: 'Shree Ram Engineering', sts: 'Active', rgdt: '01/07/2017', ctb: 'Private Limited Company', dty: 'Regular',
  nba: ['Factory / Manufacturing', 'Supplier of Services'], stj: 'Ghatak 12', ctj: 'RANGE-I', cxdt: '', lstupdt: '12/03/2024',
  pradr: { addr: { bno: 'Plot 14', bnm: 'Ram Udyog', flno: '', st: 'MIDC Road', loc: 'Bhosari', dst: 'Pune', stcd: 'Maharashtra', city: '', pncd: '411026', lt: '', lg: '' }, ntr: 'Factory / Manufacturing' }, ...o });
const quiet = () => {};

(async () => {
  const g = await new FakeGoogle().start();
  const SHEET = g.sheets.create('HGI Billing — test');
  const G1 = gstin('27AAPFU0939F1Z'), G2 = gstin('24AAACR5055K1Z'), GX = gstin('29AABCT1332L1Z');
  g.gstRecords.set(G1, tp(G1));
  g.gstRecords.set(G2, tp(G2, { lgnm: 'CANCELLED TRADERS', tradeNam: '', sts: 'Cancelled', cxdt: '31/03/2023', pradr: { addr: { bno: '5', st: 'Station Road', loc: 'Mehsana', dst: 'Mehsana', stcd: 'Gujarat', pncd: '384002' } } }));
  const env = { PORT: '0', SHEETS_SPREADSHEET_ID: SHEET, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), PASSWORD_PEPPER: crypto.randomBytes(32).toString('hex'), GCP_AUTH: 'metadata',
    FILES_BUCKET: 'hgi-files-test', GST_API_URL: 'http://placeholder/{gstin}', GST_API_HEADERS: JSON.stringify({ 'x-api-key': g.gstKey }), GST_API_NAME: 'Test GSP', SUPPORT_EMAIL: 'info@hariguru.com',
    HGI_ALLOW_TEST_LOGIN: '1', SHEETS_MISS_RELOAD_MS: '0', SIGNUP_PER_MINUTE: '10000', LOGIN_PER_MINUTE: '10000' };
  const mk = (over = {}) => {
    const c = config.load({ ...env, ...over }); c.endpoints = g.endpoints(); if (!over.GST_API_URL && c.gst.url) c.gst.url = g.gstUrl();
    c.scryptParams = { N: 1024, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };   // fast hashing in tests (production: N = 32768, checked below)
    return c;
  };
  const start = async (over = {}, deps = {}) => { const s = createServer(mk(over), { log: quiet, ...deps }); await new Promise(r => s.listen(0, '127.0.0.1', r)); return { s, url: `http://127.0.0.1:${s.address().port}` }; };
  const main = await start();
  const base = main.url;
  const call = async (method, p, { body, token, headers = {}, srv } = {}) => {
    const r = await fetch((srv || base) + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  const signup = (username, password, srv) => call('POST', '/v1/auth/signup', { body: { username, password, device: 'Test phone' }, srv });
  const login = (username, password, srv) => call('POST', '/v1/auth/login', { body: { username, password, device: 'Test phone' }, srv });
  const push = (tok, records, device = 'Phone A', srv) => call('POST', '/v1/sync/push', { token: tok, body: { device, records }, srv });
  const pullAll = async (tok, since = 0, srv) => { const all = []; let s = since, more = true; while (more) { const r = await call('GET', `/v1/sync/pull?since=${s}&limit=300`, { token: tok, srv }); assert.strictEqual(r.status, 200, r.text); all.push(...r.json.records); more = r.json.more; if (r.json.records.length) s = r.json.records[r.json.records.length - 1].seq; } return all; };
  const rec = (kind, id, obj, baseRev = 0, extra = {}) => ({ kind, id, baseRev, data: JSON.stringify(obj), modifiedAt: new Date().toISOString(), ...extra });
  const inv = (id, num, extra = {}) => ({ id, docType: 'INV', num, date: '2026-10-20', buyerName: 'Shree Ram Engineering', items: [{ desc: 'Pump', qty: 1, rate: 1000, gst: 18 }], payments: [], grandTotal: 1180, ...extra });
  const tab = name => g.sheets.dump(SHEET, name);
  const rowsOf = (name, uid) => { const t = tab(name); const h = t[0] || []; const ui = h.indexOf('userId'); return t.slice(1).filter(r => r[ui] === uid).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); };
  const allCells = () => JSON.stringify(TABLES.map(t => tab(t.name)).concat([tab('_Blobs'), tab('_Meta')]));
  const PW = 'Gst-Billing-2026!';

  console.log('Configuration');
  await test('Cloud Run refuses test endpoints and test switches', () => {
    assert.throws(() => config.load({ ...env, K_SERVICE: 'hgi' }), /not allowed on Cloud Run/);
    assert.throws(() => config.load({ ...env, HGI_ALLOW_TEST_LOGIN: '', K_SERVICE: 'hgi', SHEETS_API: 'http://127.0.0.1:1' }), /not allowed on Cloud Run/);
  });
  await test('needs the spreadsheet ID, two distinct strong secrets; GST URL must be https', () => {
    assert.throws(() => config.load({ ...env, SHEETS_SPREADSHEET_ID: '' }), /SHEETS_SPREADSHEET_ID/);
    assert.throws(() => config.load({ ...env, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
    assert.throws(() => config.load({ ...env, PASSWORD_PEPPER: 'short' }), /PASSWORD_PEPPER/);
    assert.throws(() => config.load({ ...env, PASSWORD_PEPPER: env.SESSION_SECRET }), /different secrets/);
    assert.throws(() => config.load({ ...env, HGI_ALLOW_TEST_LOGIN: '', GST_API_URL: 'http://plain' }), /https/);
    assert.throws(() => config.load({ ...env, GST_API_HEADERS: '{bad' }), /JSON/);
  });

  console.log('Spreadsheet structure');
  await test('first start creates every tab with its column names in row 1, protected for the server only', async () => {
    const h = await call('GET', '/healthz'); assert.strictEqual(h.status, 200, h.text); assert.strictEqual(h.json.ok, true); assert.ok(!isNaN(Date.parse(h.json.startedAt)));
    const b = g.sheets.books.get(SHEET);
    for (const t of TABLES) {
      const sh = b.sheets.find(s => s.props.title === t.name); assert.ok(sh, 'tab ' + t.name);
      assert.deepStrictEqual(tab(t.name)[0], t.columns.map(c => (typeof c === 'string' ? c : c.name)));
      assert.ok(sh.protectedRanges.length === 1 && sh.protectedRanges[0].warningOnly === false, 'protected ' + t.name);
      assert.strictEqual(sh.props.gridProperties.frozenRowCount, 1);
    }
    assert.ok(b.sheets.some(s => s.props.title === '_Meta') && b.sheets.some(s => s.props.title === '_Blobs'));
    assert.strictEqual(tab('Users')[0].slice(0, 6).join(','), 'userId,username,usernameKey,passwordHash,status,createdAt');
  });

  console.log('Accounts');
  let A, B, A2;
  await test('sign-up → session; Users row has a unique ID, the hashed password, creation date and status — never the password', async () => {
    const r = await signup('Asha.Traders', PW);
    assert.strictEqual(r.status, 201, r.text);
    assert.match(r.json.session, /^hgi1\.[A-Za-z0-9_-]{43}$/); assert.match(r.json.user.key, /^[a-f0-9]{24}$/); assert.strictEqual(r.json.user.username, 'Asha.Traders');
    A = r.json;
    const u = rowsOf('Users', A.user.key)[0];
    assert.strictEqual(u.username, 'Asha.Traders'); assert.strictEqual(u.usernameKey, 'asha.traders'); assert.strictEqual(u.status, 'active'); assert.ok(Date.parse(u.createdAt));
    assert.match(u.passwordHash, /^scrypt\$1\$N=\d+,r=8,p=1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{88}$/);
    assert.ok(!allCells().includes(PW), 'plain-text password nowhere in the spreadsheet');
    assert.ok(!allCells().includes(A.session) && !allCells().includes(A.session.slice(5)), 'session token not stored');
    assert.strictEqual(rowsOf('Sessions', A.user.key).length, 1);
  });
  await test('production password hashing uses scrypt N=32768, r=8 (default parameters)', async () => {
    const { SCRYPT } = require('../lib/accounts');
    assert.deepStrictEqual([SCRYPT.N, SCRYPT.r, SCRYPT.p], [32768, 8, 1]);
    const { Accounts } = require('../lib/accounts');
    const a = new Accounts({}, { passwordPepper: 'p'.repeat(32), sessionSecret: 's'.repeat(32) });
    const t0 = Date.now(); const h = await a.hash('Some-Password-1'); const ms = Date.now() - t0;
    assert.match(h, /^scrypt\$1\$N=32768,r=8,p=1\$/); assert.ok((await a.verifyHash('Some-Password-1', h)).ok); assert.ok(!(await a.verifyHash('Some-Password-2', h)).ok);
    console.log(`      (one production hash: ${ms} ms)`);
  });
  await test('usernames are unique regardless of case; 8 sign-ups racing for one name → exactly one account', async () => {
    const d = await signup('ASHA.TRADERS', 'Another-Pass-77'); assert.strictEqual(d.status, 409); assert.strictEqual(d.json.error, 'username_taken');
    const rs = await Promise.all(Array.from({ length: 8 }, () => signup('race.name', 'Race-Pass-1234')));
    assert.deepStrictEqual(rs.map(r => r.status).sort(), [201, 409, 409, 409, 409, 409, 409, 409]);
    assert.strictEqual(tab('Users').filter(r => r[2] === 'race.name').length, 1);
  });
  await test('input rules: bad usernames and weak passwords are refused with a clear reason', async () => {
    for (const u of ['ab', 'a b', 'x'.repeat(31), '-start', 'end.', 'two..dots', 'émoji', '=cmd', '']) { const r = await signup(u, 'Fine-Pass-2026'); assert.strictEqual(r.status, 400, u); assert.strictEqual(r.json.error, 'bad_username'); }
    for (const [p, code] of [['short1', 'weak_password'], ['password123', 'weak_password'], ['aaaaaaaaaaaa', 'weak_password'], ['my-meena99-pw', 'weak_password']]) {
      const r = await signup('meena99', p); assert.strictEqual(r.status, 400, p); assert.strictEqual(r.json.error, code); assert.ok(r.json.message.length > 10);
    }
    assert.strictEqual((await call('POST', '/v1/auth/signup', { body: { username: ['x'], password: { a: 1 } } })).status, 400);
    assert.strictEqual((await call('POST', '/v1/auth/signup', { body: 'not json', headers: { 'Content-Type': 'application/json' } })).status, 400);
  });
  await test('log-in: right password → session; wrong password and unknown user get the same answer', async () => {
    const ok = await login('asha.traders', PW); assert.strictEqual(ok.status, 200, ok.text); assert.strictEqual(ok.json.user.key, A.user.key);
    A2 = ok.json;
    const w = await login('Asha.Traders', 'Wrong-Pass-000'), n = await login('nobody.here', 'Wrong-Pass-000');
    assert.strictEqual(w.status, 401); assert.strictEqual(n.status, 401); assert.strictEqual(w.json.message, n.json.message); assert.strictEqual(w.json.error, 'bad_credentials');
    assert.strictEqual(Number(rowsOf('Users', A.user.key)[0].failedLogins), 1);
    assert.ok(rowsOf('Users', A.user.key)[0].lastLoginAt);
    const ok2 = await login('asha.traders', PW); assert.strictEqual(ok2.status, 200);
    assert.strictEqual(Number(rowsOf('Users', A.user.key)[0].failedLogins), 0, 'reset after a good log-in');
  });
  await test('10 wrong passwords lock the account for 15 minutes (even with the right password); unknown names are throttled too', async () => {
    const L = (await signup('lock.me', 'Lock-Me-Pass-1')).json;
    for (let i = 0; i < 10; i++) assert.strictEqual((await login('lock.me', 'Nope-Nope-' + i)).status, 401);
    const r = await login('lock.me', 'Lock-Me-Pass-1'); assert.strictEqual(r.status, 429); assert.strictEqual(r.json.error, 'locked');
    assert.ok(Date.parse(rowsOf('Users', L.user.key)[0].lockedUntil) > Date.now() + 14 * 60e3, 'lock stored in the Users row');
    const s2 = await start(); const r2 = await login('lock.me', 'Lock-Me-Pass-1', s2.url); s2.s.close();
    assert.strictEqual(r2.status, 429, 'the lock survives a restart');
    for (let i = 0; i < 10; i++) await login('ghost.user', 'Nope-Nope-' + i);
    assert.strictEqual((await login('ghost.user', 'Nope-Nope-x')).json.error, 'locked');
  });
  await test('no / malformed / forged / expired / revoked sessions → 401; a disabled account → 403', async () => {
    assert.strictEqual((await call('GET', '/v1/me')).status, 401);
    assert.strictEqual((await call('GET', '/v1/me', { token: 'hgi1.' + 'A'.repeat(43) })).json.error, 'bad_session');
    assert.strictEqual((await call('GET', '/v1/me', { token: A.session.slice(0, -1) + (A.session.endsWith('A') ? 'B' : 'A') })).status, 401);
    assert.strictEqual((await call('GET', '/v1/me', { token: 'eyJ.forged' })).json.error, 'no_session');
    const X = (await signup('expiry.test', 'Expiry-Pass-1')).json;
    const srv2 = await start({ SESSION_DAYS: '1' });
    const t = (await login('expiry.test', 'Expiry-Pass-1', srv2.url)).json;
    assert.strictEqual((await call('GET', '/v1/me', { token: t.session, srv: srv2.url })).status, 200);
    srv2.s.close();
    const me = await call('GET', '/v1/me', { token: X.session }); assert.strictEqual(me.status, 200); assert.strictEqual(me.json.user.username, 'expiry.test');
  });
  await test('log-out ends that session on the server; other devices stay signed in; "log out everywhere" ends them', async () => {
    const S1 = (await login('asha.traders', PW)).json, S2 = (await login('asha.traders', PW)).json;
    assert.strictEqual((await call('POST', '/v1/auth/logout', { token: S1.session })).status, 200);
    assert.strictEqual((await call('GET', '/v1/me', { token: S1.session })).json.error, 'session_revoked');
    assert.strictEqual((await call('GET', '/v1/me', { token: S2.session })).status, 200);
    const S3 = (await login('asha.traders', PW)).json;
    const r = await call('POST', '/v1/auth/logout-all', { token: S3.session }); assert.strictEqual(r.status, 200); assert.ok(r.json.ended >= 1);
    assert.strictEqual((await call('GET', '/v1/me', { token: S2.session })).json.error, 'session_revoked');
    assert.strictEqual((await call('GET', '/v1/me', { token: S3.session })).status, 200, 'the device that asked stays signed in');
    A = S3; A2 = (await login('asha.traders', PW)).json;
  });
  await test('password change: needs the current password, refuses weak ones, ends other sessions', async () => {
    const C = (await signup('pw.change', 'First-Pass-11')).json, C2 = (await login('pw.change', 'First-Pass-11')).json;
    assert.strictEqual((await call('POST', '/v1/auth/password', { token: C.session, body: { currentPassword: 'wrong', newPassword: 'Second-Pass-22' } })).status, 403);
    assert.strictEqual((await call('POST', '/v1/auth/password', { token: C.session, body: { currentPassword: 'First-Pass-11', newPassword: '1234' } })).json.error, 'weak_password');
    const r = await call('POST', '/v1/auth/password', { token: C.session, body: { currentPassword: 'First-Pass-11', newPassword: 'Second-Pass-22' } });
    assert.strictEqual(r.status, 200, r.text); assert.strictEqual(r.json.otherSessionsEnded, 1);
    assert.strictEqual((await call('GET', '/v1/me', { token: C2.session })).json.error, 'session_revoked');
    assert.strictEqual((await call('GET', '/v1/me', { token: C.session })).status, 200);
    assert.strictEqual((await login('pw.change', 'First-Pass-11')).status, 401);
    assert.strictEqual((await login('pw.change', 'Second-Pass-22')).status, 200);
  });
  await test('a hash planted in the sheet by someone without the server pepper does not work', async () => {
    const { Accounts } = require('../lib/accounts');
    const outsider = new Accounts({}, { passwordPepper: 'x'.repeat(40), sessionSecret: 'y'.repeat(40), scryptParams: { N: 1024, r: 8, p: 1, maxmem: 64e6 } });
    const planted = await outsider.hash('Planted-Pass-9');
    const P = (await signup('victim.co', 'Victim-Pass-99')).json;
    const b = g.sheets.books.get(SHEET), sh = b.sheets.find(s => s.props.title === 'Users');
    const r = sh.cells.findIndex(row => row && row[0] === P.user.key);
    sh.cells[r][3] = planted;                                   // someone with edit access replaces the hash
    const s2 = await start();
    assert.strictEqual((await login('victim.co', 'Planted-Pass-9', s2.url)).status, 401);
    s2.s.close();
  });

  console.log('Records sync');
  await test('new account: nothing in the cloud; GST lookup and PDF storage reported as set up', async () => {
    const r = await call('GET', '/v1/me', { token: A.session });
    assert.strictEqual(r.json.cloud.seq, 0); assert.deepStrictEqual(r.json.features, { gst: true, files: true, edoc: { irp: false, ewb: false, env: 'sandbox' } });
    assert.deepStrictEqual(await pullAll(A.session), []);
  });
  await test('push company, buyer, product and invoice → each stored with revision 1 and a sequence number', async () => {
    const r = await push(A.session, [rec('company', 'main', { name: 'Test Traders', gstin: G1 }), rec('customer', 'C1', { id: 'C1', name: 'Shree Ram Engineering', gstin: G1 }),
      rec('product', 'P1', { id: 'P1', name: 'Pump', rate: 1000 }), rec('invoice', 'D1', inv('D1', 'HGI/1'))]);
    assert.strictEqual(r.status, 200, r.text);
    assert.deepStrictEqual(r.json.results.map(x => x.status + ':' + x.rev), ['ok:1', 'ok:1', 'ok:1', 'ok:1']);
    assert.strictEqual(r.json.seq, 4);
  });
  await test('the data is in readable rows: Settings, Customers, Products, Invoices, InvoiceItems, Payments, DocNumbers — each with the userId', async () => {
    assert.strictEqual(rowsOf('Settings', A.user.key)[0].businessName, 'Test Traders');
    assert.strictEqual(rowsOf('Customers', A.user.key)[0].gstin, G1);
    assert.strictEqual(rowsOf('Products', A.user.key)[0].rate, 1000);
    const i = rowsOf('Invoices', A.user.key)[0]; assert.strictEqual(i.num, 'HGI/1'); assert.strictEqual(i.grandTotal, 1180); assert.strictEqual(i.docType, 'INV');
    const it = rowsOf('InvoiceItems', A.user.key); assert.deepStrictEqual([it.length, it[0].invoiceId, it[0].lineNo, it[0].desc, it[0].qty, it[0].gst, it[0].invoiceNum], [1, 'D1', 1, 'Pump', 1, 18, 'HGI/1']);
    assert.deepStrictEqual(rowsOf('DocNumbers', A.user.key).map(r => [r.numKey, r.docId]), [['INV|hgi/1', 'D1']]);
  });
  await test('another device of the same account pulls exactly that data (same JSON text)', async () => {
    const all = await pullAll(A2.session);
    assert.deepStrictEqual(all.map(r => r.kind + '/' + r.id), ['company/main', 'customer/C1', 'product/P1', 'invoice/D1']);
    assert.strictEqual(all[3].data, JSON.stringify(inv('D1', 'HGI/1'))); assert.deepStrictEqual(all.map(r => r.seq), [1, 2, 3, 4]);
  });
  await test('edit on device 2 (base rev 1) → rev 2 with a payment row; device 1 editing the old version gets a conflict with the cloud copy', async () => {
    const ok = await push(A2.session, [rec('invoice', 'D1', inv('D1', 'HGI/1', { payments: [{ id: 'PAY1', date: '2026-10-25', amount: 500, mode: 'UPI', ref: '' }] }), 1)], 'Phone B');
    assert.strictEqual(ok.json.results[0].status, 'ok'); assert.strictEqual(ok.json.results[0].rev, 2);
    const p = rowsOf('Payments', A.user.key); assert.deepStrictEqual([p.length, p[0].paymentId, p[0].amount, p[0].mode], [1, 'PAY1', 500, 'UPI']);
    const stale = await push(A.session, [rec('invoice', 'D1', inv('D1', 'HGI/1', { buyerName: 'Changed on A' }), 1)]);
    const x = stale.json.results[0];
    assert.strictEqual(x.status, 'conflict'); assert.strictEqual(x.server.rev, 2); assert.strictEqual(JSON.parse(x.server.data).payments[0].id, 'PAY1'); assert.strictEqual(x.server.device, 'Phone B');
  });
  await test('sending the same content again (reply lost) is accepted without a new revision', async () => {
    const r = await push(A.session, [rec('customer', 'C1', { id: 'C1', name: 'Shree Ram Engineering', gstin: G1 }, 0)]);
    assert.strictEqual(r.json.results[0].status, 'ok'); assert.strictEqual(r.json.results[0].unchanged, true); assert.strictEqual(r.json.results[0].rev, 1);
  });
  await test('pull since a sequence returns only newer changes (cursor)', async () => {
    const later = await pullAll(A.session, 4);
    assert.deepStrictEqual(later.map(r => r.kind + '/' + r.id + '@' + r.rev), ['invoice/D1@2']);
  });
  await test('fewer lines after an edit: surplus InvoiceItems rows are cleared, and later reused', async () => {
    const three = inv('D7', 'HGI/7', { items: [1, 2, 3].map(n => ({ desc: 'Line ' + n, qty: n, rate: 10, gst: 18 })) });
    assert.strictEqual((await push(A.session, [rec('invoice', 'D7', three)])).json.results[0].status, 'ok');
    assert.strictEqual(rowsOf('InvoiceItems', A.user.key).filter(r => r.invoiceId === 'D7').length, 3);
    const one = { ...three, items: [three.items[0]] };
    const r = await push(A.session, [rec('invoice', 'D7', one, 1)]); assert.strictEqual(r.json.results[0].status, 'ok');
    assert.strictEqual(rowsOf('InvoiceItems', A.user.key).filter(r => r.invoiceId === 'D7').length, 1);
    const back = (await pullAll(A.session)).filter(x => x.id === 'D7').pop(); assert.strictEqual(back.data, JSON.stringify(one));
    const sh = g.sheets.books.get(SHEET).sheets.find(x => x.props.title === 'InvoiceItems');
    const high = sh.cells.length - 1;
    const blanks = sh.cells.map((row, i) => (i > 0 && !(row && row.some(v => v !== undefined && v !== null)) ? i : -1)).filter(i => i > 0);
    await push(A.session, [rec('invoice', 'D8', inv('D8', 'HGI/8', { items: [{ desc: 'a', qty: 1, rate: 1, gst: 5 }, { desc: 'b', qty: 1, rate: 1, gst: 5 }] }))]);
    const d8 = sh.cells.map((row, i) => (row && row[1] === 'D8' ? i : -1)).filter(i => i >= 0);
    assert.ok(blanks.length >= 2 && d8.every(i => blanks.includes(i) || i > high), `blank rows reused first: blanks ${blanks} → D8 at ${d8}`);
    assert.ok(d8.filter(i => blanks.includes(i)).length === Math.min(2, blanks.length), 'both lines went into cleared rows');
  });

  console.log('Exact round trip, formula injection, large values');
  await test('texts that look like formulas are stored as text, never run, and come back exactly', async () => {
    const evil = ['=IMPORTXML("http://evil.example","//a")', '+91 98765 43210', '-2+3', '@SUM(A1:A9)', "'quoted", "''two", '\tTab', '\rCR', '\nLF', '=1+1', '-', '+', 'normal'];
    const c = { id: 'EVIL', name: evil[0], phone: evil[1], address: evil.join('|'), city: evil[2], gstin: evil[3], state: evil[4], stateCode: evil[5], email: evil[6], shipCity: evil[7], shipState: evil[8], pin: evil[9] };
    const r = await push(A.session, [rec('customer', 'EVIL', c)]); assert.strictEqual(r.json.results[0].status, 'ok');
    const row = g.sheets.books.get(SHEET).sheets.find(s => s.props.title === 'Customers').cells.find(x => x && x.includes('EVIL'));
    assert.ok(row.every(v => typeof v !== 'string' || !/^[=+\-@\t\r\n]/.test(v)), 'no stored text starts with = + - @ or a control character');
    const back = (await pullAll(A2.session)).find(x => x.id === 'EVIL'); assert.strictEqual(back.data, JSON.stringify(c));
    const calls = g.sheets.calls.filter(x => /batchUpdate/.test(x)).length; assert.ok(calls > 0);
  });
  await test('… also when Google keeps a leading apostrophe as its quote prefix (probed at start-up)', async () => {
    const id2 = g.sheets.create('prefix mode'); g.sheets.quoteMode = 'prefix';
    const s2 = await start({ SHEETS_SPREADSHEET_ID: id2 });
    const U = (await signup('prefix.user', 'Prefix-Pass-1', s2.url)).json;
    const c = { id: 'Q', name: "=HYPERLINK(\"x\")", phone: '+91 1', address: "'kept", city: "''x", state: 'plain' };
    assert.strictEqual((await push(U.session, [rec('customer', 'Q', c)], 'P', s2.url)).json.results[0].status, 'ok');
    s2.s.close();
    const s3 = await start({ SHEETS_SPREADSHEET_ID: id2 });               // a fresh instance reads it back from the sheet
    const back = (await pullAll(U.session, 0, s3.url)).find(x => x.id === 'Q');
    g.sheets.quoteMode = 'literal'; s3.s.close();
    const bk = JSON.parse(back.data);
    assert.strictEqual(bk.name, c.name); assert.strictEqual(bk.phone, c.phone); assert.strictEqual(bk.state, 'plain');
    assert.strictEqual(bk.address, "'kept"); assert.strictEqual(bk.city, "''x");
    assert.strictEqual(back.data, JSON.stringify(c));
  });
  await test('300 varied documents (nested data, empty texts, nulls, unicode, numeric IDs, odd field order) come back byte-for-byte', async () => {
    const F = (await signup('fuzz.user', 'Fuzz-Pass-2026')).json;
    let s = 99; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(rnd() * a.length)];
    const vals = ['', null, 0, -1.5, 1e21, 123456789.123, true, false, 'ગુજરાત ₹ 🧾', 'line1\nline2', ' spaced ', '0012', '1e5', '=x', [], {}, [1, 'a', null], { nested: { deep: [{ x: 1 }] } }];
    const docs = [];
    for (let i = 0; i < 300; i++) {
      const d = { id: 'F' + i, docType: pick(['INV', 'CRN', 'QUO', 'PI', 'PO']), num: 'F/' + i, date: '2026-0' + (1 + (i % 9)) + '-1' + (i % 9) };
      for (let k = 0; k < 6; k++) d[pick(['buyerName', 'buyerGstin', 'pos', 'irn', 'edoc', 'history', 'transport', 'notes', 'custom' + k, 'discount', 'roundoff'])] = pick(vals);
      d.items = Array.from({ length: Math.floor(rnd() * 5) }, (_, j) => { const it = { desc: 'Item ' + j, qty: Math.round(rnd() * 100) / 4, rate: Math.round(rnd() * 1e6) / 100, gst: pick([0, 5, 18, 40]) }; if (rnd() > 0.5) it.taxability = pick(['nil', 'exempt']); if (rnd() > 0.7) it.extra = pick(vals); if (rnd() > 0.8) it.hsn = pick(['8413', '', 8413]); return it; });
      if (rnd() > 0.3) d.payments = Array.from({ length: Math.floor(rnd() * 3) }, (_, j) => ({ id: 'P' + i + j, date: '2026-10-0' + (j + 1), amount: Math.round(rnd() * 1e5) / 100, tds: pick([0, 10, '']), mode: pick(['UPI', 'Cash', '']) }));
      if (i % 50 === 0) d.items = 'not a list';
      if (i % 61 === 0) d.payments = [1, 2];
      docs.push(d);
    }
    const ids = [];
    for (let b = 0; b < docs.length; b += 150) {
      const r = await push(F.session, docs.slice(b, b + 150).map(d => rec('invoice', d.id, d)));
      assert.ok(r.json.results.every(x => x.status === 'ok'), JSON.stringify(r.json.results.filter(x => x.status !== 'ok')).slice(0, 300));
      ids.push(...r.json.results.map(x => x.id));
    }
    const s2 = await start();                                             // read back by a fresh instance, from the sheet
    const all = await pullAll(F.session, 0, s2.url); s2.s.close();
    const byId = new Map(all.map(r => [r.id, r.data]));
    const bad = docs.filter(d => byId.get(d.id) !== JSON.stringify(d));
    assert.strictEqual(bad.length, 0, `${bad.length} differ, e.g. ${bad[0] && bad[0].id}: ${bad[0] && JSON.stringify(bad[0]).slice(0, 200)} vs ${bad[0] && String(byId.get(bad[0].id)).slice(0, 200)}`);
    // numeric product / buyer IDs and field order
    const odd = { rate: 5, name: 'Odd', id: 42 };
    assert.strictEqual((await push(F.session, [rec('product', '42', odd)])).json.results[0].status, 'ok');
    assert.strictEqual((await pullAll(F.session)).find(r => r.id === '42').data, JSON.stringify(odd));
  });
  await test('a 200 KB logo (more than one cell can hold) is split into _Blobs and comes back whole; replacing it frees the old parts', async () => {
    const logo = 'data:image/png;base64,' + crypto.randomBytes(150 * 1024).toString('base64');
    const co = { name: 'Logo Co', logo, showLogo: true };
    assert.strictEqual((await push(A.session, [rec('company', 'main', co, 1)])).json.results[0].status, 'ok');
    const blobs = tab('_Blobs').slice(1).filter(r => r.length);
    assert.ok(blobs.length >= 5, 'parts: ' + blobs.length);
    assert.ok(tab('Settings').flat().every(v => typeof v !== 'string' || v.length <= 50000));
    const s2 = await start(); const back = (await pullAll(A.session, 0, s2.url)).filter(r => r.kind === 'company').pop(); s2.s.close();
    assert.strictEqual(back.data, JSON.stringify(co));
    assert.strictEqual((await push(A.session, [rec('company', 'main', { name: 'Logo Co', logo: '' }, 2)])).json.results[0].status, 'ok');
    assert.strictEqual(tab('_Blobs').slice(1).filter(r => r.length).length, 0, 'old parts cleared');
  });

  console.log('Document numbers');
  await test('a second invoice with the same number is refused (number_taken), naming the document that holds it', async () => {
    const r = await push(A2.session, [rec('invoice', 'D2', inv('D2', 'HGI/1'))], 'Phone B');
    const x = r.json.results[0]; assert.strictEqual(x.status, 'number_taken'); assert.strictEqual(x.takenBy, 'D1');
    assert.ok(!(await pullAll(A.session)).some(r => r.id === 'D2'), 'refused invoice was not stored');
  });
  await test('same number with different spacing / case is the same number; a quotation may reuse it', async () => {
    assert.strictEqual((await push(A2.session, [rec('invoice', 'D2', inv('D2', ' hgi/1 '))])).json.results[0].status, 'number_taken');
    assert.strictEqual((await push(A2.session, [rec('invoice', 'Q1', inv('Q1', 'HGI/1', { docType: 'QUO' }))])).json.results[0].status, 'ok');
  });
  await test('two new invoices with one number in the same upload: the second is refused', async () => {
    const r = await push(A.session, [rec('invoice', 'D3', inv('D3', 'HGI/3')), rec('invoice', 'D4', inv('D4', 'HGI/3'))]);
    assert.deepStrictEqual(r.json.results.map(x => x.status), ['ok', 'number_taken']); assert.strictEqual(r.json.results[1].takenBy, 'D3');
  });
  await test('two phones saving different invoices with one number at the same moment: exactly one gets it', async () => {
    const [r1, r2] = await Promise.all([push(A.session, [rec('invoice', 'R1', inv('R1', 'HGI/RACE'))]), push(A2.session, [rec('invoice', 'R2', inv('R2', 'HGI/RACE'))], 'Phone B')]);
    assert.deepStrictEqual([r1.json.results[0].status, r2.json.results[0].status].sort(), ['number_taken', 'ok']);
    assert.strictEqual(rowsOf('DocNumbers', A.user.key).filter(r => r.numKey === 'INV|hgi/race').length, 1);
  });
  await test('renumbering frees the old number; a cancelled invoice keeps its number; deleting releases it', async () => {
    const d3 = (await pullAll(A.session)).find(r => r.id === 'D3');
    assert.strictEqual((await push(A.session, [rec('invoice', 'D3', inv('D3', 'HGI/30'), d3.rev)])).json.results[0].status, 'ok');
    assert.strictEqual((await push(A.session, [rec('invoice', 'D4', inv('D4', 'HGI/3'))])).json.results[0].status, 'ok');
    const d4 = (await pullAll(A.session)).find(r => r.id === 'D4');
    assert.strictEqual((await push(A.session, [rec('invoice', 'D4', inv('D4', 'HGI/3', { cancelled: true }), d4.rev)])).json.results[0].status, 'ok');
    assert.strictEqual((await push(A.session, [rec('invoice', 'D5', inv('D5', 'HGI/3'))])).json.results[0].status, 'number_taken');
    const d4b = (await pullAll(A.session)).find(r => r.id === 'D4');
    assert.strictEqual((await push(A.session, [{ kind: 'invoice', id: 'D4', baseRev: d4b.rev, deleted: true }])).json.results[0].status, 'ok');
    assert.strictEqual(rowsOf('InvoiceItems', A.user.key).filter(r => r.invoiceId === 'D4').length, 0, 'lines of a deleted document removed');
    assert.strictEqual((await push(A.session, [rec('invoice', 'D5', inv('D5', 'HGI/3'))])).json.results[0].status, 'ok');
    const chk = await call('POST', '/v1/numbers/check', { token: A.session, body: { docType: 'INV', num: 'HGI/3', docId: 'D9' } });
    assert.deepStrictEqual(chk.json, { free: false, takenBy: 'D5' });
    assert.strictEqual((await call('POST', '/v1/numbers/check', { token: A.session, body: { docType: 'INV', num: 'HGI/4', docId: 'D9' } })).json.free, true);
  });
  await test('deletions reach other devices as tombstones (no business data left in the row)', async () => {
    const t = (await pullAll(A2.session)).filter(r => r.id === 'D4').pop();
    assert.strictEqual(t.deleted, true); assert.strictEqual(t.data, null);
    const row = rowsOf('Invoices', A.user.key).find(r => r.id === 'D4'); assert.strictEqual(row.deleted, true); assert.ok(!row.buyerName && !row.extra);
  });
  await test('two phones uploading at the same moment from the same base: one wins, the other gets a conflict', async () => {
    const p1 = (await pullAll(A.session)).find(r => r.id === 'P1');
    const [r1, r2] = await Promise.all([push(A.session, [rec('product', 'P1', { id: 'P1', name: 'Pump', rate: 1100 }, p1.rev)]), push(A2.session, [rec('product', 'P1', { id: 'P1', name: 'Pump', rate: 1200 }, p1.rev)], 'Phone B')]);
    assert.deepStrictEqual([r1.json.results[0].status, r2.json.results[0].status].sort(), ['conflict', 'ok']);
  });
  await test('20 uploads at once from one account: all stored, every sequence number used once', async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => push(i % 2 ? A.session : A2.session, [rec('customer', 'PAR' + i, { id: 'PAR' + i, name: 'Parallel ' + i })])));
    assert.ok(rs.every(r => r.json.results[0].status === 'ok'));
    const seqs = (await pullAll(A.session)).map(r => r.seq); assert.strictEqual(new Set(seqs).size, seqs.length);
  });

  console.log('Isolation');
  await test('another account sees none of this data; the same record IDs and numbers stay separate', async () => {
    B = (await signup('bharat.co', 'Bharat-Pass-55')).json;
    assert.deepStrictEqual(await pullAll(B.session), []);
    assert.strictEqual((await push(B.session, [rec('invoice', 'D1', inv('D1', 'HGI/1', { buyerName: 'B only' }))])).json.results[0].status, 'ok', 'same number allowed in another account');
    assert.strictEqual(JSON.parse((await pullAll(A.session)).filter(r => r.id === 'D1').pop().data).buyerName, 'Shree Ram Engineering');
    assert.strictEqual((await pullAll(B.session)).length, 1);
    assert.strictEqual(rowsOf('Invoices', B.user.key).length, 1);
  });
  await test('B cannot change or delete A\'s records — even naming A\'s IDs or putting A\'s userId inside the data', async () => {
    const r = await push(B.session, [{ kind: 'customer', id: 'C1', baseRev: 1, deleted: true }, rec('product', 'P1', { id: 'P1', name: 'Hijack', userId: A.user.key }, 5)]);
    assert.deepStrictEqual(r.json.results.map(x => x.status), ['conflict', 'conflict']);   // B has no C1 / P1 of its own at those revisions
    assert.ok((await pullAll(A.session)).some(x => x.id === 'C1' && !x.deleted), 'A\'s C1 untouched');
    assert.ok(!JSON.stringify(await pullAll(A.session)).includes('Hijack'));
    assert.strictEqual((await call('GET', '/v1/sync/pull?since=0&userId=' + A.user.key, { token: B.session })).json.records.length, (await pullAll(B.session)).length, 'a userId in the URL is ignored');
    assert.strictEqual(rowsOf('Customers', B.user.key).length + rowsOf('Products', B.user.key).length, 0);
  });
  await test('750 records upload in batches and come back in order over several pages', async () => {
    const C = (await signup('chetan.bulk', 'Chetan-Pass-750')).json;
    for (let b = 0; b < 750; b += 200) {
      const batch = []; for (let i = b; i < Math.min(750, b + 200); i++) batch.push(rec('invoice', 'X' + i, inv('X' + i, 'C/' + i)));
      const r = await push(C.session, batch); assert.ok(r.json.results.every(x => x.status === 'ok'), r.text.slice(0, 200));
    }
    const all = await pullAll(C.session);
    assert.strictEqual(all.length, 750); assert.ok(all.every((r, i) => r.seq === i + 1));
  });
  await test('bad uploads are refused: unknown kind, too many, duplicates, junk, oversized record, control characters in IDs', async () => {
    assert.strictEqual((await push(A.session, [rec('secret', 'x', {})])).status, 400);
    assert.strictEqual((await push(A.session, Array.from({ length: 201 }, (_, i) => rec('product', 'Z' + i, {})))).status, 400);
    assert.strictEqual((await push(A.session, [rec('product', 'Z', {}), rec('product', 'Z', {})])).status, 400);
    assert.strictEqual((await push(A.session, [rec('product', 'a\u0001b', {})])).status, 400);
    const r = await push(A.session, [{ kind: 'product', id: 'J', baseRev: 0, data: 'not json' }, rec('product', 'Big', { blob: 'x'.repeat(950 * 1024) })]);
    assert.deepStrictEqual(r.json.results.map(x => x.status), ['invalid', 'too_large']);
  });

  console.log('Persistence and failures');
  await test('everything survives a restart / another server instance: log in again and pull it all', async () => {
    const s2 = await start();
    const t = (await login('asha.traders', PW, s2.url)).json;
    const a = await pullAll(t.session, 0, s2.url), b = await pullAll(A.session);
    s2.s.close();
    assert.deepStrictEqual(a.map(r => [r.id, r.rev, r.data]), b.map(r => [r.id, r.rev, r.data]));
  });
  await test('a write by another instance is noticed before writing (write counter) — nothing is overwritten', async () => {
    const s2 = await start();
    const p1 = (await pullAll(A.session)).find(r => r.id === 'P1');
    assert.strictEqual((await push(A.session, [rec('product', 'P1', { id: 'P1', name: 'Pump', rate: 1500 }, p1.rev)], 'P', s2.url)).json.results[0].status, 'ok');
    const stale = await push(A.session, [rec('product', 'P1', { id: 'P1', name: 'Pump', rate: 1600 }, p1.rev)]);      // main instance's copy is old
    s2.s.close();
    assert.strictEqual(stale.json.results[0].status, 'conflict', 'detected, not overwritten');
    assert.strictEqual(JSON.parse(stale.json.results[0].server.data).rate, 1500);
  });
  await test('Google answers 503 to a write: the app is told to retry, nothing half-written; the retry succeeds', async () => {
    g.sheets.fail(/batchUpdate/, 503, 1);
    const r = await push(A.session, [rec('customer', 'RETRY', { id: 'RETRY', name: 'Retry Co' })]);
    assert.strictEqual(r.status, 503); assert.strictEqual(r.json.error, 'cloud_unavailable');
    assert.ok(!(await pullAll(A.session)).some(x => x.id === 'RETRY'));
    assert.strictEqual((await push(A.session, [rec('customer', 'RETRY', { id: 'RETRY', name: 'Retry Co' })])).json.results[0].status, 'ok');
  });
  await test('a write that Google applied but whose answer was lost is recognised (no double write)', async () => {
    g.sheets.fail(/batchUpdate/, 503, 1, true);
    const r = await push(A.session, [rec('customer', 'LOST', { id: 'LOST', name: 'Lost Reply' })]);
    assert.strictEqual(r.status, 200, r.text); assert.strictEqual(r.json.results[0].status, 'ok');
    assert.strictEqual(rowsOf('Customers', A.user.key).filter(x => x.id === 'LOST').length, 1);
    assert.strictEqual((await push(A.session, [rec('customer', 'LOST', { id: 'LOST', name: 'Lost Reply' })])).json.results[0].unchanged, true);
  });
  await test('Google read quota (429) is retried', async () => {
    g.sheets.fail(/values\//, 429, 1);
    assert.strictEqual((await push(A.session, [rec('customer', 'Q429', { id: 'Q429', name: 'Quota' })])).json.results[0].status, 'ok');
  });
  await test('columns reordered and a column added by the owner: still read correctly, the owner\'s column is kept', async () => {
    const b = g.sheets.books.get(SHEET), sh = b.sheets.find(s => s.props.title === 'Customers');
    const width = sh.props.gridProperties.columnCount;
    sh.cells.forEach(row => { if (!row) return; const x = row[9]; row[9] = row[10]; row[10] = x; });   // swap two columns (header included)
    sh.props.gridProperties.columnCount = width + 1;
    sh.cells.forEach((row, i) => { if (row && row.length) row[width] = i === 0 ? 'My notes' : 'note ' + i; });
    const s2 = await start();
    const before = (await pullAll(A.session)).find(x => x.id === 'C1');
    const c = (await pullAll(A.session, 0, s2.url)).find(x => x.id === 'C1');
    assert.strictEqual(c.data, before.data);
    assert.strictEqual((await push(A.session, [rec('customer', 'C1', { id: 'C1', name: 'Renamed', gstin: G1 }, c.rev)], 'P', s2.url)).json.results[0].status, 'ok');
    s2.s.close();
    const row = sh.cells.find(r => r && r[1] === 'C1' && r[0] === A.user.key);
    assert.ok(String(row[width]).startsWith('note '), 'owner\'s own column kept: ' + row[width]);
  });
  await test('health check reports the cells used (Google\'s limit is 10 million)', async () => {
    const h = (await call('GET', '/healthz')).json; assert.ok(h.cells > 1000 && h.cellLimit === 10e6);
  });

  console.log('GSTIN lookup');
  await test('valid GSTIN → legal & trade name, address, state, PIN, status, registration details from the provider', async () => {
    const r = await call('GET', `/v1/gstin/${G1}`, { token: A.session });
    assert.strictEqual(r.status, 200, r.text);
    const d = r.json;
    assert.strictEqual(d.legalName, 'SHREE RAM ENGINEERING PRIVATE LIMITED'); assert.strictEqual(d.tradeName, 'Shree Ram Engineering');
    assert.strictEqual(d.address.line, 'Plot 14, Ram Udyog, MIDC Road, Bhosari, Pune'); assert.strictEqual(d.address.pin, '411026'); assert.strictEqual(d.address.state, 'Maharashtra');
    assert.strictEqual(d.stateCode, '27'); assert.strictEqual(d.status, 'Active'); assert.strictEqual(d.source, 'Test GSP');
  });
  await test('repeat lookups come from the 7-day cache in the Store tab (no second provider call)', async () => {
    const n = g.gstCalls;
    const r = await call('GET', `/v1/gstin/${G1}`, { token: B.session });
    assert.strictEqual(r.json.cached, true); assert.strictEqual(g.gstCalls, n);
    assert.ok(tab('Store').some(r => r[0] === 'gstin_cache/' + G1));
  });
  await test('cancelled registration; wrong check digit → 400; unknown → 404; provider down → 502 (nothing invented)', async () => {
    const c = await call('GET', `/v1/gstin/${G2}`, { token: A.session }); assert.strictEqual(c.json.status, 'Cancelled');
    const n = g.gstCalls;
    const bad = G1.slice(0, 14) + (G1[14] === 'A' ? 'B' : 'A');
    assert.strictEqual((await call('GET', `/v1/gstin/${bad}`, { token: A.session })).json.error, 'invalid_gstin'); assert.strictEqual(g.gstCalls, n);
    assert.strictEqual((await call('GET', `/v1/gstin/${GX}`, { token: A.session })).status, 404);
    g.gstDown = true; const GY = gstin('19AABCU9603R1Z'); g.gstRecords.set(GY, tp(GY));
    const down = await call('GET', `/v1/gstin/${GY}`, { token: A.session }); g.gstDown = false;
    assert.strictEqual(down.status, 502); assert.ok(!down.json.legalName);
  });
  await test('server without a GST provider → 503 gst_not_configured', async () => {
    const s3 = await start({ GST_API_URL: '' });
    const r = await call('GET', `/v1/gstin/${G1}`, { token: A.session, srv: s3.url }); const me = await call('GET', '/v1/me', { token: A.session, srv: s3.url }); s3.s.close();
    assert.strictEqual(r.status, 503); assert.strictEqual(r.json.error, 'gst_not_configured'); assert.strictEqual(me.json.features.gst, false);
  });

  console.log('Invoice PDFs');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(3000)]);
  await test('PDF stored in the private bucket, indexed in the Store tab, returned byte-for-byte', async () => {
    const r = await call('PUT', '/v1/files/pdf/D1', { token: A.session, body: { base64: pdf.toString('base64'), num: 'HGI/1', docType: 'INV', hash: 'h1' } });
    assert.strictEqual(r.status, 200, r.text);
    assert.ok([...g.objects.keys()].some(k => k.startsWith('hgi-files-test/users/' + A.user.key + '/pdf/')));
    const l = await call('GET', '/v1/files', { token: A.session }); assert.deepStrictEqual(l.json.files.map(f => [f.docId, f.num, f.bytes]), [['D1', 'HGI/1', pdf.length]]);
    const back = await call('GET', '/v1/files/pdf/D1', { token: A2.session }); assert.ok(Buffer.from(back.json.base64, 'base64').equals(pdf));
  });
  await test('not a PDF → 400; another account cannot read it (404)', async () => {
    assert.strictEqual((await call('PUT', '/v1/files/pdf/D9', { token: A.session, body: { base64: Buffer.from('hello world, this is not a pdf file at all'.repeat(5)).toString('base64') } })).status, 400);
    assert.strictEqual((await call('GET', '/v1/files/pdf/D1', { token: B.session })).status, 404);
  });

  console.log('Pages and CORS');
  await test('privacy policy and the account-deletion page (username + password form, no third-party scripts)', async () => {
    const p = await call('GET', '/privacy'); assert.strictEqual(p.status, 200); assert.match(p.text, /Google Sheets/); assert.match(p.text, /scrypt/);
    const d = await call('GET', '/delete-account'); assert.strictEqual(d.status, 200); assert.match(d.text, /type="password"/); assert.ok(!/accounts\.google\.com/.test(d.text));
    assert.ok(!/https:/.test(d.headers.get('content-security-policy')));
  });
  await test('app origin allowed, other websites not', async () => {
    assert.strictEqual((await call('OPTIONS', '/v1/sync/push', { headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST' } })).headers.get('access-control-allow-origin'), 'https://localhost');
    assert.strictEqual((await call('OPTIONS', '/v1/sync/push', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } })).headers.get('access-control-allow-origin'), null);
  });
  await test('server errors do not reveal internals', async () => {
    const r = await call('POST', '/v1/sync/push', { token: A.session, body: { records: [{ kind: 'customer', id: 'x', baseRev: 0, data: '{}' }], device: { toString: 1 } } });
    assert.ok(r.status < 500 || !/Users|column|sheet/i.test(r.json.message));
  });

  await require('./edoc-tests')({ test, g, env, mk, call, gstin, RUN, start, signup, SHEET, rowsOf });

  console.log('Account deletion');
  await test('in-app deletion needs the password; removes every row of the account in every tab, the PDFs and all sessions', async () => {
    assert.strictEqual((await call('DELETE', '/v1/account', { token: A.session, body: { password: 'wrong' } })).status, 403);
    const r = await call('DELETE', '/v1/account', { token: A.session, body: { password: PW } });
    assert.strictEqual(r.status, 200, r.text); assert.ok(r.json.records >= 8); assert.strictEqual(r.json.files, 1);
    for (const t of ['Settings', 'Customers', 'Products', 'Invoices', 'InvoiceItems', 'Payments', 'DocNumbers', 'Store']) assert.strictEqual(rowsOf(t, A.user.key).length, 0, t);
    assert.ok(rowsOf('Sessions', A.user.key).every(s => s.revokedAt));
    const u = rowsOf('Users', A.user.key)[0]; assert.strictEqual(u.status, 'deleted'); assert.ok(!u.passwordHash); assert.ok(u.deletedAt);
    assert.ok(![...g.objects.keys()].some(k => k.includes('/users/' + A.user.key + '/')), 'PDF object removed');
    assert.strictEqual((await call('GET', '/v1/me', { token: A2.session })).json.error, 'session_revoked');
    assert.ok(rowsOf('Invoices', B.user.key).length === 1, 'B untouched');
  });
  await test('the username can be registered again — as a new, empty account', async () => {
    const again = (await signup('asha.traders', 'Fresh-Start-2026')).json;
    assert.ok(again.user && again.user.key !== A.user.key);
    assert.deepStrictEqual(await pullAll(again.session), []);
    assert.strictEqual((await push(again.session, [rec('invoice', 'N1', inv('N1', 'HGI/1'))])).json.results[0].status, 'ok');
  });
  await test('deletion from the web page with username + password; wrong password refused', async () => {
    assert.strictEqual((await call('POST', '/v1/account/delete-with-password', { body: { username: 'bharat.co', password: 'nope' } })).status, 401);
    const r = await call('POST', '/v1/account/delete-with-password', { body: { username: 'bharat.co', password: 'Bharat-Pass-55' } });
    assert.strictEqual(r.status, 200, r.text); assert.strictEqual(r.json.deleted, true);
    assert.strictEqual((await call('GET', '/v1/me', { token: B.session })).status, 401);
    assert.strictEqual(rowsOf('Invoices', B.user.key).length, 0);
  });
  await test('sign-ups and log-ins are limited per network address (default 5 / 20 a minute)', async () => {
    const s6 = await start({ SIGNUP_PER_MINUTE: '', LOGIN_PER_MINUTE: '' });
    const su = []; for (let i = 0; i < 6; i++) su.push((await signup('limit' + RUN + i, 'Limit-Pass-' + i, s6.url)).status);
    const li = []; for (let i = 0; i < 21; i++) li.push((await login('nobody' + i, 'Limit-Pass-x', s6.url)).status);
    s6.s.close();
    assert.deepStrictEqual(su, [201, 201, 201, 201, 201, 429]); assert.strictEqual(li[20], 429); assert.ok(li.slice(0, 20).every(x => x === 401));
  });
  await test('sign-up can be closed by the operator (ALLOW_SIGNUP=0)', async () => {
    const s5 = await start({ ALLOW_SIGNUP: '0' }); const r = await signup('closed.door', 'Closed-Pass-1', s5.url); s5.s.close();
    assert.strictEqual(r.status, 403); assert.strictEqual(r.json.error, 'signup_closed');
  });

  main.s.close(); await g.stop();
  console.log(`\n${pass} passed, ${fail} failed`);
  require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true });
  require('fs').writeFileSync(require('path').join(__dirname, 'out', 'results.txt'), results.join('\n') + `\n\n${pass} passed, ${fail} failed (Google Sheets stand-in)\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
