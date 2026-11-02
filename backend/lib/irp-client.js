'use strict';
/**
 * NIC e-Invoice (IRP) client — works with the NIC sandbox / production IRP directly,
 * and with GSPs that expose NIC-identical "pass-through" endpoints (configure
 * IRP_BASE_URL and any extra GSP headers in IRP_EXTRA_HEADERS).
 *
 * Auth (v1.04): Data = RSA( base64(JSON{UserName,Password,AppKey,ForceRefreshAccessToken}) )
 * Response: AuthToken + Sek (AES-256-ECB encrypted with AppKey). Token ~6h (1h on sandbox).
 */
const crypto = require('crypto');
const { loadPublicKey, rsaEncrypt, aesEncrypt, aesDecrypt, parsePayload } = require('./nic-crypto');
const { ApiError, requestJson } = require('./nic-http');

const AUTH_ERROR_CODES = new Set(['1005', '1004', '1006', '1007', '1008', '1010', '1016']);

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(vars[k] ?? ''));
}

function normaliseErrors(resp) {
  let list = resp.ErrorDetails || resp.errorDetails || resp.error || [];
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = [{ ErrorMessage: list }]; } }
  if (!Array.isArray(list)) list = [list];
  return list.map(e => ({ code: String(e.ErrorCode ?? e.errorCode ?? e.code ?? ''), message: String(e.ErrorMessage ?? e.errorMessage ?? e.message ?? 'Unknown error') }));
}

class IrpClient {
  constructor(cfg, { timeoutMs = 30000, logger = () => {} } = {}) {
    this.cfg = cfg;
    this.timeoutMs = timeoutMs;
    this.log = logger;
    this.publicKey = cfg.publicKeyObj || loadPublicKey(cfg.publicKey);
    this.session = null;          // { token, sek(Buffer), expiresAt(ms) }
    this.authInFlight = null;
  }

  baseHeaders() {
    return { client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, Gstin: this.cfg.gstin, ...this.cfg.extraHeaders };
  }

  async authenticate(force = false) {
    if (!force && this.session && Date.now() < this.session.expiresAt) return this.session;
    if (this.authInFlight) return this.authInFlight;
    this.authInFlight = (async () => {
      const appKey = crypto.randomBytes(32);
      const payload = JSON.stringify({ UserName: this.cfg.username, Password: this.cfg.password, AppKey: appKey.toString('base64'), ForceRefreshAccessToken: !!force });
      const plain = this.cfg.authPayload === 'json' ? Buffer.from(payload) : Buffer.from(Buffer.from(payload).toString('base64'));
      const { json } = await requestJson('POST', this.cfg.baseUrl + this.cfg.paths.auth, {
        headers: this.baseHeaders(), body: { Data: rsaEncrypt(this.publicKey, plain) }, timeoutMs: this.timeoutMs
      });
      if (String(json.Status) !== '1') {
        const errors = normaliseErrors(json);
        throw new ApiError('IRP login failed: ' + errors.map(e => `${e.code} ${e.message}`).join('; '), { status: 502, code: 'IRP_AUTH_FAILED', errors });
      }
      const d = json.Data || {};
      if (!d.AuthToken || !d.Sek) throw new ApiError('IRP login response missing AuthToken/Sek', { code: 'IRP_AUTH_FAILED' });
      const sek = aesDecrypt(appKey, d.Sek);
      if (sek.length !== 32) throw new ApiError('Decrypted SEK has unexpected length — check IRP_AUTH_PAYLOAD / public key', { code: 'IRP_AUTH_FAILED' });
      // Refresh 10 minutes before expiry; sandbox tokens last ~1h, production ~6h.
      const expiry = parseNicDateTime(d.TokenExpiry);
      const fallback = Date.now() + (this.cfg.env === 'production' ? 6 : 1) * 3600e3;
      this.session = { token: d.AuthToken, sek, expiresAt: (expiry || fallback) - 10 * 60e3, userName: d.UserName || this.cfg.username };
      this.log({ event: 'irp.auth', ok: true, env: this.cfg.env });
      return this.session;
    })();
    try { return await this.authInFlight; } finally { this.authInFlight = null; }
  }

  /** Encrypted call. payload=null for GET. Returns { data, info } */
  async call(method, path, payload = null, { action, retry = true } = {}) {
    const s = await this.authenticate();
    const headers = { ...this.baseHeaders(), user_name: s.userName, AuthToken: s.token };
    let body;
    if (payload !== null) {
      const enc = aesEncrypt(s.sek, Buffer.from(JSON.stringify(payload)));
      body = action ? { action, Data: enc } : { Data: enc };
    }
    const { httpStatus, json } = await requestJson(method, this.cfg.baseUrl + path, { headers, body, timeoutMs: this.timeoutMs });
    if (String(json.Status ?? json.status) === '1') {
      let data = json.Data ?? json.data;
      if (typeof data === 'string' && data) data = parsePayload(aesDecrypt(s.sek, data));
      return { data, info: json.InfoDtls || json.info };
    }
    const errors = normaliseErrors(json);
    if (retry && (httpStatus === 401 || httpStatus === 403 || errors.some(e => AUTH_ERROR_CODES.has(e.code)))) {
      await this.authenticate(true);
      return this.call(method, path, payload, { action, retry: false });
    }
    const err = new ApiError(errors.map(e => `${e.code ? e.code + ': ' : ''}${e.message}`).join('; ') || `IRP error (HTTP ${httpStatus})`,
      { status: 422, code: 'IRP_REJECTED', errors, info: json.InfoDtls });
    throw err;
  }

  generateIrn(invoiceJson) { return this.call('POST', this.cfg.paths.generate, invoiceJson); }
  cancelIrn(irn, reasonCode, remark) { return this.call('POST', this.cfg.paths.cancel, { Irn: irn, CnlRsn: String(reasonCode), CnlRem: remark }); }
  getByIrn(irn) { return this.call('GET', fill(this.cfg.paths.getByIrn, { irn })); }
  getByDoc(doctype, docnum, docdate) { return this.call('GET', fill(this.cfg.paths.getByDoc, { doctype, docnum, docdate })); }
  generateEwbByIrn(body) { return this.call('POST', this.cfg.paths.ewbGenerate, body); }
  getEwbByIrn(irn) { return this.call('GET', fill(this.cfg.paths.ewbGetByIrn, { irn })); }
  cancelEwb(ewbNo, reasonCode, remark) {
    return this.call('POST', this.cfg.paths.ewbCancel, { ewbNo: Number(ewbNo), cancelRsnCode: Number(reasonCode), cancelRmrk: remark }, { action: 'CANEWB' });
  }
  gstinDetails(gstin) { return this.call('GET', fill(this.cfg.paths.gstin, { gstin })); }
}

/** NIC dates come as "2026-10-21 17:45:00" (IRP) or "21/10/2026 05:45:00 PM" (EWB) in IST. Returns epoch ms or null. */
function parseNicDateTime(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+05:30`);
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (m) {
    let h = parseInt(m[4] || '0', 10);
    if (m[7]) { const pm = m[7].toUpperCase() === 'PM'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return Date.parse(`${m[3]}-${m[2]}-${m[1]}T${String(h).padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}+05:30`);
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

module.exports = { IrpClient, parseNicDateTime, normaliseErrors };
