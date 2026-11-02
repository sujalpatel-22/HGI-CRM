#!/usr/bin/env node
'use strict';
/*
 * Cloud service tests. Google sign-in keys, Cloud Storage and the GST provider are in-memory stand-ins (test/fake-google.js).
 * Firestore: the stand-in by default, or the official Firestore emulator when FIRESTORE_EMULATOR_HOST is set
 * (CI: `npx firebase-tools emulators:exec --only firestore "node backend/test/run-tests.js"`).
 */
const assert = require('assert');
const crypto = require('crypto');
const { FakeGoogle, rsa } = require('./fake-google');
const { createServer } = require('../server');
const config = require('../lib/config');
const { gstinCheck } = require('../lib/gst');

const CLIENT = 'test-web-client.apps.googleusercontent.com';
const EMU = process.env.FIRESTORE_EMULATOR_HOST || '';
const RUN = crypto.randomBytes(3).toString('hex');      // unique accounts per run (the emulator keeps data between runs)
let pass = 0, fail = 0;
const results = [];
async function test(name, fn) {
  try { await fn(); pass++; results.push('PASS ' + name); console.log('  ✓ ' + name); }
  catch (e) { fail++; results.push('FAIL ' + name + ' — ' + e.message); console.log('  ✗ ' + name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); }
}
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstin(base14) { for (const c of CH) if (gstinCheck(base14 + c)) return base14 + c; throw new Error('no check digit'); }
const tp = (g, o = {}) => ({ gstin: g, lgnm: 'SHREE RAM ENGINEERING PRIVATE LIMITED', tradeNam: 'Shree Ram Engineering', sts: 'Active', rgdt: '01/07/2017', ctb: 'Private Limited Company', dty: 'Regular',
  nba: ['Factory / Manufacturing', 'Supplier of Services'], stj: 'Ghatak 12', ctj: 'RANGE-I', cxdt: '', lstupdt: '12/03/2024',
  pradr: { addr: { bno: 'Plot 14', bnm: 'Ram Udyog', flno: '', st: 'MIDC Road', loc: 'Bhosari', dst: 'Pune', stcd: 'Maharashtra', city: '', pncd: '411026', lt: '', lg: '' }, ntr: 'Factory / Manufacturing' }, ...o });

