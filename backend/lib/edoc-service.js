'use strict';
/**
 * E-invoice (IRN) and e-way bill lifecycle for every signed-in business, through the government APIs
 * (NIC IRP and NIC e-way bill system, directly or through the GSP's NIC-identical pass-through endpoints).
 *
 *  - IRN / e-way bill numbers, acknowledgement numbers and signed QR codes come ONLY from the government API's answer.
 *    Nothing here makes one up. If the API is not configured or the call fails, the app gets an error, never a number.
 *  - A document can never get two IRNs or two active e-way bills: per-document lease, stored record, and recovery of
 *    the existing IRN when the IRP answers "duplicate IRN" (error 2150).
 *  - The server recalculates the totals and refuses a document whose numbers differ from the app's.
 *  - Cancellation rules: IRN and e-way bill only within 24 hours; an IRN only after its e-way bill is cancelled.
 *  - Each business uses its own API login (CredentialVault); HGI's GSP client ID / secret stay in Secret Manager.
 */
const { ApiError } = require('./nic-http');
const { IrpClient, parseNicDateTime } = require('./irp-client');
const { EwbClient } = require('./ewb-client');
const { loadPublicKey } = require('./nic-crypto');
const { buildIrpPayload, buildEwbPayload, buildEwbByIrnBody, docKey, transportOf, VEH_RE, TRANSID_RE } = require('./einvoice-mapper');
const { STATES, ddmmyyyy } = require('./gst-calc');

const H24 = 24 * 3600e3;
const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/;
const isoOrNull = s => { const t = parseNicDateTime(s); return t ? new Date(t).toISOString() : null; };
const MODES = new Set(['irn', 'irn+ewb', 'ewb']);

class EdocService {
  /** cfg = config.edoc; vault = CredentialVault; store = EdocStore */
  constructor(cfg, { vault, store, log = () => {}, timeoutMs = 30000 }) {
    this.cfg = cfg; this.vault = vault; this.store = store; this.log = log; this.timeoutMs = timeoutMs;
    this.cache = new Map();
    this.keys = {};
    for (const k of ['irp', 'ewb']) if (cfg[k] && cfg[k].publicKey) { try { this.keys[k] = loadPublicKey(cfg[k].publicKey); } catch (e) { this.keys[k] = null; this.keyError = `${k.toUpperCase()}_PUBLIC_KEY could not be read: ${e.message}`; } }
  }

  /* ------------------------------------------------------------ set-up state */
  irpReady() { return !!(this.vault.enabled() && this.cfg.irp.baseUrl && this.cfg.irp.clientId && this.cfg.irp.clientSecret && this.keys.irp); }
  ewbReady() { return !!(this.vault.enabled() && this.cfg.ewb.baseUrl && this.cfg.ewb.clientId && this.cfg.ewb.clientSecret && this.keys.ewb); }
  features() { return { irp: this.irpReady(), ewb: this.ewbReady(), env: this.cfg.env || null }; }
  notReady(which) {
    return new ApiError(which === 'irp'
      ? 'E-invoice (IRP) access is not set up on the HGI server yet. Nothing was sent to the GST system.'
      : 'E-way bill system access is not set up on the HGI server yet. Nothing was sent to the GST system.', { status: 503, code: which === 'irp' ? 'IRP_NOT_CONFIGURED' : 'EWB_NOT_CONFIGURED' });
  }

