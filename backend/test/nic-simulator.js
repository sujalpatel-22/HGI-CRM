'use strict';
/**
 * ============================  TEST-ONLY  ============================
 * Local simulator of the NIC IRP / e-Way Bill *protocol* (RSA login, SEK, AES-ECB payloads,
 * rek/hmac). It exists only so the automated tests can prove the backend's encryption and
 * request flow work end-to-end without real credentials. Everything it returns is marked
 * as TEST data, it only listens on 127.0.0.1, and the backend refuses to talk to it unless
 * IRP_ENV/EWB_ENV=test and ALLOW_TEST_SIMULATOR=true. NEVER use its output on a real invoice.
 * =====================================================================
 */
const http = require('http');
const crypto = require('crypto');

function pkcs1Decrypt(privateKey, b64) {
  const raw = crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_NO_PADDING }, Buffer.from(b64, 'base64'));
  if (raw[0] !== 0 || raw[1] !== 2) throw new Error('bad padding');
  return raw.subarray(raw.indexOf(0, 2) + 1);
}
const aesEnc = (k, b) => { const c = crypto.createCipheriv('aes-256-ecb', k, null); return Buffer.concat([c.update(b), c.final()]).toString('base64'); };
const aesDec = (k, s) => { const d = crypto.createDecipheriv('aes-256-ecb', k, null); return Buffer.concat([d.update(Buffer.from(s, 'base64')), d.final()]); };
const nowIst = (addMs = 0) => { const d = new Date(Date.now() + addMs + 5.5 * 3600e3); return d.toISOString().replace('T', ' ').slice(0, 19); };
const nowEwb = (addMs = 0) => {
  const d = new Date(Date.now() + addMs + 5.5 * 3600e3);
  const p = n => String(n).padStart(2, '0'); let h = d.getUTCHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(h)}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${ap}`;
};

function startSimulator({ port = 0 } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sessions = new Map();   // token -> sek
  const irns = new Map();       // irn -> record
  const ewbs = new Map();
  const calls = [];
  const knobs = { dropNext: null, failNext: null, ackShiftMs: 0 };   // test controls: lose one answer, inject one rejection, back-date acknowledgements
  let ewbSeq = 391000000000;

  const sign = obj => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', note: 'HGI LOCAL TEST SIMULATOR - NOT A GOVERNMENT DOCUMENT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ iss: 'HGI-LOCAL-TEST-SIMULATOR', data: JSON.stringify(obj) })).toString('base64url');
    const s = crypto.sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
    return `${h}.${p}.${s}`;
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const j = body ? JSON.parse(body) : {};
      calls.push({ method: req.method, path: u.pathname, headers: req.headers });
      const out = (o) => {
        if (knobs.dropNext && knobs.dropNext.test(req.method + ' ' + u.pathname)) { knobs.dropNext = null; res.writeHead(502, { 'Content-Type': 'text/html' }); return res.end('<html>Bad gateway</html>'); }  // processed, answer lost
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o));
      };
      if (knobs.failNext && knobs.failNext.match.test(req.method + ' ' + u.pathname)) { const f = knobs.failNext; knobs.failNext = null; res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(f.body)); }
      const irpErr = (code, msg, info) => out({ Status: 0, ErrorDetails: [{ ErrorCode: code, ErrorMessage: msg }], InfoDtls: info || null });
      try {
        /* ---------------- IRP ---------------- */
        if (u.pathname === '/eivital/v1.04/auth') {
          if (!req.headers.client_id || !req.headers.client_secret || !req.headers.gstin) return irpErr('1001', 'Missing client headers');
          const plain = pkcs1Decrypt(privateKey, j.Data).toString();
          const p = JSON.parse(Buffer.from(plain, 'base64').toString());
          if (p.UserName !== 'testuser' || p.Password !== 'testpass') return irpErr('1004', 'Invalid user name or password');
          const sek = crypto.randomBytes(32), token = crypto.randomBytes(12).toString('hex');
          sessions.set(token, sek);
          return out({ Status: 1, Data: { ClientId: req.headers.client_id, UserName: p.UserName, AuthToken: token, Sek: aesEnc(Buffer.from(p.AppKey, 'base64'), sek), TokenExpiry: nowIst(3600e3) } });
        }
        const irpSek = sessions.get(req.headers.authtoken);
        const irpPaths = ['/eicore', '/eiewb', '/eivital/v1.03', '/ewaybillapi/v1.03/ewayapi'];
        if (irpPaths.some(p => u.pathname.startsWith(p)) && req.headers.client_id) {
          if (!irpSek) return irpErr('1005', 'Invalid Token');
          const dec = () => JSON.parse(aesDec(irpSek, j.Data).toString());
          const ok = (data, info) => out({ Status: 1, Data: aesEnc(irpSek, Buffer.from(JSON.stringify(data))), InfoDtls: info || null });
          if (req.method === 'POST' && u.pathname === '/eicore/v1.03/Invoice') {
            const inv = dec();
            if (!/^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$/.test(inv.DocDtls.No)) return irpErr('2283', 'Invalid document number format');
            const ass = inv.ItemList.reduce((a, i) => a + i.AssAmt, 0);
            if (Math.abs(ass - inv.ValDtls.AssVal) > 1) return irpErr('2172', 'Assessable value does not match sum of items');
            const irn = crypto.createHash('sha256').update(`${req.headers.gstin}${inv.DocDtls.Dt.slice(-4)}${inv.DocDtls.Typ}${inv.DocDtls.No}`).digest('hex');
            if (irns.has(irn)) return irpErr('2150', 'Duplicate IRN', [{ InfCd: 'DUPIRN', Desc: { AckNo: irns.get(irn).AckNo, AckDt: irns.get(irn).AckDt, Irn: irn } }]);
            const rec = { AckNo: 112010000000000 + irns.size, AckDt: nowIst(knobs.ackShiftMs), Irn: irn, Status: 'ACT', SignedInvoice: sign(inv),
              SignedQRCode: sign({ SellerGstin: inv.SellerDtls.Gstin, BuyerGstin: inv.BuyerDtls.Gstin, DocNo: inv.DocDtls.No, DocTyp: inv.DocDtls.Typ, DocDt: inv.DocDtls.Dt, TotInvVal: inv.ValDtls.TotInvVal, ItemCnt: inv.ItemList.length, Irn: irn, TEST: true }),
              EwbNo: null, EwbDt: null, EwbValidTill: null, Remarks: 'TEST SIMULATOR' };
            if (inv.EwbDtls && (inv.EwbDtls.VehNo || inv.EwbDtls.TransId)) { rec.EwbNo = ++ewbSeq; rec.EwbDt = nowIst(); rec.EwbValidTill = nowIst(86400e3); ewbs.set(String(rec.EwbNo), { status: 'ACT', irn }); }
            irns.set(irn, rec);
            return ok(rec);
          }
          if (req.method === 'POST' && u.pathname === '/eicore/v1.03/Invoice/Cancel') {
            const c = dec(); const r = irns.get(c.Irn);
            if (!r) return irpErr('2154', 'IRN not found');
            if (r.Status === 'CNL') return irpErr('9999', 'IRN already cancelled');
            if (r.EwbNo && ewbs.get(String(r.EwbNo)).status === 'ACT') return irpErr('2230', 'IRN cannot be cancelled, e-way bill is active');
            r.Status = 'CNL'; return ok({ Irn: c.Irn, CancelDate: nowIst() });
          }
          let m;
          if (req.method === 'GET' && (m = u.pathname.match(/^\/eicore\/v1\.03\/Invoice\/irn\/([0-9a-f]{64})$/))) { const r = irns.get(m[1]); return r ? ok(r) : irpErr('2283', 'IRN details not found'); }
          if (req.method === 'POST' && u.pathname === '/eiewb/v1.03/ewaybill') {
            const b = dec(); const r = irns.get(b.Irn); if (!r) return irpErr('4002', 'IRN not found');
            if (r.EwbNo && ewbs.get(String(r.EwbNo)).status === 'ACT') return irpErr('4009', 'E-way bill already generated');
            r.EwbNo = ++ewbSeq; r.EwbDt = nowIst(knobs.ackShiftMs); r.EwbValidTill = nowIst(86400e3); ewbs.set(String(r.EwbNo), { status: 'ACT', irn: b.Irn });
            return ok({ EwbNo: r.EwbNo, EwbDt: r.EwbDt, EwbValidTill: r.EwbValidTill, Remarks: 'TEST SIMULATOR' });
          }
          if (req.method === 'GET' && (m = u.pathname.match(/^\/eiewb\/v1\.03\/ewaybill\/irn\/([0-9a-f]{64})$/))) {
            const r = irns.get(m[1]); if (!r || !r.EwbNo) return irpErr('4013', 'No e-way bill');
            return ok({ EwbNo: r.EwbNo, Status: ewbs.get(String(r.EwbNo)).status, GenGstin: req.headers.gstin, EwbDt: r.EwbDt, EwbValidTill: r.EwbValidTill });
          }
          if (req.method === 'POST' && u.pathname === '/ewaybillapi/v1.03/ewayapi' && j.action === 'CANEWB') {
            const c = dec(); const e = ewbs.get(String(c.ewbNo)); if (!e) return irpErr('312', 'Invalid EWB'); e.status = 'CNL';
            return ok({ ewayBillNo: c.ewbNo, cancelDate: nowEwb() });
          }
          if (req.method === 'GET' && (m = u.pathname.match(/^\/eivital\/v1\.03\/Master\/gstin\/([0-9A-Z]{15})$/)))
            return ok({ Gstin: m[1], TradeName: 'TEST TRADER (SIMULATOR)', LegalName: 'TEST LEGAL NAME (SIMULATOR)', AddrBno: '12', AddrSt: 'Test Road', AddrLoc: 'Pune', StateCode: Number(m[1].slice(0, 2)), AddrPncd: 411026, TxpType: 'REG', Status: 'ACT', BlkStatus: 'U' });
          return irpErr('404', 'Unknown IRP path ' + u.pathname);
        }

        /* ---------------- EWB system ---------------- */
        if (u.pathname === '/ewaybillapi/v1.03/auth') {
          const pwd = pkcs1Decrypt(privateKey, j.password).toString();
          const appKey = pkcs1Decrypt(privateKey, j.app_key);
          if (j.action !== 'ACCESSTOKEN' || j.username !== 'ewbuser' || pwd !== 'ewbpass') return out({ status: '0', error: Buffer.from(JSON.stringify({ errorCodes: '108' })).toString('base64') });
          const sek = crypto.randomBytes(32), token = crypto.randomBytes(10).toString('hex');
          sessions.set('ewb:' + token, sek);
          return out({ status: '1', authtoken: token, sek: aesEnc(appKey, sek) });
        }
        const ewbSek = sessions.get('ewb:' + req.headers.authtoken);
        if (u.pathname.startsWith('/ewaybillapi/v1.03/ewayapi')) {
          if (!ewbSek) return out({ status: '0', error: Buffer.from(JSON.stringify({ errorCodes: '238' })).toString('base64') });
          const ok = d => out({ status: '1', data: aesEnc(ewbSek, Buffer.from(JSON.stringify(d))) });
          const err = c => out({ status: '0', error: Buffer.from(JSON.stringify({ errorCodes: c })).toString('base64') });
          if (req.method === 'GET') {
            const no = u.searchParams.get('ewbNo'); const e = ewbs.get(no); if (!e) return err('601');
            const rek = crypto.randomBytes(32), data = Buffer.from(JSON.stringify({ ewbNo: Number(no), status: e.status, validUpto: e.validUpto, VehiclListDetails: e.vehicles || [], TEST: true }));
            return out({ status: '1', data: aesEnc(rek, data), rek: aesEnc(ewbSek, rek), hmac: crypto.createHmac('sha256', rek).update(data).digest('base64') });
          }
          const p = JSON.parse(aesDec(ewbSek, j.data).toString());
          if (j.action === 'GENEWAYBILL') {
            if (!p.fromGstin || !p.toPincode || !Array.isArray(p.itemList)) return err('201');
            const no = String(++ewbSeq); ewbs.set(no, { status: 'ACT', validUpto: nowEwb(86400e3), vehicles: p.vehicleNo ? [{ vehicleNo: p.vehicleNo, fromPlace: p.fromPlace, enteredDate: nowEwb() }] : [] });
            return ok({ ewayBillNo: Number(no), ewayBillDate: nowEwb(knobs.ackShiftMs), validUpto: p.vehicleNo ? nowEwb(86400e3) : null, alert: 'TEST SIMULATOR' });
          }
          if (j.action === 'CANEWB') { const e = ewbs.get(String(p.ewbNo)); if (!e) return err('601'); if (e.status === 'CNL') return err('604'); e.status = 'CNL'; return ok({ ewayBillNo: p.ewbNo, cancelDate: nowEwb() }); }
          if (j.action === 'VEHEWB') { const e = ewbs.get(String(p.ewbNo)); if (!e) return err('601'); e.vehicles = [...(e.vehicles || []), { vehicleNo: p.vehicleNo, fromPlace: p.fromPlace, enteredDate: nowEwb() }]; e.validUpto = nowEwb(86400e3); return ok({ vehUpdDate: nowEwb(), validUpto: e.validUpto }); }
          if (j.action === 'UPDATETRANSPORTER') { const e = ewbs.get(String(p.ewbNo)); if (!e) return err('601'); return ok({ ewayBillNo: p.ewbNo, transporterId: p.transporterId, transUpdateDate: nowEwb() }); }
          return err('999');
        }
        res.writeHead(404); res.end('{}');
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ Status: 0, status: '0', ErrorDetails: [{ ErrorCode: '9999', ErrorMessage: 'Simulator: ' + e.message }] }));
      }
    });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, port: server.address().port, publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }), calls, irns, ewbs, knobs })));
}

module.exports = { startSimulator };
