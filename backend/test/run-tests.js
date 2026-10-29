#!/usr/bin/env node
'use strict';
/* Sync service tests against the in-memory Google stand-in (test/fake-google.js). Run: npm test */
const assert = require('assert');
const crypto = require('crypto');
const { FakeGoogle, rsa } = require('./fake-google');
const { createServer } = require('../server');
const config = require('../lib/config');

const CLIENT = 'test-web-client.apps.googleusercontent.com';
const FOLDER = 'folder-hgi-customers';
let pass = 0, fail = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); pass++; results.push('PASS ' + name); console.log('  ✓ ' + name); }
  catch (e) { fail++; results.push('FAIL ' + name + ' — ' + e.message); console.log('  ✗ ' + name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      ')); }
}

function book(n = 3, extra = {}) {
  const invoices = [];
  for (let i = 1; i <= n; i++) invoices.push({ id: 'INV' + i, docType: 'INV', num: 'HGI/' + i, date: '2026-10-0' + ((i % 9) + 1), buyerName: 'Buyer ' + i, buyerGstin: '24ABCDE1234F1Z5',
    pos: '24', taxable: 1000 * i, cgst: 90 * i, sgst: 90 * i, igst: 0, grandTotal: 1180 * i, items: [{ desc: 'Pump ' + i, hsn: '8413', gst: 18, qty: i, unit: 'NOS', rate: 1000 }],
    payments: i % 2 ? [{ id: 'P' + i, date: '2026-10-10', amount: 500, tds: 0, mode: 'UPI', ref: 'UTR' + i }] : [] });
  return { credentials: {}, company: { name: 'Test Traders', gstin: '24ABCDE1234F1Z5', logo: '' }, products: [{ id: 'PR1', name: 'Pump', hsn: '8413', rate: 1000, gst: 18 }],
    customers: [{ id: 'C1', name: 'Buyer 1', gstin: '24ABCDE1234F1Z5' }], invoices, ui: { rev: 7 }, ...extra };
}

(async () => {
  const g = await new FakeGoogle().start();
  const env = { PORT: '0', GOOGLE_CLIENT_IDS: CLIENT, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), DRIVE_FOLDER_ID: FOLDER, DRIVE_AUTH: 'metadata', SHARE_WITH: 'owner@hariguru.com', SUPPORT_EMAIL: 'info@hariguru.com' };
  const cfg = config.load(env);
  cfg.endpoints = g.endpoints();
  const server = createServer(cfg);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { body, token, headers = {} } = {}) => {
    const r = await fetch(base + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  const signIn = async (claims) => (await call('POST', '/v1/auth/google', { body: { idToken: g.idToken(claims) } }));

  console.log('Configuration');
  await test('config refuses test sign-in and Google overrides on Cloud Run', () => {
    assert.throws(() => config.load({ ...env, K_SERVICE: 'hgi-sync', HGI_ALLOW_TEST_LOGIN: '1' }), /not allowed on Cloud Run/);
    assert.throws(() => config.load({ ...env, K_SERVICE: 'hgi-sync', GOOGLE_CERTS_URL: 'http://evil' }), /not allowed on Cloud Run/);
  });
  await test('config requires a strong session secret, client ID and folder', () => {
    assert.throws(() => config.load({ ...env, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
    assert.throws(() => config.load({ ...env, GOOGLE_CLIENT_IDS: '' }), /GOOGLE_CLIENT_IDS/);
    assert.throws(() => config.load({ ...env, DRIVE_FOLDER_ID: '' }), /DRIVE_FOLDER_ID/);
    assert.throws(() => config.load({ ...env, DRIVE_AUTH: 'owner-oauth' }), /OWNER_REFRESH_TOKEN/);
  });

  console.log('Pages');
  await test('privacy policy, deletion page and health check are served', async () => {
    const p = await call('GET', '/privacy'); assert.strictEqual(p.status, 200); assert.match(p.text, /HGI staff can open your spreadsheet/);
    const d = await call('GET', '/delete-account'); assert.strictEqual(d.status, 200); assert.match(d.text, new RegExp(CLIENT.replace(/\./g, '\\.'))); assert.match(d.text, /info@hariguru\.com/);
    assert.strictEqual((await call('GET', '/healthz')).json.ok, true);
  });

  console.log('Sign in with Google');
  let A, B;
  await test('valid Google ID token → app session (no Google token returned)', async () => {
    const r = await signIn({ sub: '1001', email: 'Asha@Gmail.com', name: 'Asha' });
    assert.strictEqual(r.status, 200, r.text);
    assert.ok(r.json.session && r.json.user.key && r.json.user.email === 'asha@gmail.com');
    assert.ok(!/1001/.test(r.json.user.key), 'raw Google ID must not be the data key');
    A = r.json;
  });
  await test('token for another app (audience) is refused', async () => { const r = await signIn({ sub: '1', email: 'x@gmail.com', aud: 'other.apps.googleusercontent.com' }); assert.strictEqual(r.status, 401); });
  await test('expired token is refused', async () => { const r = await signIn({ sub: '1', email: 'x@gmail.com', exp: Math.floor(Date.now() / 1000) - 600 }); assert.strictEqual(r.status, 401); assert.strictEqual(r.json.error, 'token_expired'); });
  await test('token not issued by Google is refused', async () => { const r = await signIn({ sub: '1', email: 'x@gmail.com', iss: 'https://evil.example' }); assert.strictEqual(r.status, 401); });
  await test('token signed by a different key is refused', async () => {
    const r = await call('POST', '/v1/auth/google', { body: { idToken: g.idToken({ sub: '1', email: 'x@gmail.com' }, { privateKey: rsa().privateKey }) } });
    assert.strictEqual(r.status, 401); assert.match(r.json.message, /signature/);
  });
  await test('token with unknown key id is refused', async () => { const r = await call('POST', '/v1/auth/google', { body: { idToken: g.idToken({ sub: '1', email: 'x@gmail.com' }, { kid: 'nope' }) } }); assert.strictEqual(r.status, 401); });
  await test('unverified e-mail is refused', async () => { const r = await signIn({ sub: '1', email: 'x@gmail.com', email_verified: false }); assert.strictEqual(r.status, 403); });
  await test('garbage token is refused', async () => { const r = await call('POST', '/v1/auth/google', { body: { idToken: 'abc.def' } }); assert.strictEqual(r.status, 401); });
  await test('test sign-in endpoint does not exist unless enabled', async () => { const r = await call('POST', '/v1/auth/test', { body: { email: 'a@example.com' } }); assert.strictEqual(r.status, 404); });

  console.log('Sessions');
  await test('no session / tampered session / expired session → 401', async () => {
    assert.strictEqual((await call('GET', '/v1/sync/meta')).status, 401);
    const [b, s] = A.session.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url')), sub: '2002' })).toString('base64url') + '.' + s;
    assert.strictEqual((await call('GET', '/v1/sync/meta', { token: forged })).status, 401);
    const { Sessions } = require('../lib/identity');
    const old = new Sessions(cfg).sign({ v: 1, sub: '1001', email: 'asha@gmail.com', iat: Date.now() - 2e9, exp: Date.now() - 1000 });
    const r = await call('GET', '/v1/sync/meta', { token: old }); assert.strictEqual(r.status, 401); assert.strictEqual(r.json.error, 'session_expired');
  });
  await test('session close to expiry is renewed (X-HGI-Session header)', async () => {
    const { Sessions } = require('../lib/identity');
    const soon = new Sessions(cfg).sign({ v: 1, sub: '1001', email: 'asha@gmail.com', iat: Date.now(), exp: Date.now() + 5 * 86400e3 });
    const r = await call('GET', '/v1/sync/meta', { token: soon });
    assert.strictEqual(r.status, 200); assert.ok(r.headers.get('x-hgi-session'));
  });

  console.log('Sync');
  const dataA1 = JSON.stringify(book(3));
  await test('new account: empty cloud, nothing to restore', async () => {
    const r = await call('GET', '/v1/sync', { token: A.session });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.cloud.version, 0); assert.strictEqual(r.json.data, null);
  });
  await test('first save creates the user\'s spreadsheet in the company folder', async () => {
    const r = await call('PUT', '/v1/sync', { token: A.session, body: { baseVersion: 0, clientRev: 7, device: 'Pixel 7', data: dataA1 } });
    assert.strictEqual(r.status, 200, r.text); assert.strictEqual(r.json.cloud.version, 1); assert.strictEqual(r.json.cloud.readable, true);
    const f = g.spreadsheetOf(A.user.key);
    assert.ok(f, 'spreadsheet exists'); assert.deepStrictEqual(f.parents, [FOLDER]); assert.match(f.name, /asha@gmail\.com/);
    assert.deepStrictEqual(f.permissions.map(p => p.emailAddress), ['owner@hariguru.com']);
    for (const t of ['_sync', '_data_a', '_data_b']) assert.strictEqual(g.tab(f.id, t).hidden, true, t + ' hidden');
    assert.ok(g.valueInputOptions.every(v => v === 'RAW'), 'values written RAW (no formula evaluation)');
  });
  await test('readable tabs show invoices, items, payments, customers, products', async () => {
    const id = g.spreadsheetOf(A.user.key).id;
    const inv = g.rows(id, 'Invoices');
    assert.strictEqual(inv.length, 4); assert.strictEqual(inv[0][1], 'Number'); assert.strictEqual(inv[3][1], 'HGI/3'); assert.strictEqual(inv[3][11], 3540);
    assert.strictEqual(inv[1][13], 680, 'balance = 1180 − 500');
    assert.strictEqual(g.rows(id, 'Items sold').length, 4);
    assert.strictEqual(g.rows(id, 'Payments').length, 3);
    assert.strictEqual(g.rows(id, 'Customers')[1][0], 'Buyer 1');
    assert.strictEqual(g.rows(id, 'Company')[1][1], 'Test Traders');
  });
  await test('restore returns the exact same data', async () => {
    const r = await call('GET', '/v1/sync', { token: A.session });
    assert.strictEqual(r.json.cloud.version, 1); assert.strictEqual(r.json.data, dataA1);
  });
  await test('second user gets a separate spreadsheet and never sees the first user\'s data', async () => {
    B = (await signIn({ sub: '2002', email: 'bharat@gmail.com' })).json;
    assert.notStrictEqual(B.user.key, A.user.key);
    const r0 = await call('GET', '/v1/sync', { token: B.session }); assert.strictEqual(r0.json.data, null);
    const dB = JSON.stringify(book(1, { company: { name: 'Bharat Steel' } }));
    assert.strictEqual((await call('PUT', '/v1/sync', { token: B.session, body: { baseVersion: 0, data: dB } })).status, 200);
    assert.notStrictEqual(g.spreadsheetOf(B.user.key).id, g.spreadsheetOf(A.user.key).id);
    assert.strictEqual((await call('GET', '/v1/sync', { token: B.session })).json.data, dB);
    assert.strictEqual((await call('GET', '/v1/sync', { token: A.session })).json.data, dataA1);
  });
  await test('save based on an old version is refused (another phone saved first) — 409, cloud unchanged', async () => {
    const r = await call('PUT', '/v1/sync', { token: A.session, body: { baseVersion: 0, data: JSON.stringify(book(5)) } });
    assert.strictEqual(r.status, 409); assert.strictEqual(r.json.cloud.version, 1);
    assert.strictEqual((await call('GET', '/v1/sync', { token: A.session })).json.data, dataA1);
  });
  await test('repeating the last save (reply lost) is accepted without a new version', async () => {
    const r = await call('PUT', '/v1/sync', { token: A.session, body: { baseVersion: 0, data: dataA1 } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.cloud.version, 1); assert.strictEqual(r.json.cloud.unchanged, true);
  });
  let dataA2;
  await test('large book (≈1.7 MB with a logo, 400 invoices) is split over cells and restored exactly; slots alternate', async () => {
    const logo = 'data:image/png;base64,' + crypto.randomBytes(1_200_000).toString('base64');
    dataA2 = JSON.stringify(book(400, { company: { name: 'Test Traders', logo } }));
    const r = await call('PUT', '/v1/sync', { token: A.session, body: { baseVersion: 1, clientRev: 9, data: dataA2 } });
    assert.strictEqual(r.status, 200, r.text); assert.strictEqual(r.json.cloud.version, 2); assert.strictEqual(r.json.cloud.slot, 'b'); assert.ok(r.json.cloud.cells > 30);
    assert.strictEqual((await call('GET', '/v1/sync', { token: A.session })).json.data, dataA2);
    assert.strictEqual(g.rows(g.spreadsheetOf(A.user.key).id, 'Invoices').length, 401);
  });
  await test('Google failure in the middle of a save → 503, previous cloud copy intact', async () => {
    g.fail(/values:batchUpdate/, 500, 4);
    const r = await call('PUT', '/v1/sync', { token: A.session, body: { baseVersion: 2, data: JSON.stringify(book(2)) } });
    assert.strictEqual(r.status, 503); assert.strictEqual(r.json.error, 'cloud_unavailable');
    const back = await call('GET', '/v1/sync', { token: A.session }); assert.strictEqual(back.json.cloud.version, 2); assert.strictEqual(back.json.data, dataA2);
  });
  await test('a write that cannot be verified is not made live', async () => {
    g.corruptReadOnce = true;
    const r = await call('PUT', '/v1/sync', { token: A.session, body: { baseVersion: 2, data: JSON.stringify(book(6)) } });
    assert.strictEqual(r.status, 500); assert.strictEqual(r.json.error, 'cloud_copy_unreadable');
    assert.strictEqual((await call('GET', '/v1/sync', { token: A.session })).json.data, dataA2);
  });
  await test('temporary Google error (429) is retried transparently', async () => {
    g.fail(/values:batchClear/, 429, 1);
    const d = JSON.stringify(book(4));
    const r = await call('PUT', '/v1/sync', { token: A.session, body: { baseVersion: 2, data: d } });
    assert.strictEqual(r.status, 200, r.text); assert.strictEqual(r.json.cloud.version, 3);
    dataA2 = d;
  });
  await test('expired Google access token is refreshed and the call retried', async () => {
    g.tokens.clear();
    const r = await call('GET', '/v1/sync', { token: A.session });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.data, dataA2);
  });
  await test('cell text is stored as text (formula injection is not evaluated)', async () => {
    const d = book(1); d.invoices[0].buyerName = '=IMPORTXML("http://evil","//a")';
    const r = await call('PUT', '/v1/sync', { token: B.session, body: { baseVersion: 1, data: JSON.stringify(d) } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(g.rows(g.spreadsheetOf(B.user.key).id, 'Invoices')[1][3], '=IMPORTXML("http://evil","//a")');
    assert.ok(g.valueInputOptions.every(v => v === 'RAW'));
  });
  await test('junk data and oversized requests are refused', async () => {
    assert.strictEqual((await call('PUT', '/v1/sync', { token: A.session, body: { baseVersion: 3, data: '{"hello":1}' } })).status, 400);
    assert.strictEqual((await call('PUT', '/v1/sync', { token: A.session, body: { baseVersion: 3, data: 'not json' } })).status, 400);
    assert.strictEqual((await call('PUT', '/v1/sync', { token: A.session, body: '{bad' })).status, 400);
    const big = await call('PUT', '/v1/sync', { token: A.session, body: { baseVersion: 3, data: JSON.stringify(book(1, { pad: 'x'.repeat(26 * 1024 * 1024) })) } }).catch(e => ({ status: 413 }));
    assert.strictEqual(big.status, 413);
  });

  console.log('CORS');
  await test('the app origin (https://localhost) is allowed, other websites are not', async () => {
    const ok = await call('OPTIONS', '/v1/sync', { headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'PUT' } });
    assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'https://localhost');
    const bad = await call('OPTIONS', '/v1/sync', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'PUT' } });
    assert.strictEqual(bad.headers.get('access-control-allow-origin'), null);
  });

  console.log('Account deletion');
  await test('in-app deletion removes the spreadsheet and stops the old session', async () => {
    const id = g.spreadsheetOf(A.user.key).id;
    const r = await call('DELETE', '/v1/account', { token: A.session });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.mode, 'deleted');
    assert.ok(!g.files.has(id), 'spreadsheet gone');
    const after = await call('GET', '/v1/sync', { token: A.session }); assert.strictEqual(after.status, 401); assert.strictEqual(after.json.error, 'account_deleted');
    const marker = [...g.files.values()].find(f => f.appProperties.hgiDeletedUser === A.user.key);
    assert.ok(marker && !/asha/i.test(marker.name), 'marker holds no e-mail');
  });
  await test('signing in again after deletion starts a new, empty account', async () => {
    await new Promise(r => setTimeout(r, 5));
    const again = (await signIn({ sub: '1001', email: 'asha@gmail.com' })).json;
    const r = await call('GET', '/v1/sync', { token: again.session }); assert.strictEqual(r.status, 200); assert.strictEqual(r.json.data, null);
  });
  await test('deletion from the web page (Google sign-in) works', async () => {
    const id = g.spreadsheetOf(B.user.key).id;
    const r = await call('POST', '/v1/account/delete-with-google', { body: { idToken: g.idToken({ sub: '2002', email: 'bharat@gmail.com' }) } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.deleted, true); assert.ok(!g.files.has(id));
    assert.strictEqual((await call('GET', '/v1/sync/meta', { token: B.session })).json.error, 'account_deleted');
  });
  await test('shared-drive role without delete rights: file is trashed instead', async () => {
    const C = (await signIn({ sub: '3003', email: 'chetan@gmail.com' })).json;
    await call('PUT', '/v1/sync', { token: C.session, body: { baseVersion: 0, data: JSON.stringify(book(1)) } });
    const id = g.spreadsheetOf(C.user.key).id;
    g.fail(new RegExp('/drive/v3/files/' + id), 403, 1, 'DELETE');
    const r = await call('DELETE', '/v1/account', { token: C.session });
    assert.strictEqual(r.json.mode, 'trashed'); assert.strictEqual(g.files.get(id).trashed, true);
  });

  console.log('Other Drive access modes');
  await test('owner-oauth mode gets tokens with the refresh token; a revoked token is reported, not faked', async () => {
    const oc = config.load({ ...env, DRIVE_AUTH: 'owner-oauth', OWNER_CLIENT_ID: 'c', OWNER_CLIENT_SECRET: 's', OWNER_REFRESH_TOKEN: 'good-refresh' }); oc.endpoints = g.endpoints();
    const { GoogleAccess } = require('../lib/google-access');
    assert.match(await new GoogleAccess(oc).get(), /^at-/);
    oc.owner.refreshToken = 'revoked';
    await assert.rejects(new GoogleAccess(oc).get(), /expired or revoked/);
  });
  await test('sa-key mode signs a JWT grant with the key', async () => {
    const k = rsa();
    const sc = config.load({ ...env, DRIVE_AUTH: 'sa-key', SA_KEY_JSON: JSON.stringify({ client_email: 'sync@p.iam.gserviceaccount.com', private_key: k.privateKey.export({ type: 'pkcs8', format: 'pem' }) }) }); sc.endpoints = g.endpoints();
    const { GoogleAccess } = require('../lib/google-access');
    assert.match(await new GoogleAccess(sc).get(), /^at-/);
  });

  await test('test sign-in (when enabled locally) accepts only @example.com addresses', async () => {
    const tc = config.load({ ...env, HGI_ALLOW_TEST_LOGIN: '1' }); tc.endpoints = g.endpoints();
    const s2 = createServer(tc); await new Promise(r => s2.listen(0, '127.0.0.1', r));
    const u = `http://127.0.0.1:${s2.address().port}/v1/auth/test`;
    const ok = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'qa@example.com' }) });
    const no = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'someone@gmail.com' }) });
    s2.close();
    assert.strictEqual(ok.status, 200); assert.strictEqual(no.status, 400);
  });

  server.close(); await g.stop();
  console.log(`\n${pass} passed, ${fail} failed`);
  require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true });
  require('fs').writeFileSync(require('path').join(__dirname, 'out', 'results.txt'), results.join('\n') + `\n\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