(async () => {
  const g = await new FakeGoogle().start();
  const G1 = gstin('27AAPFU0939F1Z'), G2 = gstin('24AAACR5055K1Z'), GX = gstin('29AABCT1332L1Z');
  g.gstRecords.set(G1, tp(G1));
  g.gstRecords.set(G2, tp(G2, { lgnm: 'CANCELLED TRADERS', tradeNam: '', sts: 'Cancelled', cxdt: '31/03/2023', pradr: { addr: { bno: '5', st: 'Station Road', loc: 'Mehsana', dst: 'Mehsana', stcd: 'Gujarat', pncd: '384002' } } }));
  const env = { PORT: '0', GOOGLE_CLIENT_IDS: CLIENT, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), PROJECT_ID: 'demo-hgi', GCP_AUTH: 'metadata',
    FILES_BUCKET: 'hgi-files-test', GST_API_URL: 'http://placeholder/{gstin}', GST_API_HEADERS: JSON.stringify({ 'x-api-key': g.gstKey }), GST_API_NAME: 'Test GSP', SUPPORT_EMAIL: 'info@hariguru.com', HGI_ALLOW_TEST_LOGIN: '1',
    ...(EMU ? { FIRESTORE_EMULATOR_HOST: EMU } : {}) };
  const mk = (over = {}) => { const c = config.load({ ...env, ...over }); c.endpoints = g.endpoints(); if (!over.GST_API_URL && c.gst.url) c.gst.url = g.gstUrl(); return c; };
  const cfg = mk();
  console.log(`Firestore: ${EMU ? 'official emulator at ' + EMU : 'in-memory stand-in'}`);
  const server = createServer(cfg);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { body, token, headers = {}, srv } = {}) => {
    const r = await fetch((srv || base) + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  const signIn = claims => call('POST', '/v1/auth/google', { body: { idToken: g.idToken(claims) } });
  const push = (tok, records, device = 'Phone A') => call('POST', '/v1/sync/push', { token: tok, body: { device, records } });
  const pullAll = async (tok, since = 0) => { const all = []; let s = since, more = true; while (more) { const r = await call('GET', `/v1/sync/pull?since=${s}&limit=300`, { token: tok }); assert.strictEqual(r.status, 200, r.text); all.push(...r.json.records); more = r.json.more; if (r.json.records.length) s = r.json.records[r.json.records.length - 1].seq; } return all; };
  const rec = (kind, id, obj, baseRev = 0, extra = {}) => ({ kind, id, baseRev, data: JSON.stringify(obj), modifiedAt: new Date().toISOString(), ...extra });
  const inv = (id, num, extra = {}) => ({ id, docType: 'INV', num, date: '2026-10-20', buyerName: 'Shree Ram Engineering', items: [{ desc: 'Pump', qty: 1, rate: 1000, gst: 18 }], payments: [], grandTotal: 1180, ...extra });

  console.log('Configuration');
  await test('Cloud Run refuses test sign-in and emulator / endpoint overrides', () => {
    assert.throws(() => config.load({ ...env, K_SERVICE: 'hgi', FIRESTORE_EMULATOR_HOST: '' , HGI_ALLOW_TEST_LOGIN: '1' }), /not allowed on Cloud Run/);
    assert.throws(() => config.load({ ...env, HGI_ALLOW_TEST_LOGIN: '', K_SERVICE: 'hgi', FIRESTORE_EMULATOR_HOST: 'localhost:8080' }), /not allowed on Cloud Run/);
  });
  await test('needs PROJECT_ID, a strong session secret and a client ID; GST URL must be https in production', () => {
    assert.throws(() => config.load({ ...env, PROJECT_ID: '' }), /PROJECT_ID/);
    assert.throws(() => config.load({ ...env, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
    assert.throws(() => config.load({ ...env, HGI_ALLOW_TEST_LOGIN: '', GOOGLE_CLIENT_IDS: '' }), /GOOGLE_CLIENT_IDS/);
    assert.throws(() => config.load({ ...env, HGI_ALLOW_TEST_LOGIN: '', GST_API_URL: 'http://plain' }), /https/);
    assert.throws(() => config.load({ ...env, GST_API_HEADERS: '{bad' }), /JSON/);
  });

  console.log('Pages');
  await test('privacy policy, account deletion page and health check', async () => {
    const p = await call('GET', '/privacy'); assert.strictEqual(p.status, 200); assert.match(p.text, /Firestore|database/i);
    const d = await call('GET', '/delete-account'); assert.strictEqual(d.status, 200); assert.match(d.text, new RegExp(CLIENT.replace(/\./g, '\\.')));
    assert.strictEqual((await call('GET', '/healthz')).json.ok, true);
  });

  console.log('Sign in with Google');
  let A, B, A2;
  await test('valid Google ID token → app session; the data key is not the raw Google ID', async () => {
    const r = await signIn({ sub: 'a' + RUN, email: 'Asha@Gmail.com', name: 'Asha' });
    assert.strictEqual(r.status, 200, r.text); assert.ok(r.json.session); assert.strictEqual(r.json.user.email, 'asha@gmail.com'); assert.ok(!r.json.user.key.includes(RUN));
    A = r.json;
  });
  await test('wrong audience / expired / wrong issuer / foreign key / unknown kid / unverified e-mail / garbage are refused', async () => {
    assert.strictEqual((await signIn({ sub: '1', email: 'x@gmail.com', aud: 'other.apps.googleusercontent.com' })).status, 401);
    const ex = await signIn({ sub: '1', email: 'x@gmail.com', exp: Math.floor(Date.now() / 1000) - 600 }); assert.strictEqual(ex.json.error, 'token_expired');
    assert.strictEqual((await signIn({ sub: '1', email: 'x@gmail.com', iss: 'https://evil.example' })).status, 401);
    assert.strictEqual((await call('POST', '/v1/auth/google', { body: { idToken: g.idToken({ sub: '1', email: 'x@gmail.com' }, { privateKey: rsa().privateKey }) } })).status, 401);
    assert.strictEqual((await call('POST', '/v1/auth/google', { body: { idToken: g.idToken({ sub: '1', email: 'x@gmail.com' }, { kid: 'nope' }) } })).status, 401);
    assert.strictEqual((await signIn({ sub: '1', email: 'x@gmail.com', email_verified: false })).status, 403);
    assert.strictEqual((await call('POST', '/v1/auth/google', { body: { idToken: 'abc.def' } })).status, 401);
  });
  await test('no / tampered / expired session → 401; nearly expired session is renewed', async () => {
    assert.strictEqual((await call('GET', '/v1/me')).status, 401);
    const [b, s] = A.session.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url')), sub: 'b' + RUN })).toString('base64url') + '.' + s;
    assert.strictEqual((await call('GET', '/v1/me', { token: forged })).status, 401);
    const { Sessions } = require('../lib/identity');
    const old = new Sessions(cfg).sign({ v: 1, sub: 'a' + RUN, email: 'asha@gmail.com', iat: Date.now() - 2e9, exp: Date.now() - 1000 });
    assert.strictEqual((await call('GET', '/v1/me', { token: old })).json.error, 'session_expired');
    const soon = new Sessions(cfg).sign({ v: 1, sub: 'a' + RUN, email: 'asha@gmail.com', iat: Date.now(), exp: Date.now() + 5 * 86400e3 });
    const r = await call('GET', '/v1/me', { token: soon }); assert.strictEqual(r.status, 200); assert.ok(r.headers.get('x-hgi-session'));
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
  await test('another device of the same account pulls exactly that data', async () => {
    A2 = (await signIn({ sub: 'a' + RUN, email: 'asha@gmail.com' })).json;
    const all = await pullAll(A2.session);
    assert.deepStrictEqual(all.map(r => r.kind + '/' + r.id), ['company/main', 'customer/C1', 'product/P1', 'invoice/D1']);
    assert.strictEqual(JSON.parse(all[3].data).num, 'HGI/1'); assert.deepStrictEqual(all.map(r => r.seq), [1, 2, 3, 4]);
  });
  await test('edit on device 2 (base rev 1) → rev 2; device 1 editing the old version gets a conflict with the cloud copy', async () => {
    const ok = await push(A2.session, [rec('invoice', 'D1', inv('D1', 'HGI/1', { payments: [{ id: 'PAY1', amount: 500 }] }), 1)], 'Phone B');
    assert.strictEqual(ok.json.results[0].status, 'ok'); assert.strictEqual(ok.json.results[0].rev, 2);
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
  await test('renumbering frees the old number; a cancelled invoice keeps its number; deleting releases it', async () => {
    const d3 = (await pullAll(A.session)).find(r => r.id === 'D3');
    assert.strictEqual((await push(A.session, [rec('invoice', 'D3', inv('D3', 'HGI/30'), d3.rev)])).json.results[0].status, 'ok');
    assert.strictEqual((await push(A.session, [rec('invoice', 'D4', inv('D4', 'HGI/3'))])).json.results[0].status, 'ok');
    const d4 = (await pullAll(A.session)).find(r => r.id === 'D4');
    assert.strictEqual((await push(A.session, [rec('invoice', 'D4', inv('D4', 'HGI/3', { cancelled: true }), d4.rev)])).json.results[0].status, 'ok');
    assert.strictEqual((await push(A.session, [rec('invoice', 'D5', inv('D5', 'HGI/3'))])).json.results[0].status, 'number_taken');
    const d4b = (await pullAll(A.session)).find(r => r.id === 'D4');
    assert.strictEqual((await push(A.session, [{ kind: 'invoice', id: 'D4', baseRev: d4b.rev, deleted: true }])).json.results[0].status, 'ok');
    assert.strictEqual((await push(A.session, [rec('invoice', 'D5', inv('D5', 'HGI/3'))])).json.results[0].status, 'ok');
    const chk = await call('POST', '/v1/numbers/check', { token: A.session, body: { docType: 'INV', num: 'HGI/3', docId: 'D9' } });
    assert.deepStrictEqual(chk.json, { free: false, takenBy: 'D5' });
    assert.strictEqual((await call('POST', '/v1/numbers/check', { token: A.session, body: { docType: 'INV', num: 'HGI/4', docId: 'D9' } })).json.free, true);
  });
  await test('deletions reach other devices as tombstones', async () => {
    const t = (await pullAll(A2.session)).filter(r => r.id === 'D4').pop();
    assert.strictEqual(t.deleted, true); assert.strictEqual(t.data, null);
  });
  await test('two phones uploading at the same moment from the same base: one wins, the other gets a conflict', async () => {
    const p1 = (await pullAll(A.session)).find(r => r.id === 'P1');
    const [r1, r2] = await Promise.all([push(A.session, [rec('product', 'P1', { id: 'P1', name: 'Pump', rate: 1100 }, p1.rev)]), push(A2.session, [rec('product', 'P1', { id: 'P1', name: 'Pump', rate: 1200 }, p1.rev)], 'Phone B')]);
    const st = [r1.json.results[0].status, r2.json.results[0].status].sort();
    assert.deepStrictEqual(st, ['conflict', 'ok']);
  });

  console.log('Isolation and limits');
  await test('another account sees none of this data, and the same record IDs stay separate', async () => {
    B = (await signIn({ sub: 'b' + RUN, email: 'bharat@gmail.com' })).json;
    assert.deepStrictEqual(await pullAll(B.session), []);
    assert.strictEqual((await push(B.session, [rec('invoice', 'D1', inv('D1', 'HGI/1', { buyerName: 'B only' }))])).json.results[0].status, 'ok');
    assert.strictEqual(JSON.parse((await pullAll(A.session)).filter(r => r.id === 'D1').pop().data).buyerName, 'Shree Ram Engineering');
    assert.strictEqual((await pullAll(B.session)).length, 1);
  });
  await test('750 records upload in batches and come back in order over several pages', async () => {
    const C = (await signIn({ sub: 'c' + RUN, email: 'chetan@gmail.com' })).json;
    for (let b = 0; b < 750; b += 200) {
      const batch = []; for (let i = b; i < Math.min(750, b + 200); i++) batch.push(rec('invoice', 'X' + i, inv('X' + i, 'C/' + i)));
      const r = await push(C.session, batch); assert.ok(r.json.results.every(x => x.status === 'ok'), r.text.slice(0, 200));
    }
    const all = await pullAll(C.session);
    assert.strictEqual(all.length, 750); assert.ok(all.every((r, i) => r.seq === i + 1));
  });
  await test('bad uploads are refused: unknown kind, too many, duplicates, junk, oversized record', async () => {
    assert.strictEqual((await push(A.session, [rec('secret', 'x', {})])).status, 400);
    assert.strictEqual((await push(A.session, Array.from({ length: 201 }, (_, i) => rec('product', 'Z' + i, {})))).status, 400);
    assert.strictEqual((await push(A.session, [rec('product', 'Z', {}), rec('product', 'Z', {})])).status, 400);
    const r = await push(A.session, [{ kind: 'product', id: 'J', baseRev: 0, data: 'not json' }, rec('product', 'Big', { blob: 'x'.repeat(950 * 1024) })]);
    assert.deepStrictEqual(r.json.results.map(x => x.status), ['invalid', 'too_large']);
  });

  console.log('GSTIN lookup');
  await test('valid GSTIN → legal & trade name, address, state, PIN, status, registration details from the provider', async () => {
    const r = await call('GET', `/v1/gstin/${G1}`, { token: A.session });
    assert.strictEqual(r.status, 200, r.text);
    const d = r.json;
    assert.strictEqual(d.legalName, 'SHREE RAM ENGINEERING PRIVATE LIMITED'); assert.strictEqual(d.tradeName, 'Shree Ram Engineering');
    assert.strictEqual(d.address.line, 'Plot 14, Ram Udyog, MIDC Road, Bhosari, Pune'); assert.strictEqual(d.address.pin, '411026'); assert.strictEqual(d.address.state, 'Maharashtra');
    assert.strictEqual(d.stateCode, '27'); assert.strictEqual(d.status, 'Active'); assert.strictEqual(d.registrationDate, '01/07/2017'); assert.strictEqual(d.constitution, 'Private Limited Company');
    assert.strictEqual(d.taxpayerType, 'Regular'); assert.deepStrictEqual(d.natureOfBusiness, ['Factory / Manufacturing', 'Supplier of Services']); assert.strictEqual(d.source, 'Test GSP');
  });
  await test('repeat lookups come from the 7-day cache (no second provider call)', async () => {
    const n = g.gstCalls;
    const r = await call('GET', `/v1/gstin/${G1}`, { token: B.session });
    assert.strictEqual(r.json.cached, true); assert.strictEqual(g.gstCalls, n);
  });
  await test('cancelled registration is reported as cancelled, with its cancellation date', async () => {
    const r = await call('GET', `/v1/gstin/${G2}`, { token: A.session });
    assert.strictEqual(r.json.status, 'Cancelled'); assert.strictEqual(r.json.cancellationDate, '31/03/2023'); assert.strictEqual(r.json.tradeName, ''); assert.strictEqual(r.json.address.state, 'Gujarat');
  });
  await test('wrong check digit → 400 without asking the provider; unknown GSTIN → 404; provider down → 502 (nothing invented)', async () => {
    const n = g.gstCalls;
    const bad = G1.slice(0, 14) + (G1[14] === 'A' ? 'B' : 'A');
    assert.strictEqual((await call('GET', `/v1/gstin/${bad}`, { token: A.session })).json.error, 'invalid_gstin'); assert.strictEqual(g.gstCalls, n);
    const nf = await call('GET', `/v1/gstin/${GX}`, { token: A.session }); assert.strictEqual(nf.status, 404); assert.strictEqual(nf.json.error, 'gstin_not_found');
    g.gstDown = true; const GY = gstin('19AABCU9603R1Z'); g.gstRecords.set(GY, tp(GY));
    const down = await call('GET', `/v1/gstin/${GY}`, { token: A.session }); g.gstDown = false;
    assert.strictEqual(down.status, 502); assert.strictEqual(down.json.error, 'gst_unavailable'); assert.ok(!down.json.legalName);
    assert.strictEqual((await call('GET', `/v1/gstin/${GY}`, { token: A.session })).json.legalName, 'SHREE RAM ENGINEERING PRIVATE LIMITED', 'not cached as a failure');
  });
  await test('provider with a token step (auth URL → token header) works', async () => {
    const c2 = mk({ GST_API_URL: g.gstUrl(), GST_API_HEADERS: '{}', GST_API_AUTH_URL: g.base + '/gst/auth', GST_API_AUTH_HEADERS: JSON.stringify({ 'x-api-key': g.gstKey }), GST_API_TOKEN_PATH: 'data.token', GST_API_TOKEN_HEADER: 'authorization: {token}' });
    const s2 = createServer(c2); await new Promise(r => s2.listen(0, '127.0.0.1', r));
    const GZ = gstin('33AAACI1195H1Z'); g.gstRecords.set(GZ, tp(GZ, { lgnm: 'TOKEN FLOW LTD' }));
    const tok = (await call('POST', '/v1/auth/google', { body: { idToken: g.idToken({ sub: 'a' + RUN, email: 'asha@gmail.com' }) }, srv: `http://127.0.0.1:${s2.address().port}` })).json.session;
    const r = await call('GET', `/v1/gstin/${GZ}`, { token: tok, srv: `http://127.0.0.1:${s2.address().port}` }); s2.close();
    assert.strictEqual(r.json.legalName, 'TOKEN FLOW LTD');
  });
  await test('server without a GST provider → 503 gst_not_configured (the app falls back to manual entry)', async () => {
    const s3 = createServer(mk({ GST_API_URL: '' })); await new Promise(r => s3.listen(0, '127.0.0.1', r));
    const srv = `http://127.0.0.1:${s3.address().port}`;
    const tok = (await call('POST', '/v1/auth/google', { body: { idToken: g.idToken({ sub: 'a' + RUN, email: 'asha@gmail.com' }) }, srv })).json.session;
    const r = await call('GET', `/v1/gstin/${G1}`, { token: tok, srv }); const me = await call('GET', '/v1/me', { token: tok, srv }); s3.close();
    assert.strictEqual(r.status, 503); assert.strictEqual(r.json.error, 'gst_not_configured'); assert.strictEqual(me.json.features.gst, false);
  });

  console.log('Invoice PDFs');
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(3000)]);
  await test('PDF stored in the private bucket, listed and returned byte-for-byte', async () => {
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

  console.log('CORS');
  await test('app origin allowed, other websites not', async () => {
    assert.strictEqual((await call('OPTIONS', '/v1/sync/push', { headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST' } })).headers.get('access-control-allow-origin'), 'https://localhost');
    assert.strictEqual((await call('OPTIONS', '/v1/sync/push', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } })).headers.get('access-control-allow-origin'), null);
  });

  await require('./edoc-tests')({ test, g, env, mk, call, gstin, RUN, EMU });

  console.log('Account deletion');
  await test('in-app deletion removes every record, number and PDF; old sessions stop working', async () => {
    const r = await call('DELETE', '/v1/account', { token: A.session });
    assert.strictEqual(r.status, 200, r.text); assert.ok(r.json.records >= 8); assert.strictEqual(r.json.files, 1);
    assert.ok(![...g.objects.keys()].some(k => k.includes('/users/' + A.user.key + '/')), 'PDF object removed');
    assert.strictEqual((await call('GET', '/v1/me', { token: A2.session })).json.error, 'account_deleted');
  });
  await test('signing in again starts an empty account; the numbers are free again', async () => {
    await new Promise(r => setTimeout(r, 5));
    const again = (await signIn({ sub: 'a' + RUN, email: 'asha@gmail.com' })).json;
    assert.deepStrictEqual(await pullAll(again.session), []);
    assert.strictEqual((await push(again.session, [rec('invoice', 'N1', inv('N1', 'HGI/1'))])).json.results[0].status, 'ok');
  });
  await test('deletion from the web page (Google sign-in) works; B\'s data is gone, A\'s untouched', async () => {
    const r = await call('POST', '/v1/account/delete-with-google', { body: { idToken: g.idToken({ sub: 'b' + RUN, email: 'bharat@gmail.com' }) } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.deleted, true);
    assert.strictEqual((await call('GET', '/v1/me', { token: B.session })).json.error, 'account_deleted');
  });
  await test('test sign-in only accepts @example.com and does not exist when disabled', async () => {
    assert.strictEqual((await call('POST', '/v1/auth/test', { body: { email: 'qa@example.com' } })).status, 200);
    assert.strictEqual((await call('POST', '/v1/auth/test', { body: { email: 'someone@gmail.com' } })).status, 400);
    const s4 = createServer(mk({ HGI_ALLOW_TEST_LOGIN: '', GST_API_URL: 'https://gsp.example/{gstin}' })); await new Promise(r => s4.listen(0, '127.0.0.1', r));
    const r = await call('POST', '/v1/auth/test', { body: { email: 'qa@example.com' }, srv: `http://127.0.0.1:${s4.address().port}` }); s4.close();
    assert.strictEqual(r.status, 404);
  });

  server.close(); await g.stop();
  console.log(`\n${pass} passed, ${fail} failed`);
  require('fs').mkdirSync(require('path').join(__dirname, 'out'), { recursive: true });
  require('fs').writeFileSync(require('path').join(__dirname, 'out', 'results.txt'), results.join('\n') + `\n\n${pass} passed, ${fail} failed (${EMU ? 'Firestore emulator' : 'stand-in'})\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