  clientCfg(which, cred) {
    const c = this.cfg[which];
    const base = { env: this.cfg.env, baseUrl: c.baseUrl, clientId: c.clientId, clientSecret: c.clientSecret, gstin: cred.gstin, extraHeaders: c.extraHeaders || {},
      paths: c.paths, publicKeyObj: this.keys[which] };
    return which === 'irp'
      ? { ...base, username: cred.secret.irpUser, password: cred.secret.irpPass, authPayload: c.authPayload || 'base64json' }
      : { ...base, username: cred.secret.ewbUser, password: cred.secret.ewbPass, appKeyRsaInput: c.appKeyRsaInput || 'raw', dataEncoding: c.dataEncoding || 'json' };
  }
  /** API clients for one business (cached so the NIC session token is reused for its lifetime) */
  async clients(uid, gstin) {
    if (!this.irpReady() && !this.ewbReady()) throw new ApiError('E-invoice and e-way bill access is not set up on the HGI server yet. Nothing was sent to the GST system.', { status: 503, code: 'EDOC_NOT_CONFIGURED' });
    gstin = String(gstin || '').toUpperCase();
    if (!GSTIN_RE.test(gstin)) throw new ApiError('Add your GSTIN in Settings → Company first.', { status: 400, code: 'NO_GSTIN' });
    const cred = await this.vault.get(uid, gstin);
    if (!cred) throw new ApiError(`No e-invoice / e-way bill API login saved for GSTIN ${gstin}. Add it in Settings → E-Invoice & E-Way Bill.`, { status: 412, code: 'NO_CREDENTIALS' });
    if (cred.broken) throw new ApiError('The saved API login could not be read. Enter it again in Settings → E-Invoice & E-Way Bill.', { status: 412, code: 'NO_CREDENTIALS' });
    if (cred.env !== this.cfg.env) throw new ApiError(`The saved API login is for the ${cred.env} system, but the server now uses ${this.cfg.env}. Enter the ${this.cfg.env} login in Settings → E-Invoice & E-Way Bill.`, { status: 412, code: 'CREDENTIALS_ENV' });
    const k = `${uid}|${gstin}|${cred.updatedAt}`;
    let c = this.cache.get(k);
    if (!c) {
      const logger = e => this.log({ ...e, user: uid });
      c = {
        gstin,
        irp: this.irpReady() && cred.secret.irpUser ? new IrpClient(this.clientCfg('irp', cred), { timeoutMs: this.timeoutMs, logger }) : null,
        ewb: this.ewbReady() && cred.secret.ewbUser ? new EwbClient(this.clientCfg('ewb', cred), { timeoutMs: this.timeoutMs, logger }) : null
      };
      this.cache.set(k, c);
      if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
    }
    return c;
  }
  requireIrp(c) {
    if (!this.irpReady()) throw this.notReady('irp');
    if (!c.irp) throw new ApiError('No e-invoice (IRP) API login is saved for this GSTIN. Add it in Settings → E-Invoice & E-Way Bill.', { status: 412, code: 'NO_CREDENTIALS' });
  }
  requireEwb(c) {
    if (!this.ewbReady()) throw this.notReady('ewb');
    if (!c.ewb) throw new ApiError('No e-way bill API login is saved for this GSTIN. Add it in Settings → E-Invoice & E-Way Bill.', { status: 412, code: 'NO_CREDENTIALS' });
  }

  /* ------------------------------------------------------------ credentials */
  async saveCredentials(uid, gstin, body) {
    gstin = String(gstin || '').toUpperCase();
    if (!GSTIN_RE.test(gstin)) throw new ApiError('Enter a 15-character GSTIN.', { status: 400, code: 'BAD_GSTIN' });
    if (!this.vault.enabled()) throw new ApiError('Secure storage for API logins is not set up on the server yet (EDOC_CRED_KEY).', { status: 503, code: 'VAULT_NOT_CONFIGURED' });
    const old = await this.vault.get(uid, gstin);
    const keep = old && !old.broken && old.env === this.cfg.env ? old.secret : {};
    const s = String;
    const secret = {
      irpUser: body.irpUser !== undefined ? s(body.irpUser).trim() : (keep.irpUser || ''),
      irpPass: body.irpPass ? s(body.irpPass) : (body.irpUser !== undefined && body.irpUser !== keep.irpUser ? '' : keep.irpPass || ''),
      ewbUser: body.ewbUser !== undefined ? s(body.ewbUser).trim() : (keep.ewbUser || ''),
      ewbPass: body.ewbPass ? s(body.ewbPass) : (body.ewbUser !== undefined && body.ewbUser !== keep.ewbUser ? '' : keep.ewbPass || '')
    };
    for (const [u, p, name] of [['irpUser', 'irpPass', 'e-invoice'], ['ewbUser', 'ewbPass', 'e-way bill']]) {
      if (secret[u] && !secret[p]) throw new ApiError(`Enter the ${name} API password.`, { status: 400, code: 'BAD_CREDENTIALS' });
      if (secret[u].length > 60 || secret[p].length > 100) throw new ApiError('User name or password is too long.', { status: 400, code: 'BAD_CREDENTIALS' });
    }
    if (!secret.irpUser && !secret.ewbUser) throw new ApiError('Enter at least one API user name and password.', { status: 400, code: 'BAD_CREDENTIALS' });
    // log in with them first: a wrong login is never saved
    const verified = {};
    const cred = { gstin, secret };
    if (secret.irpUser) {
      if (!this.irpReady()) throw this.notReady('irp');
      await new IrpClient(this.clientCfg('irp', cred), { timeoutMs: this.timeoutMs }).authenticate(true).catch(e => { if (e.code === 'IRP_AUTH_FAILED') e.status = 422; throw e; });
      verified.irp = new Date().toISOString();
    }
    if (secret.ewbUser) {
      if (!this.ewbReady()) throw this.notReady('ewb');
      await new EwbClient(this.clientCfg('ewb', cred), { timeoutMs: this.timeoutMs }).authenticate(true).catch(e => { if (e.code === 'EWB_AUTH_FAILED') e.status = 422; throw e; });
      verified.ewb = new Date().toISOString();
    }
    const pub = await this.vault.put(uid, gstin, this.cfg.env, secret, verified);
    this.log({ event: 'edoc.credentials_saved', user: uid, gstin, irp: !!verified.irp, ewb: !!verified.ewb, env: this.cfg.env });
    return pub;
  }
  async deleteCredentials(uid, gstin) { await this.vault.remove(uid, String(gstin || '').toUpperCase()); this.log({ event: 'edoc.credentials_deleted', user: uid, gstin }); }
  listCredentials(uid) { return this.vault.list(uid); }

