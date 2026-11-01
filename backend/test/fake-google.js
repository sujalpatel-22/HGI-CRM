'use strict';
/**
 * TEST ONLY — in-memory stand-ins for the Google / GST endpoints the service uses:
 *   - Google ID-token signing keys (JWKS), OAuth token endpoint, Cloud Run metadata server
 *   - Firestore REST (batchGet, beginTransaction, commit, rollback, runQuery, list) with optimistic transactions
 *     (a transaction whose read documents changed before commit is ABORTED, like Firestore)
 *   - Cloud Storage JSON API (upload, download, delete)
 *   - a GST provider answering in the GST Network "Search Taxpayer" format (wrapped as {data: "<json>"})
 * The same backend tests also run against the official Firestore emulator in CI (FIRESTORE_EMULATOR_HOST).
 * Never used by the production server.
 */
const http = require('http');
const crypto = require('crypto');

function rsa() { return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); }

class FakeGoogle {
  constructor() {
    this.kid = 'kid-1';
    this.keys = rsa();
    this.tokens = new Set();
    this.docs = new Map();          // full doc name → { fields, ver }
    this.txs = new Map();           // tx id → Map(name → ver at read)
    this.objects = new Map();       // bucket/name → Buffer
    this.failures = [];
    this.calls = [];
    this.ver = 1;
    this.gstRecords = new Map();    // GSTIN → GSTN taxpayer object
    this.gstKey = 'gst-test-key';
    this.gstCalls = 0;
    this.gstDown = false;
  }
  idToken(claims, opts = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', kid: opts.kid || this.kid, typ: 'JWT' };
    const payload = { iss: 'https://accounts.google.com', aud: 'test-web-client.apps.googleusercontent.com', iat: now, exp: now + 3600, email_verified: true, ...claims };
    const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = enc(header) + '.' + enc(payload);
    return unsigned + '.' + crypto.sign('RSA-SHA256', Buffer.from(unsigned), opts.privateKey || this.keys.privateKey).toString('base64url');
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
    return { certs: this.base + '/certs', token: this.base + '/token', metadata: this.base + '/metadata/token', firestore: this.base, storage: this.base };
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
    if (p === '/certs') {
      const jwk = this.keys.publicKey.export({ format: 'jwk' });
      return json(200, { keys: [{ ...jwk, kid: this.kid, alg: 'RS256', use: 'sig' }] }, { 'Cache-Control': 'public, max-age=3600' });
    }
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

    /* ------------------------------------------------ Firestore REST */
    if ((m = /^\/v1\/(projects\/[^/]+\/databases\/\(default\)\/documents)(.*)$/.exec(p))) {
      const root = m[1], rest = m[2];
      if (rest === ':beginTransaction') { const id = crypto.randomBytes(8).toString('base64'); this.txs.set(id, new Map()); return json(200, { transaction: id }); }
      if (rest === ':rollback') { this.txs.delete(body.transaction); return json(200, {}); }
      if (rest === ':batchGet') {
        const tx = body.transaction && this.txs.get(body.transaction);
        return json(200, body.documents.map(n => { const d = this.docs.get(n); if (tx) tx.set(n, d ? d.ver : 0); return d ? { found: { name: n, fields: d.fields }, readTime: new Date().toISOString() } : { missing: n, readTime: new Date().toISOString() }; }));
      }
      if (rest === ':commit') {
        if (body.transaction) {
          const tx = this.txs.get(body.transaction); if (!tx) return err(400, 'transaction expired', 'INVALID_ARGUMENT');
          for (const [n, v] of tx) { const d = this.docs.get(n); if ((d ? d.ver : 0) !== v) { this.txs.delete(body.transaction); return err(409, 'Transaction aborted: contention', 'ABORTED'); } }
          this.txs.delete(body.transaction);
        }
        for (const w of body.writes) {
          if (w.delete) this.docs.delete(w.delete);
          else { if (JSON.stringify(w.update.fields).length > 1048487) return err(400, 'Document too large', 'INVALID_ARGUMENT'); this.docs.set(w.update.name, { fields: w.update.fields, ver: ++this.ver }); }
        }
        return json(200, { commitTime: new Date().toISOString(), writeResults: body.writes.map(() => ({})) });
      }
      if ((m = /^\/(.+):runQuery$/.exec(rest)) && req.method === 'POST') {
        const parent = `${root}/${m[1]}`, q = body.structuredQuery, col = q.from[0].collectionId;
        const f = q.where.fieldFilter, field = f.field.fieldPath, after = Number(f.value.integerValue);
        const prefix = `${parent}/${col}/`;
        const rows = [...this.docs.entries()].filter(([n]) => n.startsWith(prefix) && !n.slice(prefix.length).includes('/'))
          .map(([n, d]) => ({ n, d, v: d.fields[field] ? Number(d.fields[field].integerValue) : null }))
          .filter(x => x.v !== null && x.v > after).sort((a, b) => a.v - b.v).slice(0, q.limit || 1e9);
        return json(200, rows.length ? rows.map(x => ({ document: { name: x.n, fields: x.d.fields }, readTime: new Date().toISOString() })) : [{ readTime: new Date().toISOString() }]);
      }
      if (req.method === 'GET' && rest) {
        if (url.searchParams.getAll('mask.fieldPaths').some(f => /^__.*__$/.test(f))) return err(400, 'Invalid reserved name in field path ' + url.searchParams.get('mask.fieldPaths'), 'INVALID_ARGUMENT');   // as the real service
        const col = `${root}${rest}`, prefix = col + '/';
        const names = [...this.docs.keys()].filter(n => n.startsWith(prefix) && !n.slice(prefix.length).includes('/')).sort();
        const size = Number(url.searchParams.get('pageSize')) || 100, start = Number(url.searchParams.get('pageToken') || 0);
        const page = names.slice(start, start + size);
        return json(200, { documents: page.map(n => ({ name: n, fields: {} })), ...(start + size < names.length ? { nextPageToken: String(start + size) } : {}) });
      }
    }
    return err(404, 'fake: no route ' + req.method + ' ' + p);
  }
}

module.exports = { FakeGoogle, rsa };
