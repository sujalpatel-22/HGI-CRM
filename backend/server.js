#!/usr/bin/env node
'use strict';
/**
 * HGI Billing — cloud service (Google Cloud Run + Firestore + Cloud Storage). No third-party dependencies (Node 20+).
 *
 *   POST   /v1/auth/google     {idToken}                Sign in with Google → app session
 *   GET    /v1/me                                       account, sync position, which cloud features are set up
 *   GET    /v1/sync/pull?since=N                        records changed after sequence N (other devices' work)
 *   POST   /v1/sync/push       {device, records:[…]}    upload changed records (per-record conflict + number checks)
 *   POST   /v1/numbers/check   {docType, num, docId}    is a document number still free?
 *   GET    /v1/gstin/{GSTIN}                            taxpayer details from GST records (authorised provider)
 *   PUT    /v1/files/pdf/{docId}  {base64, num, …}      store an invoice PDF;  GET /v1/files (list), GET …/pdf/{docId}
 *   DELETE /v1/account                                  delete the account and all its cloud data (in-app)
 *   POST   /v1/account/delete-with-google {idToken}     same, from the web page /delete-account
 *   E-invoice / e-way bill (government APIs through HGI's GSP; each business uses its own API login):
 *   GET    /v1/edoc/credentials                         saved API logins (masked user names only)
 *   PUT    /v1/edoc/credentials/{GSTIN} {irpUser, irpPass, ewbUser, ewbPass}   verify by logging in, then store encrypted
 *   DELETE /v1/edoc/credentials/{GSTIN}
 *   POST   /v1/edoc/preview  {doc, company, mode}       eligibility + validation + the exact JSON (nothing sent)
 *   POST   /v1/edoc/generate {doc, company, mode}       mode irn | irn+ewb (one step) | ewb
 *   POST   /v1/edoc/refresh  {key}                      status from the IRP / e-way bill system
 *   GET    /v1/edoc/record?key=                         stored record
 *   POST   /v1/edoc/cancel-irn | cancel-ewb {key, reasonCode, remark}
 *   POST   /v1/edoc/partb {key, vehicleNo, …}  ·  POST /v1/edoc/transporter {key, transporterId}
 *   GET    /privacy, /delete-account, /healthz
 *
 * The app never holds a Google Cloud credential or the GST provider's key: those stay on this server.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const { GoogleVerifier, Sessions, AuthError, userKey } = require('./lib/identity');
const { GoogleAccess } = require('./lib/google-access');
const { Firestore } = require('./lib/firestore');
const { RecordStore } = require('./lib/record-store');
const { FileStore } = require('./lib/files');
const { GstLookup } = require('./lib/gst');
const { UpstreamError } = require('./lib/http');
const { ApiError } = require('./lib/nic-http');
const { CredentialVault } = require('./lib/credentials');
const { EdocStore } = require('./lib/edoc-store');
const { EdocService } = require('./lib/edoc-service');

const log = e => console.log(JSON.stringify({ severity: e.warn ? 'WARNING' : e.error ? 'ERROR' : 'INFO', at: new Date().toISOString(), ...e }));

function createServer(cfg, deps = {}) {
  const verifier = deps.verifier || new GoogleVerifier(cfg);
  const sessions = new Sessions(cfg);
  const access = deps.access || new GoogleAccess(cfg);
  const fsdb = deps.firestore || new Firestore({ projectId: cfg.projectId, emulatorHost: cfg.firestoreEmulator, endpoint: cfg.endpoints.firestore, access });
  const store = new RecordStore(fsdb, log);
  const files = new FileStore(cfg, access);
  const gst = new GstLookup(cfg, fsdb, log);
  const edoc = new EdocService(cfg.edoc, { vault: new CredentialVault(fsdb, cfg.edoc.credKey), store: new EdocStore(fsdb), log, timeoutMs: deps.edocTimeoutMs || 30000 });
  if (edoc.keyError) log({ warn: edoc.keyError });
  const pub = f => fs.readFileSync(path.join(__dirname, 'public', f), 'utf8');

  /* ------------------------------------------------------------ rate limits (per instance) */
  const buckets = new Map();
  function limited(key, perMin) {
    const now = Date.now(); let b = buckets.get(key);
    if (!b || now - b.t > 60e3) { b = { t: now, n: 0 }; buckets.set(key, b); }
    if (buckets.size > 20000) for (const [k, v] of buckets) if (now - v.t > 60e3) buckets.delete(k);
    return ++b.n > perMin;
  }

  /* ------------------------------------------------------------ http helpers */
  const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Strict-Transport-Security': 'max-age=31536000' };
  function cors(req) {
    const o = req.headers.origin;
    if (!o || !cfg.allowedOrigins.includes(o)) return {};
    return { 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'X-HGI-Session', 'Access-Control-Max-Age': '600' };
  }
  function send(req, res, status, obj, extra = {}) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { ...SEC, ...cors(req), 'Content-Type': 'application/json; charset=utf-8', ...extra });
    res.end(body);
  }
  function page(req, res, html) {
    res.writeHead(200, { ...SEC, 'Cache-Control': 'public, max-age=300', 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://accounts.google.com; img-src 'self' data: https:; frame-ancestors 'none'" });
    res.end(html);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length'] || 0);
      if (declared > cfg.maxBodyBytes) return reject(Object.assign(new Error('Data is too large to sync'), { status: 413, code: 'too_large' }));
      const parts = []; let size = 0;
      req.on('data', c => { size += c.length; if (size > cfg.maxBodyBytes) { reject(Object.assign(new Error('Data is too large to sync'), { status: 413, code: 'too_large' })); req.destroy(); } else parts.push(c); });
      req.on('end', () => { try { resolve(size ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('Request is not valid JSON'), { status: 400, code: 'bad_json' })); } });
      req.on('error', reject);
    });
  }
  const ip = req => (cfg.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress);
  const toUser = s => ({ sub: s.sub, key: userKey(s.sub), email: s.email, name: s.name || '' });

  async function deleteAccount(uid) {
    let n = 0;
    if (files.enabled()) for (const f of await store.fileEntries(uid)) { await files.remove(f.object); n++; }
    const r = await store.deleteAll(uid);
    log({ event: 'account_deleted', user: uid, records: r.records, files: n });
    return { records: r.records, files: n, deletedAt: r.deletedAt };
  }
  async function session(req) {
    const s = sessions.verify(req.headers.authorization);
    const user = toUser(s);
    const del = await store.deletedAt(user.key);
    if (del && s.iat <= del) throw new AuthError('This account was deleted. Sign in again to start a new, empty account.', 'account_deleted');
    return { s, user };
  }
  function signedIn(user, res) {
    const ses = sessions.issue(user);
    return { session: ses.token, expiresAt: ses.expiresAt, user: { key: userKey(user.sub), email: user.email, name: user.name || '', picture: user.picture || '' } };
  }
  /* ------------------------------------------------------------ routes */
  async function route(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...SEC, ...cors(req) }); return res.end(); }
    if (req.method === 'GET' && p === '/healthz') return send(req, res, 200, { ok: true });
    if (req.method === 'GET' && (p === '/' || p === '/privacy')) return page(req, res, pub(p === '/' ? 'index.html' : 'privacy.html').replace(/\{\{SUPPORT_EMAIL\}\}/g, cfg.supportEmail || 'the e-mail shown in the app listing'));
    if (req.method === 'GET' && p === '/delete-account') return page(req, res, pub('delete-account.html').replace('{{CLIENT_ID}}', cfg.googleClientIds[0] || '').replace(/\{\{SUPPORT_EMAIL\}\}/g, cfg.supportEmail || ''));

    if (req.method === 'POST' && p === '/v1/auth/google') {
      if (limited('auth:' + ip(req), 30)) return send(req, res, 429, { error: 'too_many', message: 'Too many sign-in attempts. Wait a minute.' });
      const b = await readBody(req);
      const g = await verifier.verify(b.idToken);
      log({ event: 'sign_in', user: userKey(g.sub) });
      return send(req, res, 200, signedIn(g, res));
    }
    if (req.method === 'POST' && p === '/v1/auth/test') {
      if (!cfg.allowTestLogin) return send(req, res, 404, { error: 'not_found' });
      const b = await readBody(req);
      const email = String(b.email || '').toLowerCase();
      if (!/^[^@\s]+@example\.(com|org)$/.test(email)) return send(req, res, 400, { error: 'test_only', message: 'Test sign-in accepts only @example.com / @example.org addresses' });
      return send(req, res, 200, signedIn({ sub: 'test-' + email, email, name: 'Test user' }, res));
    }
    if (req.method === 'POST' && p === '/v1/account/delete-with-google') {
      if (limited('auth:' + ip(req), 30)) return send(req, res, 429, { error: 'too_many' });
      const g = await verifier.verify((await readBody(req)).idToken);
      const r = await deleteAccount(userKey(g.sub));
      return send(req, res, 200, { ok: true, ...r, deleted: r.records > 0 || r.files > 0, email: g.email });
    }

    if (p.startsWith('/v1/')) {
      const { s, user } = await session(req);
      if (limited('u:' + user.key, 240)) return send(req, res, 429, { error: 'too_many', message: 'Syncing too often — will retry shortly.' });
      const renewed = sessions.maybeRenew(s);
      const extra = renewed ? { 'X-HGI-Session': renewed.token } : {};
      const uid = user.key;
      if (req.method === 'GET' && p === '/v1/me') return send(req, res, 200, { user: { key: uid, email: user.email, name: user.name }, cloud: await store.state(uid), features: { gst: gst.configured(), files: files.enabled(), edoc: edoc.features() } }, extra);
      if (req.method === 'GET' && p === '/v1/sync/pull') {
        const since = Math.max(0, Number(url.searchParams.get('since')) || 0), limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 300));
        const r = await store.pull(uid, since, limit);
        return send(req, res, 200, r, extra);
      }
      if (req.method === 'POST' && p === '/v1/sync/push') {
        const b = await readBody(req);
        const r = await store.push(uid, user, b.records, b.device);
        const counts = r.results.reduce((a, x) => (a[x.status] = (a[x.status] || 0) + 1, a), {});
        log({ event: 'push', user: uid, ...counts });
        return send(req, res, 200, r, extra);
      }
      if (req.method === 'POST' && p === '/v1/numbers/check') {
        const b = await readBody(req);
        if (!b.num) return send(req, res, 400, { error: 'bad_request', message: 'num required' });
        return send(req, res, 200, await store.numberFree(uid, b.docType || 'INV', b.num, b.docId || ''), extra);
      }
      let m;
      if (req.method === 'GET' && (m = /^\/v1\/gstin\/([0-9A-Za-z]{15})$/.exec(p))) {
        if (limited('gst:' + uid, 30)) return send(req, res, 429, { error: 'too_many', message: 'Too many GST lookups — wait a minute.' });
        const r = await gst.lookup(m[1], { fresh: url.searchParams.get('fresh') === '1' });
        return send(req, res, 200, r, extra);
      }
      if (req.method === 'GET' && p === '/v1/files') return send(req, res, 200, { files: files.enabled() ? (await store.fileEntries(uid)).map(({ object, ...x }) => x) : [], enabled: files.enabled() }, extra);
      if ((m = /^\/v1\/files\/pdf\/([^/]{1,200})$/.exec(p))) {
        if (!files.enabled()) return send(req, res, 503, { error: 'files_not_configured', message: 'PDF storage is not set up on the server yet.' });
        const docId = decodeURIComponent(m[1]);
        if (req.method === 'PUT') {
          const b = await readBody(req);
          const buf = Buffer.from(String(b.base64 || ''), 'base64');
          if (buf.length < 100 || buf.slice(0, 5).toString() !== '%PDF-') return send(req, res, 400, { error: 'not_pdf', message: 'That is not a PDF file.' });
          if (buf.length > 15 * 1024 * 1024) return send(req, res, 413, { error: 'too_large', message: 'PDF is larger than 15 MB.' });
          const object = files.object(uid, docId);
          await files.put(object, buf);
          const entry = { object, bytes: buf.length, num: String(b.num || '').slice(0, 60), docType: String(b.docType || '').slice(0, 10), hash: String(b.hash || '').slice(0, 64), uploadedAt: new Date().toISOString() };
          await store.putFileEntry(uid, docId, entry);
          return send(req, res, 200, { ok: true, bytes: buf.length }, extra);
        }
        if (req.method === 'GET') {
          const e = await store.getFileEntry(uid, docId);
          if (!e) return send(req, res, 404, { error: 'not_found' });
          const buf = await files.get(e.object);
          if (!buf) return send(req, res, 404, { error: 'not_found' });
          return send(req, res, 200, { base64: buf.toString('base64'), num: e.num, uploadedAt: e.uploadedAt }, extra);
        }
      }
      if (p.startsWith('/v1/edoc/')) {
        if (limited('edoc:' + uid, 40)) return send(req, res, 429, { error: 'too_many', message: 'Too many e-invoice requests — wait a minute.' });
        const by = user.email;
        if (req.method === 'GET' && p === '/v1/edoc/credentials') return send(req, res, 200, { credentials: await edoc.listCredentials(uid), features: edoc.features() }, extra);
        if ((m = /^\/v1\/edoc\/credentials\/([0-9A-Za-z]{15})$/.exec(p))) {
          if (req.method === 'PUT') return send(req, res, 200, { credential: await edoc.saveCredentials(uid, m[1], await readBody(req)) }, extra);
          if (req.method === 'DELETE') { await edoc.deleteCredentials(uid, m[1]); return send(req, res, 200, { ok: true }, extra); }
        }
        if (req.method === 'GET' && p === '/v1/edoc/record') return send(req, res, 200, await edoc.record(uid, url.searchParams.get('key'), url.searchParams.get('full') === '1'), extra);
        if (req.method === 'POST') {
          const b = await readBody(req);
          if (p === '/v1/edoc/preview') return send(req, res, 200, await edoc.preview(uid, b.doc, b.company, b.mode), extra);
          if (p === '/v1/edoc/generate') return send(req, res, 200, await edoc.generate(uid, b.doc, b.company, b.mode, by), extra);
          if (p === '/v1/edoc/refresh') return send(req, res, 200, await edoc.refresh(uid, String(b.key || '')), extra);
          if (p === '/v1/edoc/cancel-irn') return send(req, res, 200, await edoc.cancelIrn(uid, String(b.key || ''), b.reasonCode, b.remark, by), extra);
          if (p === '/v1/edoc/cancel-ewb') return send(req, res, 200, await edoc.cancelEwb(uid, String(b.key || ''), b.reasonCode, b.remark, by), extra);
          if (p === '/v1/edoc/partb') return send(req, res, 200, await edoc.updatePartB(uid, String(b.key || ''), b, by), extra);
          if (p === '/v1/edoc/transporter') return send(req, res, 200, await edoc.updateTransporter(uid, String(b.key || ''), b.transporterId, by), extra);
        }
        return send(req, res, 404, { error: 'not_found' });
      }
      if (req.method === 'DELETE' && p === '/v1/account') return send(req, res, 200, { ok: true, ...(await deleteAccount(uid)) });
    }
    return send(req, res, 404, { error: 'not_found' });
  }

  return http.createServer((req, res) => {
    const t0 = Date.now();
    route(req, res).catch(e => {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (e instanceof ApiError) {
        // government API / validation answers: passed on as they are, with the error codes — never turned into success
        if (e.status >= 500) log({ warn: true, error: e.message, code: e.code, path: req.url.split('?')[0] });
        if (!res.headersSent) send(req, res, e.status || 502, { error: e.code, message: e.message, errors: e.errors || [], warnings: (e.info && e.info.warnings) || [] });
        return;
      }
      const upstream = e instanceof UpstreamError;
      // Google API trouble is reported as 503 (retry later) — never as success
      const code = upstream ? 503 : status;
      if (code >= 500) log({ error: e.message, path: req.url.split('?')[0], status: code });
      if (!res.headersSent) send(req, res, code, { error: e.code || (upstream ? 'cloud_unavailable' : 'error'), message: upstream ? 'Cloud storage is not reachable right now. Your data is safe on this phone and will sync later.' : e.message });
    }).finally(() => { if (Date.now() - t0 > 10000) log({ warn: 'slow request', path: req.url.split('?')[0], ms: Date.now() - t0 }); });
  });
}

if (require.main === module) {
  let cfg;
  try { cfg = config.load(); } catch (e) { console.error(e.message); process.exit(1); }
  const server = createServer(cfg);
  server.listen(cfg.port, () => log({ event: 'listening', port: cfg.port, project: cfg.projectId, gst: !!cfg.gst.url, files: !!cfg.filesBucket, edoc: { env: cfg.edoc.env, irp: !!cfg.edoc.irp.baseUrl, ewb: !!cfg.edoc.ewb.baseUrl }, testLogin: cfg.allowTestLogin }));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = { createServer };