  /* ------------------------------------------------------------ helpers */
  invalid(errors, warnings) {
    return new ApiError('Please fix: ' + errors.map(e => e.message).join(' | '), { status: 422, code: 'VALIDATION_FAILED', errors: errors.map(e => ({ code: e.field, message: e.message })), info: { warnings } });
  }
  publicRecord(r, full = false) {
    if (!r) return null;
    const irn = r.irn ? { ...r.irn } : null;
    if (irn && !full) delete irn.signedInvoice;
    return { key: r.key, docId: r.docId || '', irn, ewb: r.ewb || null, log: (r.log || []).slice(-30), env: this.cfg.env };
  }
  audit(uid, action, key, ok, err, extra) {
    this.log({ event: 'edoc.' + action, user: uid, key, ok, env: this.cfg.env, ...(extra || {}), ...(err ? { warn: true, error: String(err.message).slice(0, 300), codes: (err.errors || []).map(e => e.code).filter(Boolean) } : {}) });
  }
  async fail(uid, key, action, e) {
    try { await this.store.addLog(uid, key, { action, ok: false, msg: String(e.message).slice(0, 400), env: this.cfg.env }); } catch (x) { /* keep the original error */ }
    this.audit(uid, action.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''), key, false, e);
    throw e;
  }
  check(doc, company) {
    if (!doc || typeof doc !== 'object' || !company || typeof company !== 'object') throw new ApiError('Document and company details are required.', { status: 400, code: 'BAD_REQUEST' });
    company = { ...company, gstin: String(company.gstin || '').toUpperCase() };
    if (!GSTIN_RE.test(company.gstin)) throw new ApiError('Add your GSTIN in Settings → Company first.', { status: 400, code: 'NO_GSTIN' });
    return company;
  }
  /** e-invoicing applies only above ₹5 crore aggregate turnover (the business's own declaration in Settings) */
  eligibility(doc, company) {
    const reasons = [];
    if (company.aato === 'upto5') reasons.push('Your turnover in Settings is "up to ₹5 crore": e-invoicing does not apply, and the IRP accepts IRNs only from GSTINs enabled for e-invoicing. Change it in Settings if your turnover is above ₹5 crore.');
    if (!['INV', 'CRN', 'DBN'].includes(doc.docType)) reasons.push('Only invoices, credit notes and debit notes get an IRN.');
    if (!['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP'].includes(doc.supplyType)) reasons.push('IRN is only for supplies to registered buyers, SEZ, exports and deemed exports — not B2C.');
    const goods = (doc.items || []).some(i => i.hsn && !String(i.hsn).startsWith('99'));
    const ewbReasons = [];
    if (doc.docType !== 'INV') ewbReasons.push('E-way bills from the app are for invoices.');
    if (!goods) ewbReasons.push('E-way bill is only for movement of goods (all items are services).');
    const limit = Number(company.ewbLimit) || 50000;
    return { irn: { ok: !reasons.length, reasons }, ewb: { ok: !ewbReasons.length, reasons: ewbReasons, required: goods && Number(doc.grandTotal) > limit, limit } };
  }

  /* ------------------------------------------------------------ preview (nothing is sent) */
  async preview(uid, doc, company, mode) {
    company = this.check(doc, company);
    if (!MODES.has(mode)) mode = 'irn';
    const el = this.eligibility(doc, company);
    const key = docKey(company, doc);
    const rec = await this.store.get(uid, key);
    const out = { key, eligibility: el, features: this.features(), record: this.publicRecord(rec) };
    if (mode === 'ewb' && !(rec && rec.irn && rec.irn.status === 'ACT')) {
      const r = buildEwbPayload(doc, company, { cfgGstin: company.gstin });
      return { ...out, route: 'EWB', payload: r.payload, errors: [...el.ewb.reasons.map(m => ({ field: 'eligibility', message: m })), ...r.errors], warnings: r.warnings };
    }
    if (mode === 'ewb') {
      const r = buildEwbByIrnBody(rec.irn.irn, doc);
      return { ...out, route: 'IRP', payload: r.body, errors: [...el.ewb.reasons.map(m => ({ field: 'eligibility', message: m })), ...r.errors], warnings: r.warnings };
    }
    const r = buildIrpPayload(doc, company, { cfgGstin: company.gstin, withEwb: mode === 'irn+ewb' });
    const errors = [...el.irn.reasons.map(m => ({ field: 'eligibility', message: m })), ...r.errors];
    if (mode === 'irn+ewb') el.ewb.reasons.forEach(m => errors.push({ field: 'eligibility', message: m }));
    return { ...out, route: 'IRP', payload: r.payload, errors, warnings: r.warnings };
  }

  /* ------------------------------------------------------------ generate (one workflow, combined or separate) */
  async generate(uid, doc, company, mode, by) {
    company = this.check(doc, company);
    if (!MODES.has(mode)) throw new ApiError('mode must be irn, irn+ewb or ewb', { status: 400, code: 'BAD_REQUEST' });
    const c = await this.clients(uid, company.gstin);
    const key = docKey(company, doc);
    const el = this.eligibility(doc, company);
    if (mode !== 'ewb' && !el.irn.ok) throw this.invalid(el.irn.reasons.map(m => ({ field: 'eligibility', message: m })), []);
    if (mode !== 'irn' && !el.ewb.ok) throw this.invalid(el.ewb.reasons.map(m => ({ field: 'eligibility', message: m })), []);
    return this.store.withLock(uid, key, by, async () => {
      const out = { warnings: [], ewbErrors: [], notes: [] };
      if (mode !== 'ewb') {
        const r = await this._irn(uid, c, key, doc, company, mode === 'irn+ewb');
        out.warnings.push(...(r.warnings || [])); out.ewbErrors.push(...(r.ewbErrors || [])); if (r.note) out.notes.push(r.note); out.recovered = !!r.recovered;
      }
      if (mode === 'ewb' || (mode === 'irn+ewb' && !out.ewbErrors.length)) {
        const rec = await this.store.get(uid, key);
        if (!(rec && rec.ewb && rec.ewb.status === 'ACT')) {
          const r = await this._ewb(uid, c, key, doc, company);
          out.warnings.push(...(r.warnings || []));
        } else if (mode === 'ewb') out.notes.push('An active e-way bill already exists for this document — returned the stored one.');
      }
      return { ...out, record: this.publicRecord(await this.store.get(uid, key), true) };
    });
  }

  async _irn(uid, c, key, doc, company, withEwb) {
    this.requireIrp(c);
    const existing = await this.store.get(uid, key);
    if (existing && existing.irn && existing.irn.status === 'ACT') return { note: 'IRN already exists for this document — returned the stored one.' };
    if (existing && existing.irn && existing.irn.status === 'CNL')
      throw new ApiError('The IRN for this document number was cancelled. The IRP never accepts the same number again — create a new invoice with a new number.', { status: 409, code: 'IRN_CANCELLED_NUMBER' });
    const { payload, errors, warnings } = buildIrpPayload(doc, company, { cfgGstin: c.gstin, withEwb });
    if (errors.length) throw this.invalid(errors, warnings);
    let data, info, recovered = false;
    try {
      ({ data, info } = await c.irp.generateIrn(payload));
    } catch (e) {
      const dup = e.errors && e.errors.some(x => x.code === '2150');
      if (!dup) return this.fail(uid, key, 'IRN generate', e);
      // "Duplicate IRN": the IRP already holds this document (e.g. an earlier answer was lost) — fetch that IRN instead
      const dupInfo = (Array.isArray(e.info) ? e.info : []).find(i => i.InfCd === 'DUPIRN');
      const irn = dupInfo && dupInfo.Desc && (dupInfo.Desc.Irn || dupInfo.Desc.irn);
      if (!irn) return this.fail(uid, key, 'IRN generate', e);
      try { ({ data } = await c.irp.getByIrn(irn)); } catch (x) { return this.fail(uid, key, 'IRN recover', x); }
      recovered = true;
    }
    if (!data || !/^[0-9a-f]{64}$/i.test(String(data.Irn || '')) || !data.AckNo || !data.SignedQRCode)
      return this.fail(uid, key, 'IRN generate', new ApiError('The IRP answer did not contain an IRN, acknowledgement and signed QR code. Nothing was recorded; check the e-invoice portal before trying again.', { status: 502, code: 'IRP_BAD_RESPONSE' }));
    const now = new Date().toISOString(), env = this.cfg.env;
    await this.store.update(uid, key, r => {
      r.docId = String(doc.id || r.docId || ''); r.docType = doc.docType; r.num = doc.num; r.date = doc.date; r.buyerGstin = doc.buyerGstin;
      r.irn = { status: data.Status === 'CNL' ? 'CNL' : 'ACT', irn: data.Irn, ackNo: String(data.AckNo), ackDt: data.AckDt, ackAt: isoOrNull(data.AckDt),
        signedQr: data.SignedQRCode, signedInvoice: data.SignedInvoice, env, generatedAt: now, recovered };
      if (data.EwbNo) r.ewb = { status: 'ACT', ewbNo: String(data.EwbNo), ewbDt: data.EwbDt, ewbAt: isoOrNull(data.EwbDt), validUpto: data.EwbValidTill,
        validAt: isoOrNull(data.EwbValidTill), via: 'IRP', env, generatedAt: now, transport: transportOf(doc) };
      return r;
    });
    const ewbErrors = (Array.isArray(info) ? info : []).filter(i => i.InfCd === 'EWBERR').map(i => typeof i.Desc === 'string' ? i.Desc : JSON.stringify(i.Desc));
    await this.store.addLog(uid, key, { action: recovered ? 'IRN recovered (already on the IRP)' : 'IRN generated', ok: true, msg: data.Irn, env });
    if (ewbErrors.length) await this.store.addLog(uid, key, { action: 'E-way bill with IRN', ok: false, msg: ewbErrors.join('; '), env });
    this.audit(uid, 'irn.generate', key, true, null, { ackNo: String(data.AckNo), ewb: !!data.EwbNo, recovered });
    return { warnings, ewbErrors, recovered };
  }

  async _ewb(uid, c, key, doc, company) {
    const r = await this.store.get(uid, key);
    const env = this.cfg.env, now = new Date().toISOString();
    if (r && r.irn && r.irn.status === 'CNL') throw new ApiError('The IRN for this document was cancelled — create a new invoice before moving goods.', { status: 409, code: 'IRN_CANCELLED_NUMBER' });
    if (r && r.irn && r.irn.status === 'ACT') {
      this.requireIrp(c);
      const { body, errors, warnings } = buildEwbByIrnBody(r.irn.irn, doc);
      if (errors.length) throw this.invalid(errors, warnings);
      let data;
      try { ({ data } = await c.irp.generateEwbByIrn(body)); } catch (e) { return this.fail(uid, key, 'E-way bill generate (by IRN)', e); }
      if (!data || !/^\d{12}$/.test(String(data.EwbNo || ''))) return this.fail(uid, key, 'E-way bill generate (by IRN)', new ApiError('The IRP answer did not contain a 12-digit e-way bill number. Nothing was recorded.', { status: 502, code: 'IRP_BAD_RESPONSE' }));
      await this.store.update(uid, key, x => { x.ewb = { status: 'ACT', ewbNo: String(data.EwbNo), ewbDt: data.EwbDt, ewbAt: isoOrNull(data.EwbDt), validUpto: data.EwbValidTill,
        validAt: isoOrNull(data.EwbValidTill), via: 'IRP', env, generatedAt: now, transport: transportOf(doc), remarks: data.Remarks }; return x; });
      await this.store.addLog(uid, key, { action: 'E-way bill generated (by IRN)', ok: true, msg: String(data.EwbNo), env });
      this.audit(uid, 'ewb.generate', key, true, null, { via: 'IRP' });
      return { warnings };
    }
    this.requireEwb(c);
    const { payload, errors, warnings } = buildEwbPayload(doc, company, { cfgGstin: c.gstin });
    if (errors.length) throw this.invalid(errors, warnings);
    let data;
    try { ({ data } = await c.ewb.generate(payload)); } catch (e) { return this.fail(uid, key, 'E-way bill generate', e); }
    if (!data || !/^\d{12}$/.test(String(data.ewayBillNo || ''))) return this.fail(uid, key, 'E-way bill generate', new ApiError('The e-way bill system answer did not contain a 12-digit e-way bill number. Nothing was recorded.', { status: 502, code: 'EWB_BAD_RESPONSE' }));
    await this.store.update(uid, key, x => { x.docId = String(doc.id || x.docId || ''); x.docType = doc.docType; x.num = doc.num; x.date = doc.date; x.buyerGstin = doc.buyerGstin;
      x.ewb = { status: 'ACT', ewbNo: String(data.ewayBillNo), ewbDt: data.ewayBillDate, ewbAt: isoOrNull(data.ewayBillDate), validUpto: data.validUpto,
        validAt: isoOrNull(data.validUpto), via: 'EWB', env, generatedAt: now, transport: transportOf(doc), alert: data.alert }; return x; });
    await this.store.addLog(uid, key, { action: 'E-way bill generated', ok: true, msg: String(data.ewayBillNo) + (data.alert ? ' · ' + data.alert : ''), env });
    this.audit(uid, 'ewb.generate', key, true, null, { via: 'EWB' });
    return { warnings };
  }

  /* ------------------------------------------------------------ status */
  async record(uid, key, full) { const r = await this.store.get(uid, String(key || '')); if (!r || (!r.irn && !r.ewb)) throw new ApiError('Nothing has been reported for this document yet.', { status: 404, code: 'NOT_FOUND' }); return { record: this.publicRecord(r, full) }; }
  gstinOfKey(key) { const g = String(key || '').split('|')[0]; if (!GSTIN_RE.test(g)) throw new ApiError('Bad document key', { status: 400, code: 'BAD_REQUEST' }); return g; }

  /** asks the government systems for the current status of the IRN and e-way bill */
  async refresh(uid, key) {
    const r0 = await this.store.get(uid, key);
    if (!r0 || (!r0.irn && !r0.ewb)) throw new ApiError('Nothing has been reported for this document yet.', { status: 404, code: 'NOT_FOUND' });
    const c = await this.clients(uid, this.gstinOfKey(key));
    const notes = [];
    if (r0.irn && c.irp && this.irpReady()) {
      try {
        const { data } = await c.irp.getByIrn(r0.irn.irn);
        await this.store.update(uid, key, x => { x.irn.status = data.Status === 'CNL' ? 'CNL' : (data.Status === 'ACT' ? 'ACT' : x.irn.status); x.irn.checkedAt = new Date().toISOString();
          if (data.SignedQRCode) x.irn.signedQr = data.SignedQRCode; if (data.SignedInvoice) x.irn.signedInvoice = data.SignedInvoice; return x; });
      } catch (e) { notes.push('IRN status: ' + e.message); await this.store.addLog(uid, key, { action: 'IRN status check', ok: false, msg: e.message, env: this.cfg.env }); }
    }
    const r = await this.store.get(uid, key);
    if (r.ewb) {
      try {
        if (r.ewb.via === 'EWB' || (c.ewb && this.ewbReady())) {
          this.requireEwb(c);
          const { data } = await c.ewb.get(r.ewb.ewbNo);
          await this.store.update(uid, key, x => {
            x.ewb.status = String(data.status || '').toUpperCase() === 'CNL' ? 'CNL' : 'ACT';
            x.ewb.validUpto = data.validUpto || x.ewb.validUpto; x.ewb.validAt = isoOrNull(x.ewb.validUpto) || x.ewb.validAt;
            const v = Array.isArray(data.VehiclListDetails) ? data.VehiclListDetails : [];
            if (v.length) x.ewb.vehicles = v.map(z => ({ vehicleNo: z.vehicleNo, fromPlace: z.fromPlace, enteredDate: z.enteredDate, transMode: z.transMode }));
            x.ewb.checkedAt = new Date().toISOString(); return x;
          });
        } else if (r.irn && c.irp) {
          const { data } = await c.irp.getEwbByIrn(r.irn.irn);
          await this.store.update(uid, key, x => { x.ewb.status = data.Status === 'CNL' ? 'CNL' : 'ACT'; x.ewb.validUpto = data.EwbValidTill || x.ewb.validUpto; x.ewb.validAt = isoOrNull(x.ewb.validUpto) || x.ewb.validAt; x.ewb.checkedAt = new Date().toISOString(); return x; });
        }
      } catch (e) { notes.push('E-way bill status: ' + e.message); await this.store.addLog(uid, key, { action: 'E-way bill status check', ok: false, msg: e.message, env: this.cfg.env }); }
    }
    this.audit(uid, 'refresh', key, !notes.length);
    return { record: this.publicRecord(await this.store.get(uid, key), true), notes };
  }

  /* ------------------------------------------------------------ cancel */
  async cancelIrn(uid, key, reasonCode, remark, by) {
    if (!['1', '2', '3', '4'].includes(String(reasonCode))) throw new ApiError('Cancel reason must be 1 Duplicate, 2 Data entry mistake, 3 Order cancelled or 4 Others.', { status: 400, code: 'BAD_REASON' });
    remark = String(remark || '').trim().slice(0, 100);
    if (!remark) throw new ApiError('Cancellation remark is required.', { status: 400, code: 'BAD_REMARK' });
    const c = await this.clients(uid, this.gstinOfKey(key));
    this.requireIrp(c);
    return this.store.withLock(uid, key, by, async () => {
      const r = await this.store.get(uid, key);
      if (!r || !r.irn || r.irn.status !== 'ACT') throw new ApiError('No active IRN for this document.', { status: 404, code: 'NOT_FOUND' });
      if (r.ewb && r.ewb.status === 'ACT') throw new ApiError('Cancel the active e-way bill first — the IRP does not cancel an IRN that has a live e-way bill.', { status: 409, code: 'EWB_ACTIVE' });
      if (r.irn.ackAt && Date.now() - Date.parse(r.irn.ackAt) > H24)
        throw new ApiError('An IRN can only be cancelled within 24 hours of generation. Issue a credit note instead (and amend in GSTR-1 if needed).', { status: 409, code: 'CANCEL_WINDOW_OVER' });
      let data;
      try { ({ data } = await c.irp.cancelIrn(r.irn.irn, reasonCode, remark)); } catch (e) { return this.fail(uid, key, 'IRN cancel', e); }
      await this.store.update(uid, key, x => { x.irn.status = 'CNL'; x.irn.cancelDate = (data && data.CancelDate) || new Date().toISOString(); x.irn.cancelReason = String(reasonCode); x.irn.cancelRemark = remark; return x; });
      await this.store.addLog(uid, key, { action: 'IRN cancelled', ok: true, msg: `${reasonCode} – ${remark}`, env: this.cfg.env });
      this.audit(uid, 'irn.cancel', key, true);
      return { record: this.publicRecord(await this.store.get(uid, key), true) };
    });
  }

  async cancelEwb(uid, key, reasonCode, remark, by) {
    if (!['1', '2', '3', '4'].includes(String(reasonCode))) throw new ApiError('Cancel reason must be 1 Duplicate, 2 Order cancelled, 3 Data entry mistake or 4 Others.', { status: 400, code: 'BAD_REASON' });
    remark = String(remark || '').trim().slice(0, 50);
    if (!remark) throw new ApiError('Cancellation remark is required.', { status: 400, code: 'BAD_REMARK' });
    const c = await this.clients(uid, this.gstinOfKey(key));
    return this.store.withLock(uid, key, by, async () => {
      const r = await this.store.get(uid, key);
      if (!r || !r.ewb || r.ewb.status !== 'ACT') throw new ApiError('No active e-way bill for this document.', { status: 404, code: 'NOT_FOUND' });
      if (r.ewb.ewbAt && Date.now() - Date.parse(r.ewb.ewbAt) > H24) throw new ApiError('An e-way bill can only be cancelled within 24 hours of generation.', { status: 409, code: 'CANCEL_WINDOW_OVER' });
      const useIrp = r.ewb.via === 'IRP' && c.irp && this.irpReady();
      if (!useIrp) this.requireEwb(c);
      let data;
      try { ({ data } = useIrp ? await c.irp.cancelEwb(r.ewb.ewbNo, reasonCode, remark) : await c.ewb.cancel(r.ewb.ewbNo, reasonCode, remark)); } catch (e) { return this.fail(uid, key, 'E-way bill cancel', e); }
      await this.store.update(uid, key, x => { x.ewb.status = 'CNL'; x.ewb.cancelDate = (data && (data.cancelDate || data.CancelDate)) || new Date().toISOString(); x.ewb.cancelReason = String(reasonCode); x.ewb.cancelRemark = remark; return x; });
      await this.store.addLog(uid, key, { action: 'E-way bill cancelled', ok: true, msg: `${reasonCode} – ${remark}`, env: this.cfg.env });
      this.audit(uid, 'ewb.cancel', key, true);
      return { record: this.publicRecord(await this.store.get(uid, key), true) };
    });
  }

  /* ------------------------------------------------------------ Part-B (vehicle) and transporter updates — e-way bill system API */
  async updatePartB(uid, key, p, by) {
    const c = await this.clients(uid, this.gstinOfKey(key));
    this.requireEwb(c);
    return this.store.withLock(uid, key, by, async () => {
      const r = await this.store.get(uid, key);
      if (!r || !r.ewb || r.ewb.status !== 'ACT') throw new ApiError('No active e-way bill for this document.', { status: 404, code: 'NOT_FOUND' });
      const vehicleNo = String(p.vehicleNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const transMode = String(p.transMode || '1');
      const errs = [];
      if (!['1', '2', '3', '4'].includes(transMode)) errs.push('Transport mode must be Road, Rail, Air or Ship.');
      if (transMode === '1' && !VEH_RE.test(vehicleNo)) errs.push('Enter a valid vehicle number (e.g. GJ05AB1234).');
      if (transMode !== '1' && !p.transDocNo) errs.push('Rail / Air / Ship needs the transport document number.');
      if (!STATES[String(p.fromState || '').padStart(2, '0')]) errs.push('From-state code is invalid.');
      if (!p.fromPlace || String(p.fromPlace).trim().length < 3) errs.push('From-place is required.');
      if (!['1', '2', '3', '4'].includes(String(p.reasonCode))) errs.push('Reason must be 1 Break down, 2 Transshipment, 3 Others or 4 First time.');
      if (String(p.reasonCode) === '3' && !p.reasonRem) errs.push('Remarks are required when the reason is Others.');
      if (errs.length) throw new ApiError(errs.join(' '), { status: 422, code: 'VALIDATION_FAILED' });
      const body = { ewbNo: Number(r.ewb.ewbNo), vehicleNo: transMode === '1' ? vehicleNo : '', fromPlace: String(p.fromPlace).trim().slice(0, 50), fromState: Number(p.fromState),
        reasonCode: String(p.reasonCode), reasonRem: String(p.reasonRem || '').slice(0, 50), transDocNo: String(p.transDocNo || '').slice(0, 15),
        transDocDate: p.transDocDate ? ddmmyyyy(p.transDocDate) : '', transMode, vehicleType: p.vehicleType === 'O' ? 'O' : 'R' };
      let data;
      try { ({ data } = await c.ewb.updatePartB(body)); } catch (e) { return this.fail(uid, key, 'Part-B update', e); }
      await this.store.update(uid, key, x => {
        x.ewb.validUpto = (data && data.validUpto) || x.ewb.validUpto; x.ewb.validAt = isoOrNull(x.ewb.validUpto) || x.ewb.validAt;
        x.ewb.partB = [...(x.ewb.partB || []), { vehicleNo: body.vehicleNo, transDocNo: body.transDocNo, fromPlace: body.fromPlace, reasonCode: body.reasonCode, at: data && data.vehUpdDate }];
        x.ewb.transport = { ...(x.ewb.transport || {}), vehicleNo: body.vehicleNo || (x.ewb.transport || {}).vehicleNo, transMode }; return x;
      });
      await this.store.addLog(uid, key, { action: 'Part-B (vehicle) updated', ok: true, msg: `${body.vehicleNo || body.transDocNo} from ${body.fromPlace}`, env: this.cfg.env });
      this.audit(uid, 'ewb.partb', key, true);
      return { record: this.publicRecord(await this.store.get(uid, key), true) };
    });
  }

  async updateTransporter(uid, key, transporterId, by) {
    const c = await this.clients(uid, this.gstinOfKey(key));
    this.requireEwb(c);
    const tid = String(transporterId || '').toUpperCase().trim();
    if (!TRANSID_RE.test(tid)) throw new ApiError('Transporter ID must be the 15-character GSTIN / TRANSIN.', { status: 422, code: 'VALIDATION_FAILED' });
    return this.store.withLock(uid, key, by, async () => {
      const r = await this.store.get(uid, key);
      if (!r || !r.ewb || r.ewb.status !== 'ACT') throw new ApiError('No active e-way bill for this document.', { status: 404, code: 'NOT_FOUND' });
      try { await c.ewb.updateTransporter(r.ewb.ewbNo, tid); } catch (e) { return this.fail(uid, key, 'Transporter update', e); }
      await this.store.update(uid, key, x => { x.ewb.transport = { ...(x.ewb.transport || {}), transId: tid }; return x; });
      await this.store.addLog(uid, key, { action: 'Transporter updated', ok: true, msg: tid, env: this.cfg.env });
      this.audit(uid, 'ewb.transporter', key, true);
      return { record: this.publicRecord(await this.store.get(uid, key), true) };
    });
  }
}

module.exports = { EdocService };
