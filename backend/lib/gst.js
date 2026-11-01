'use strict';
/**
 * GSTIN lookup through an authorised GST Suvidha Provider (GSP) / GST API provider.
 * The GST Network's "Search Taxpayer" answer (lgnm, tradeNam, pradr, sts, rgdt, ctb, dty, nba, stj, ctj, cxdt, lstupdt) is
 * what every provider returns, sometimes wrapped ({data: {...}}, {data: "<json text>"}, {result: {...}}).
 *
 * Configuration (Secret Manager / env, never in the app):
 *   GST_API_URL        e.g. https://<provider>/…/search?gstin={gstin}&action=TP      ({gstin} is replaced)
 *   GST_API_HEADERS    JSON object of request headers (API key, client id/secret …)
 *   GST_API_AUTH_URL   optional: token endpoint called first (POST, headers GST_API_AUTH_HEADERS, body GST_API_AUTH_BODY)
 *   GST_API_TOKEN_PATH optional: where the token is in that answer (e.g. "access_token" or "data.token")
 *   GST_API_TOKEN_HEADER optional: header that carries it, e.g. "Authorization: Bearer {token}" (default) or "authorization: {token}"
 *   GST_API_NAME       shown to users as the source, e.g. "Masters India GSP"
 * Nothing is ever invented: when the provider is not configured or does not answer, the caller gets an error.
 */
const { request, UpstreamError } = require('./http');

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstinCheck(g) {
  g = String(g || '').toUpperCase().trim();
  if (!/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36] === g[14];
}

class GstError extends Error { constructor(m, status, code) { super(m); this.status = status; this.code = code; } }

const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function unwrap(x) {
  for (let i = 0; i < 4 && x; i++) {
    if (typeof x === 'string') { try { x = JSON.parse(x); continue; } catch (e) { return null; } }
    if (x.lgnm || x.tradeNam || x.gstin && (x.sts || x.pradr)) return x;
    x = x.data !== undefined ? x.data : x.result !== undefined ? x.result : x.taxpayerInfo !== undefined ? x.taxpayerInfo : x.response !== undefined ? x.response : null;
  }
  return x && (x.lgnm || x.tradeNam) ? x : null;
}
const clean = s => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());
const STATES = { '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory' };

/** GSTN taxpayer object → the fields the app uses (only what the record contains) */
function normalize(gstin, tp, source) {
  const a = (tp.pradr && tp.pradr.addr) || {};
  const parts = [a.flno, a.bno, a.bnm, a.st, a.loc, a.city, a.dst].map(clean).filter(Boolean);
  const dedup = parts.filter((p, i) => parts.findIndex(q => q.toLowerCase() === p.toLowerCase()) === i);
  const code = gstin.slice(0, 2);
  return {
    gstin,
    legalName: clean(tp.lgnm),
    tradeName: clean(tp.tradeNam),
    status: clean(tp.sts),
    registrationDate: clean(tp.rgdt),
    cancellationDate: clean(tp.cxdt),
    constitution: clean(tp.ctb),
    taxpayerType: clean(tp.dty),
    natureOfBusiness: Array.isArray(tp.nba) ? tp.nba.map(clean).filter(Boolean) : [],
    stateJurisdiction: clean(tp.stj),
    centreJurisdiction: clean(tp.ctj),
    lastUpdated: clean(tp.lstupdt),
    einvoiceStatus: clean(tp.einvoiceStatus),
    address: { line: dedup.join(', '), building: clean(a.bno), buildingName: clean(a.bnm), floor: clean(a.flno), street: clean(a.st), locality: clean(a.loc),
      city: clean(a.city), district: clean(a.dst), state: clean(a.stcd) || STATES[code] || '', pin: /^\d{6}$/.test(clean(a.pncd)) ? clean(a.pncd) : '' },
    stateCode: code,
    source,
    fetchedAt: new Date().toISOString()
  };
}

class GstLookup {
  constructor(cfg, fs, log = () => {}) {
    this.c = cfg.gst; this.fs = fs; this.log = log; this.token = null; this.tokenUntil = 0;
  }
  configured() { return !!this.c.url; }
  async headers() {
    const h = { ...(this.c.headers || {}) };
    if (this.c.authUrl) {
      if (!this.token || Date.now() > this.tokenUntil) {
        const r = await request('POST', this.c.authUrl, { headers: this.c.authHeaders || {}, body: this.c.authBody || {}, timeoutMs: 15000, retries: 1 });
        const tok = get(r, this.c.tokenPath || 'access_token');
        if (!tok) throw new GstError('GST provider did not issue an access token', 502, 'gst_auth_failed');
        this.token = tok; this.tokenUntil = Date.now() + 20 * 60e3;
      }
      const [name, tpl] = String(this.c.tokenHeader || 'Authorization: Bearer {token}').split(/:\s*/, 2);
      h[name] = tpl.replace('{token}', this.token);
    }
    return h;
  }
  async lookup(gstin, { fresh } = {}) {
    gstin = String(gstin || '').toUpperCase().trim();
    if (!gstinCheck(gstin)) throw new GstError('This is not a valid GSTIN (format or check digit).', 400, 'invalid_gstin');
    if (!this.configured()) throw new GstError('GST lookup is not set up on the server yet.', 503, 'gst_not_configured');
    const cachePath = `gstin_cache/${gstin}`;
    if (!fresh) {
      const c = await this.fs.get(cachePath).catch(() => null);
      if (c && Date.now() - Date.parse(c.fetchedAt) < 7 * 86400e3) { try { return { ...JSON.parse(c.data), cached: true }; } catch (e) { /* refetch */ } }
    }
    let raw;
    try {
      raw = await request('GET', this.c.url.replace('{gstin}', encodeURIComponent(gstin)), { headers: await this.headers(), timeoutMs: 20000, retries: 1 });
    } catch (e) {
      if (e instanceof UpstreamError && (e.status === 404 || (e.status === 400 && /invalid|not found|no record/i.test(e.message)))) throw new GstError('No taxpayer with this GSTIN was found in GST records.', 404, 'gstin_not_found');
      if (e instanceof UpstreamError && e.status === 401) { this.token = null; }
      this.log({ warn: 'gst provider error', status: e.status, error: e.message });
      throw new GstError('GST records could not be reached right now. Enter the details manually or try again later.', 502, 'gst_unavailable');
    }
    const tp = unwrap(raw);
    if (!tp) {
      const msg = JSON.stringify(raw || {}).slice(0, 300);
      if (/not\s*found|invalid gstin|no records?|SWEB_9035|RET11416/i.test(msg)) throw new GstError('No taxpayer with this GSTIN was found in GST records.', 404, 'gstin_not_found');
      this.log({ warn: 'gst provider answer not understood', sample: msg.slice(0, 120) });
      throw new GstError('The GST provider sent an answer the app does not understand. Enter the details manually.', 502, 'gst_bad_answer');
    }
    if (tp.gstin && String(tp.gstin).toUpperCase() !== gstin) throw new GstError('The GST provider answered for a different GSTIN.', 502, 'gst_bad_answer');
    const out = normalize(gstin, tp, this.c.name || 'GST provider');
    if (!out.legalName && !out.tradeName) throw new GstError('GST records returned no name for this GSTIN.', 502, 'gst_bad_answer');
    await this.fs.commit([{ set: cachePath, data: { data: JSON.stringify(out), fetchedAt: out.fetchedAt, source: out.source } }]).catch(() => {});
    return out;
  }
}

module.exports = { GstLookup, GstError, gstinCheck, normalize, unwrap };
