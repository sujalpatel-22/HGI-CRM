'use strict';
/**
 * TEST ONLY — in-memory stand-ins for the Google / GST endpoints the service uses:
 *   - OAuth token endpoint and the Cloud Run metadata server (access tokens)
 *   - Google Sheets API v4 (test/fake-sheets.js)
 *   - Cloud Storage JSON API (upload, download, delete)
 *   - a GST provider answering in the GST Network "Search Taxpayer" format (wrapped as {data: "<json>"})
 * Never used by the production server.
 */
const http = require('http');
const crypto = require('crypto');
const { FakeSheets } = require('./fake-sheets');

function rsa() { return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); }

class FakeGoogle {
  constructor() {
    this.kid = 'kid-1';
    this.keys = rsa();
    this.tokens = new Set();
    this.sheets = new FakeSheets();
    this.objects = new Map();       // bucket/name → Buffer
    this.failures = [];
    this.calls = [];
    this.ver = 1;
    this.gstRecords = new Map();    // GSTIN → GSTN taxpayer object
    this.gstKey = 'gst-test-key';
    this.gstCalls = 0;
    this.gstDown = false;
  }
  fail(match, status, times = 1, method) { this.failures.push({ match, status, times, method }); }
  start() {
    return new Promise(res => {
      this.server = http.createServer((req, resp) => this.handle(req, resp).catch(e => { resp.writeHead(500); resp.end(JSON.stringify({ error: { message: e.message } })); }));
      this.server.listen(0, '127.0.0.1', () => { this.base = `http://127.0.0.1:${this.server.address().port}`; res(this); });
    });
  }
  stop() { return new Promise(r => this.server.close(r)); }
  endpoints() {
    return { token: this.base + '/token', metadata: this.base + '/metadata/token', sheets: this.base, storage: this.base };
  }
  gstUrl() { return this.base + '/gst/search?gstin={gstin}&action=TP'; }

  async handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const raw = await new Promise(r => { const b = []; req.on('data', c => b.push(c)); req.on('end', () => r(Buffer.concat(b))); });
    const json = (s, o, h = {}) => { res.writeHead(s, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
    const err = (s, m, status) => json(s, { error: { code: s, message: m, status: status || '' } });
    const p = decodeURIComponent(url.pathname);
    this.calls.push(`${req.method} ${p}`);
    for (const f of this.failures) if (f.times > 0 && f.match.test(`${req.method} ${p}${url.search}`) && (!f.method || f.method === req.method)) { f.times--; return err(f.status, 'injected failure'); }
    if (p === '/token' || p === '/metadata/token') {
      if (p === '/metadata/token' && req.headers['metadata-flavor'] !== 'Google') return err(403, 'missing Metadata-Flavor');
      const t = 'at-' + crypto.randomBytes(8).toString('hex'); this.tokens.add(t);
      return json(200, { access_token: t, expires_in: 3599, token_type: 'Bearer' });
    }
    if (p === '/gst/auth' && req.method === 'POST') {
      if (req.headers['x-api-key'] !== this.gstKey) return err(401, 'bad key');
      return json(200, { data: { token: 'tok-123' } });
    }
    if (p.startsWith('/gst/')) {
      this.gstCalls++;
      if (this.gstDown) return err(503, 'provider down');
      if (req.headers['x-api-key'] !== this.gstKey && req.headers.authorization !== 'tok-123') return err(401, 'bad key');
      const g = url.searchParams.get('gstin');
      const rec = this.gstRecords.get(g);
      if (!rec) return json(404, { message: 'err-invalid-gstin' });
      return json(200, { data: JSON.stringify(rec) });
    }
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!auth || !this.tokens.has(auth[1])) return err(401, 'Request had invalid authentication credentials.', 'UNAUTHENTICATED');
    const body = raw.length && /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw.toString('utf8')) : null;

    /* ------------------------------------------------ Cloud Storage */
    let m;
    if ((m = /^\/upload\/storage\/v1\/b\/([^/]+)\/o$/.exec(p)) && req.method === 'POST') {
      const name = url.searchParams.get('name'); this.objects.set(m[1] + '/' + name, raw);
      return json(200, { name, bucket: m[1], size: String(raw.length) });
    }
    if ((m = /^\/storage\/v1\/b\/([^/]+)\/o\/(.+)$/.exec(p))) {
      const key = m[1] + '/' + m[2];
      if (req.method === 'GET') { if (!this.objects.has(key)) return err(404, 'No such object'); res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end(this.objects.get(key)); }
      if (req.method === 'DELETE') { if (!this.objects.delete(key)) return err(404, 'No such object'); res.writeHead(204); return res.end(); }
    }

    /* ------------------------------------------------ Google Sheets */
    if (await this.sheets.handle(req, res, url, body, json)) return;
    return err(404, 'fake: no route ' + req.method + ' ' + p);
  }
}

module.exports = { FakeGoogle, rsa };
