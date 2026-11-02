'use strict';
/**
 * E-invoice / e-way bill tests. The government side is test/nic-simulator.js — a TEST-ONLY local copy of the NIC
 * protocol (RSA login, SEK, AES payloads, rek + HMAC). It proves the encryption and request flow end-to-end without
 * real credentials; every number it returns is test data, and the server only talks to it with EDOC_ENV=test, which
 * is refused on Cloud Run and for any non-localhost URL.
 */
const assert = require('assert');
const crypto = require('crypto');
const { startSimulator } = require('./nic-simulator');
const { createServer } = require('../server');
const config = require('../lib/config');
const { buildIrpPayload } = require('../lib/einvoice-mapper');
const { computeDoc } = require('../lib/gst-calc');

module.exports = async function edocTests({ test, g, env, mk, call, gstin, RUN, EMU }) {
  const sim = await startSimulator();
  const credKey = crypto.randomBytes(32).toString('base64');
  const SIM = `http://127.0.0.1:${sim.port}`;
  const edocEnv = { EDOC_ENV: 'test', EDOC_CRED_KEY: credKey, IRP_BASE_URL: SIM, IRP_CLIENT_ID: 'gsp-client', IRP_CLIENT_SECRET: 'gsp-secret-irp', IRP_PUBLIC_KEY: sim.publicKeyPem,
    EWB_BASE_URL: SIM, EWB_CLIENT_ID: 'gsp-client-e', EWB_CLIENT_SECRET: 'gsp-secret-ewb', EWB_PUBLIC_KEY: sim.publicKeyPem.replace(/\n/g, '\\n') };
  const server = createServer(mk(edocEnv));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const srv = `http://127.0.0.1:${server.address().port}`;
  const api = (method, p, body, token) => call(method, p, { body, token, srv });
  const signIn = async (sub, email) => (await call('POST', '/v1/auth/google', { body: { idToken: g.idToken({ sub, email }) }, srv })).json;

  const SELLER = gstin('24AAACH7409R1Z'), BUYER = gstin('27AAPFU0939F1Z');
  const company = { name: 'HARI GURU INDUSTRIES', legalName: 'HARI GURU INDUSTRIES', gstin: SELLER, stateCode: '24', pin: '382330', aato: '5to10', ewbLimit: 50000,
    address: 'Plot No 123, Phase 3, GIDC Naroda,\nAhmedabad', phone: '+91 98765 43210', email: 'info@hariguru.com' };
  const mkDoc = (num, o = {}) => {
    const d = { id: 'DOC-' + num.replace(/\W/g, ''), docType: 'INV', num, date: '2026-10-21', supplyType: 'B2B', pos: '27', reverseCharge: false,
      buyerName: 'Shree Ram Engineering', buyerGstin: BUYER, buyerAddress: 'MIDC Bhosari, Pune', buyerState: 'Maharashtra', buyerStateCode: '27', buyerPin: '411026',
      shipName: '', shipAddress: '', shipStateCode: '', shipPin: '',
      items: [{ desc: 'Industrial Machine Components', hsn: '848390', gst: 18, qty: 20, unit: 'Nos', rate: 2500 }, { desc: 'Auto spare bracket', hsn: '870899', gst: 5, qty: 20, unit: 'pcs', rate: 150 }],
      discount: 500, pfCharges: 0, otherCharges: 800,
      transport: { transName: 'VRL Logistics', transMode: '1', distance: 0, vehicleNo: 'GJ05AB1234', vehicleType: 'R' }, ...o };
    d.grandTotal = computeDoc(d, company.stateCode).grandTotal;
    return d;
  };
  const generateCalls = () => sim.calls.filter(c => c.method === 'POST' && c.path === '/eicore/v1.03/Invoice').length;

  console.log('E-invoice & e-way bill: configuration');
  await test('test mode only with the local simulator; never on Cloud Run; production needs explicit confirmation', () => {
    assert.throws(() => config.load({ ...env, ...edocEnv, HGI_ALLOW_TEST_LOGIN: '' }), /EDOC_ENV=test is only for the local protocol simulator/);
    assert.throws(() => config.load({ ...env, ...edocEnv, IRP_BASE_URL: 'https://einv-apisandbox.nic.in' }), /EDOC_ENV=test is only/);
    assert.throws(() => config.load({ ...env, ...edocEnv, EDOC_ENV: 'sandbox' }), /IRP_BASE_URL must use https/);
    assert.throws(() => config.load({ ...env, ...edocEnv, EDOC_ENV: 'production', IRP_BASE_URL: 'https://gsp.example', EWB_BASE_URL: 'https://gsp.example' }), /EDOC_CONFIRM_PRODUCTION/);
    assert.throws(() => config.load({ ...env, ...edocEnv, EDOC_CRED_KEY: '' }), /EDOC_CRED_KEY is required/);
    assert.throws(() => config.load({ ...env, ...edocEnv, IRP_CLIENT_SECRET: '' }), /IRP_CLIENT_SECRET/);
    assert.throws(() => config.load({ ...env, ...edocEnv, K_SERVICE: 'hgi', HGI_ALLOW_TEST_LOGIN: '' }), /not allowed on Cloud Run|only for the local/);
    const ok = config.load({ ...env, ...edocEnv, HGI_ALLOW_TEST_LOGIN: '', EDOC_ENV: 'production', EDOC_CONFIRM_PRODUCTION: 'I-UNDERSTAND', IRP_BASE_URL: 'https://gsp.example', EWB_BASE_URL: 'https://gsp.example', GST_API_URL: '' });
    assert.strictEqual(ok.edoc.env, 'production');
  });

  const U = await signIn('edoc-' + RUN, 'edoc@gmail.com');
  const V = await signIn('edoc-other-' + RUN, 'other@gmail.com');
  await test('server without government API access: features off, generation refused with no number', async () => {
    const me = await call('GET', '/v1/me', { token: U.session });
    assert.deepStrictEqual(me.json.features.edoc, { irp: false, ewb: false, env: 'sandbox' });
    const r = await call('POST', '/v1/edoc/generate', { token: U.session, body: { doc: mkDoc('HGI/1'), company, mode: 'irn+ewb' } });
    assert.strictEqual(r.status, 503); assert.strictEqual(r.json.error, 'EDOC_NOT_CONFIGURED'); assert.ok(!JSON.stringify(r.json).match(/[0-9a-f]{64}/));
  });

  console.log('E-invoice & e-way bill: API logins');
  await test('features on; no login saved → 412 NO_CREDENTIALS', async () => {
    assert.deepStrictEqual((await api('GET', '/v1/me', undefined, U.session)).json.features.edoc, { irp: true, ewb: true, env: 'test' });
    const r = await api('POST', '/v1/edoc/generate', { doc: mkDoc('HGI/1'), company, mode: 'irn' }, U.session);
    assert.strictEqual(r.status, 412); assert.strictEqual(r.json.error, 'NO_CREDENTIALS');
  });
  await test('a wrong login is checked against the IRP and never saved', async () => {
    const r = await api('PUT', '/v1/edoc/credentials/' + SELLER, { irpUser: 'testuser', irpPass: 'wrong' }, U.session);
    assert.strictEqual(r.status, 422, r.text); assert.strictEqual(r.json.error, 'IRP_AUTH_FAILED'); assert.match(r.json.message, /1004/);
    assert.deepStrictEqual((await api('GET', '/v1/edoc/credentials', undefined, U.session)).json.credentials, []);
  });
  await test('correct logins verified (IRP + e-way bill) and stored encrypted; the app only sees masked user names', async () => {
    const r = await api('PUT', '/v1/edoc/credentials/' + SELLER, { irpUser: 'testuser', irpPass: 'testpass', ewbUser: 'ewbuser', ewbPass: 'ewbpass' }, U.session);
    assert.strictEqual(r.status, 200, r.text);
    assert.ok(r.json.credential.verified.irp && r.json.credential.verified.ewb);
    const l = (await api('GET', '/v1/edoc/credentials', undefined, U.session));
    assert.strictEqual(l.json.credentials.length, 1); assert.strictEqual(l.json.credentials[0].irpUser, 'te•••••r');
    for (const secret of ['testpass', 'ewbpass', 'gsp-secret-irp', 'gsp-secret-ewb']) { assert.ok(!r.text.includes(secret)); assert.ok(!l.text.includes(secret)); }
    if (!EMU) {
      const stored = JSON.stringify([...g.docs.entries()].filter(([n]) => n.includes('/edoc_cred/')));
      assert.ok(stored.includes('v1.') && !stored.includes('testpass') && !stored.includes('ewbpass') && !stored.includes('"testuser"'), 'encrypted at rest');
    }
    // the GSP's client secret goes only to the government API, in its headers
    assert.ok(sim.calls.some(c => c.headers.client_secret === 'gsp-secret-irp' && c.headers.gstin === SELLER));
  });
  await test('another account has no login for this GSTIN', async () => {
    const r = await api('POST', '/v1/edoc/generate', { doc: mkDoc('HGI/1'), company, mode: 'irn' }, V.session);
    assert.strictEqual(r.status, 412);
  });

  console.log('E-invoice & e-way bill: checks before anything is sent');
  await test('mapping: assessable value and taxes add up exactly to the app totals', () => {
    const d = mkDoc('HGI/1');
    const { payload, errors, totals } = buildIrpPayload(d, company, { cfgGstin: SELLER });
    assert.deepStrictEqual(errors, []);
    const v = payload.ValDtls, sum = f => Math.round(payload.ItemList.reduce((a, i) => a + i[f], 0) * 100) / 100;
    assert.strictEqual(sum('AssAmt'), v.AssVal); assert.strictEqual(sum('IgstAmt'), v.IgstVal); assert.strictEqual(v.TotInvVal, totals.grandTotal);
    assert.deepStrictEqual(payload.ItemList.slice(0, 2).map(i => i.Unit), ['NOS', 'PCS'], 'same unit codes as the app');
  });
  const pv = (doc, mode = 'irn+ewb', co = company) => api('POST', '/v1/edoc/preview', { doc, company: co, mode }, U.session);
  await test('preview: B2C, turnover up to ₹5 cr, number starting with 0 and wrong totals are caught; nothing reaches the IRP', async () => {
    const before = sim.calls.length;
    assert.match(JSON.stringify((await pv(mkDoc('HGI/2', { supplyType: 'B2C', buyerGstin: '' }))).json.errors), /B2C/);
    assert.match(JSON.stringify((await pv(mkDoc('HGI/2'), 'irn', { ...company, aato: 'upto5' })).json.errors), /up to ₹5 crore/);
    assert.ok((await pv(mkDoc('01/26-27'))).json.errors.some(e => e.field === 'num'));
    assert.ok((await pv({ ...mkDoc('HGI/2'), grandTotal: 1 })).json.errors.some(e => /Totals mismatch/.test(e.message)));
    const ok = await pv(mkDoc('HGI/2'));
    assert.deepStrictEqual(ok.json.errors, []); assert.ok(ok.json.payload.EwbDtls.VehNo); assert.strictEqual(ok.json.eligibility.ewb.required, true);
    assert.strictEqual(sim.calls.length, before);
    const g2 = await api('POST', '/v1/edoc/generate', { doc: { ...mkDoc('HGI/2'), grandTotal: 1 }, company, mode: 'irn' }, U.session);
    assert.strictEqual(g2.status, 422); assert.strictEqual(g2.json.error, 'VALIDATION_FAILED'); assert.strictEqual(sim.calls.length, before);
  });

  console.log('E-invoice & e-way bill: one-step IRN + e-way bill');
  const D1 = mkDoc('HGI/7/26-27');
  let rec1;
  await test('IRN, acknowledgement, signed QR and e-way bill come from the IRP answer (encrypted round trip)', async () => {
    const r = await api('POST', '/v1/edoc/generate', { doc: D1, company, mode: 'irn+ewb' }, U.session);
    assert.strictEqual(r.status, 200, r.text);
    rec1 = r.json.record;
    const simRec = sim.irns.get(rec1.irn.irn);
    assert.ok(simRec, 'the IRN exists at the IRP');
    assert.match(rec1.irn.irn, /^[0-9a-f]{64}$/); assert.strictEqual(rec1.irn.ackNo, String(simRec.AckNo)); assert.strictEqual(rec1.irn.signedQr, simRec.SignedQRCode);
    assert.strictEqual(rec1.ewb.ewbNo, String(simRec.EwbNo)); assert.strictEqual(rec1.ewb.via, 'IRP'); assert.ok(rec1.ewb.validAt);
    assert.strictEqual(rec1.env, 'test'); assert.strictEqual(rec1.irn.env, 'test'); assert.strictEqual(rec1.docId, D1.id);
  });
  await test('a second tap returns the stored IRN — the IRP is not called again', async () => {
    const n = generateCalls();
    const r = await api('POST', '/v1/edoc/generate', { doc: D1, company, mode: 'irn+ewb' }, U.session);
    assert.strictEqual(r.json.record.irn.irn, rec1.irn.irn); assert.ok(r.json.notes.length); assert.strictEqual(generateCalls(), n);
  });
  await test('two phones at the same moment: one IRN, one IRP call', async () => {
    const d = mkDoc('HGI/8/26-27'); const n = generateCalls();
    const [a, b] = await Promise.all([1, 2].map(() => api('POST', '/v1/edoc/generate', { doc: d, company, mode: 'irn' }, U.session)));
    const ok = [a, b].filter(x => x.status === 200);
    assert.ok(ok.length >= 1, a.text + b.text);
    [a, b].filter(x => x.status !== 200).forEach(x => assert.strictEqual(x.json.error, 'EDOC_BUSY'));
    if (ok.length === 2) assert.strictEqual(a.json.record.irn.irn, b.json.record.irn.irn);
    assert.strictEqual(generateCalls(), n + 1);
  });
  await test('answer lost on the way back → error, nothing recorded; retry recovers the same IRN from the IRP (duplicate 2150)', async () => {
    const d = mkDoc('HGI/9/26-27');
    sim.knobs.dropNext = /^POST \/eicore\/v1\.03\/Invoice$/;
    const lost = await api('POST', '/v1/edoc/generate', { doc: d, company, mode: 'irn' }, U.session);
    assert.ok(lost.status >= 500, lost.text); assert.ok(!/[0-9a-f]{64}/.test(lost.text));
    const atIrp = [...sim.irns.values()].find(x => JSON.parse(Buffer.from(x.SignedQRCode.split('.')[1], 'base64url').toString()).data.includes('HGI/9/26-27'));
    assert.ok(atIrp, 'the IRP did register it');
    const st = await api('GET', '/v1/edoc/record?key=' + encodeURIComponent(`${SELLER}|INV|HGI/9/26-27|26-27`), undefined, U.session);
    assert.strictEqual(st.status, 404, 'no IRN recorded from a lost answer');
    const again = await api('POST', '/v1/edoc/generate', { doc: d, company, mode: 'irn' }, U.session);
    assert.strictEqual(again.status, 200, again.text); assert.strictEqual(again.json.recovered, true); assert.strictEqual(again.json.record.irn.irn, atIrp.Irn); assert.ok(again.json.record.irn.signedQr);
  });
  await test('IRP rejection is passed on with its error code; nothing recorded', async () => {
    sim.knobs.failNext = { match: /^POST \/eicore\/v1\.03\/Invoice$/, body: { Status: 0, ErrorDetails: [{ ErrorCode: '2211', ErrorMessage: 'The pincode of the buyer does not belong to the state' }] } };
    const r = await api('POST', '/v1/edoc/generate', { doc: mkDoc('HGI/10/26-27'), company, mode: 'irn' }, U.session);
    assert.strictEqual(r.status, 422); assert.strictEqual(r.json.error, 'IRP_REJECTED'); assert.strictEqual(r.json.errors[0].code, '2211');
    assert.strictEqual((await api('GET', '/v1/edoc/record?key=' + encodeURIComponent(`${SELLER}|INV|HGI/10/26-27|26-27`), undefined, U.session)).status, 404);
  });

  console.log('E-invoice & e-way bill: status and cancellation');
  await test('status refresh asks the government systems', async () => {
    const r = await api('POST', '/v1/edoc/refresh', { key: rec1.key }, U.session);
    assert.strictEqual(r.status, 200, r.text); assert.strictEqual(r.json.record.irn.status, 'ACT'); assert.strictEqual(r.json.record.ewb.status, 'ACT'); assert.ok(r.json.record.ewb.checkedAt);
  });
  await test('IRN cannot be cancelled while its e-way bill is active', async () => {
    const r = await api('POST', '/v1/edoc/cancel-irn', { key: rec1.key, reasonCode: '2', remark: 'Data entry mistake' }, U.session);
    assert.strictEqual(r.status, 409); assert.strictEqual(r.json.error, 'EWB_ACTIVE');
  });
  await test('cancel e-way bill, then IRN; the cancelled number can never get a new IRN', async () => {
    const e = await api('POST', '/v1/edoc/cancel-ewb', { key: rec1.key, reasonCode: '3', remark: 'Data entry mistake' }, U.session);
    assert.strictEqual(e.status, 200, e.text); assert.strictEqual(e.json.record.ewb.status, 'CNL');
    const i = await api('POST', '/v1/edoc/cancel-irn', { key: rec1.key, reasonCode: '2', remark: 'Data entry mistake' }, U.session);
    assert.strictEqual(i.status, 200, i.text); assert.strictEqual(i.json.record.irn.status, 'CNL'); assert.strictEqual(sim.irns.get(rec1.irn.irn).Status, 'CNL');
    const again = await api('POST', '/v1/edoc/generate', { doc: D1, company, mode: 'irn' }, U.session);
    assert.strictEqual(again.status, 409); assert.strictEqual(again.json.error, 'IRN_CANCELLED_NUMBER');
  });
  await test('cancellation after 24 hours is refused (credit note instead)', async () => {
    sim.knobs.ackShiftMs = -25 * 3600e3;
    const d = mkDoc('HGI/11/26-27', { transport: {} });
    const r = await api('POST', '/v1/edoc/generate', { doc: d, company, mode: 'irn' }, U.session); sim.knobs.ackShiftMs = 0;
    assert.strictEqual(r.status, 200, r.text);
    const c = await api('POST', '/v1/edoc/cancel-irn', { key: r.json.record.key, reasonCode: '4', remark: 'Order cancelled' }, U.session);
    assert.strictEqual(c.status, 409); assert.strictEqual(c.json.error, 'CANCEL_WINDOW_OVER');
  });
  await test('records are private to the account', async () => {
    assert.strictEqual((await api('GET', '/v1/edoc/record?key=' + encodeURIComponent(rec1.key), undefined, V.session)).status, 404);
    assert.strictEqual((await api('POST', '/v1/edoc/cancel-ewb', { key: rec1.key, reasonCode: '1', remark: 'x' }, V.session)).status, 412);
  });

  console.log('E-invoice & e-way bill: separate e-way bill (no IRN)');
  const B2C = mkDoc('HGI/12/26-27', { supplyType: 'B2C', buyerGstin: '', pos: '24', buyerStateCode: '24', buyerState: 'Gujarat', buyerAddress: 'Satellite, Ahmedabad', buyerPin: '380015' });
  let k2;
  await test('B2C invoice: e-way bill through the e-way bill system (ACCESSTOKEN, SEK, GENEWAYBILL); IRN refused', async () => {
    const no = await api('POST', '/v1/edoc/generate', { doc: B2C, company, mode: 'irn+ewb' }, U.session);
    assert.strictEqual(no.status, 422);
    const r = await api('POST', '/v1/edoc/generate', { doc: B2C, company, mode: 'ewb' }, U.session);
    assert.strictEqual(r.status, 200, r.text); assert.strictEqual(r.json.record.ewb.via, 'EWB'); assert.ok(sim.ewbs.has(r.json.record.ewb.ewbNo)); assert.strictEqual(r.json.record.irn, null);
    k2 = r.json.record.key;
    const again = await api('POST', '/v1/edoc/generate', { doc: B2C, company, mode: 'ewb' }, U.session);
    assert.strictEqual(again.json.record.ewb.ewbNo, r.json.record.ewb.ewbNo, 'no second e-way bill');
  });
  await test('Part-B vehicle update, transporter update, status with rek + HMAC check', async () => {
    const p = await api('POST', '/v1/edoc/partb', { key: k2, vehicleNo: 'GJ01XY9999', fromPlace: 'Ahmedabad', fromState: '24', reasonCode: '2', reasonRem: 'Transshipment', transMode: '1' }, U.session);
    assert.strictEqual(p.status, 200, p.text); assert.strictEqual(p.json.record.ewb.partB.length, 1);
    const bad = await api('POST', '/v1/edoc/partb', { key: k2, vehicleNo: 'X', fromPlace: 'Ahmedabad', fromState: '24', reasonCode: '2', transMode: '1' }, U.session);
    assert.strictEqual(bad.status, 422);
    const t = await api('POST', '/v1/edoc/transporter', { key: k2, transporterId: gstin('24AABCV1234L1Z') }, U.session);
    assert.strictEqual(t.status, 200, t.text);
    const s = await api('POST', '/v1/edoc/refresh', { key: k2 }, U.session);
    assert.strictEqual(s.status, 200, s.text); assert.strictEqual(s.json.record.ewb.vehicles.length, 2); assert.deepStrictEqual(s.json.notes, []);
  });
  await test('cancel the e-way bill', async () => {
    const c = await api('POST', '/v1/edoc/cancel-ewb', { key: k2, reasonCode: '2', remark: 'Order cancelled' }, U.session);
    assert.strictEqual(c.status, 200, c.text); assert.strictEqual(sim.ewbs.get(c.json.record.ewb.ewbNo).status, 'CNL');
  });
  await test('IRN first, e-way bill later (separate steps, by IRN)', async () => {
    const d = mkDoc('HGI/13/26-27');
    const i = await api('POST', '/v1/edoc/generate', { doc: d, company, mode: 'irn' }, U.session);
    assert.strictEqual(i.status, 200, i.text); assert.strictEqual(i.json.record.ewb, null);
    const e = await api('POST', '/v1/edoc/generate', { doc: d, company, mode: 'ewb' }, U.session);
    assert.strictEqual(e.status, 200, e.text); assert.strictEqual(e.json.record.ewb.via, 'IRP'); assert.strictEqual(e.json.record.irn.irn, i.json.record.irn.irn);
  });
  await test('removing the API login stops further calls', async () => {
    assert.strictEqual((await api('DELETE', '/v1/edoc/credentials/' + SELLER, undefined, U.session)).status, 200);
    assert.strictEqual((await api('POST', '/v1/edoc/refresh', { key: k2 }, U.session)).status, 412);
    assert.strictEqual((await api('PUT', '/v1/edoc/credentials/' + SELLER, { irpUser: 'testuser', irpPass: 'testpass', ewbUser: 'ewbuser', ewbPass: 'ewbpass' }, U.session)).status, 200);
  });
  await test('account deletion removes e-invoice records and API logins', async () => {
    const d = await api('DELETE', '/v1/account', undefined, U.session);
    assert.strictEqual(d.status, 200, d.text);
    if (!EMU) assert.ok(![...g.docs.keys()].some(n => n.includes(`/users/${U.user.key}/`)));
  });

  server.close(); sim.server.close();
};
