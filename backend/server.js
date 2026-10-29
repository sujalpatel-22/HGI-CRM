#!/usr/bin/env node
'use strict';
/**
 * HGI Billing — cloud sync service (Google Cloud Run). No third-party dependencies (Node 20+).
 *
 *   POST   /v1/auth/google     {idToken}                 Sign in with Google → app session
 *   GET    /v1/sync/meta                                  version of the cloud copy (cheap check)
 *   GET    /v1/sync                                       full cloud copy (restore after reinstall / other phone)
 *   PUT    /v1/sync            {baseVersion, clientRev, device, data}   save (409 if another phone saved first)
 *   DELETE /v1/account                                    delete the account's cloud data (in-app)
 *   POST   /v1/account/delete-with-google {idToken}       same, from the web page /delete-account
 *   GET    /privacy, /delete-account, /healthz
 *
 * The app never sees a Google API credential: Drive/Sheets access stays on this server.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const { GoogleVerifier, Sessions, AuthError, userKey } = require('./lib/identity');
const { GoogleAccess } = require('./lib/google-access');
const { SheetStore, ConflictError } = require('./lib/sheet-store');
const { UpstreamError } = require('./lib/http');

const log = e => console.log(JSON.stringify({ severity: e.error ? 'ERROR' : e.warn ? 'WARNING' : 'INFO', at: new Date().toISOString(), ...e }));

function createServer(cfg, deps = {}) {
  const verifier = deps.verifier || new GoogleVerifier(cfg);
  const sessions = new Sessions(cfg);
  const store = deps.store || new SheetStore(cfg, deps.access || new GoogleAccess(cfg), log);
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

  async function session(req) {
    const s = sessions.verify(req.headers.authorization);
    const user = toUser(s);
    const del = await store.deletedAt(user);
    if (del && s.iat <= del) throw new AuthError('This account was deleted. Sign in again to start a new, empty account.', 'account_deleted');
    return { s, user };
  }
  function signedIn(user, res) {
    const ses = sessions.issue(user);
    return { session: ses.token, expiresAt: ses.expiresAt, user: { key: userKey(user.sub), email: user.email, name: user.name || '', picture: user.picture || '' } };
  }
  // the app's data must look like an HGI Billing book — refuses junk that would later "restore" as an empty book
  function checkData(data) {
    if (typeof data !== 'string' || !data) throw Object.assign(new Error('No data'), { status: 400, code: 'bad_data' });
    let o; try { o = JSON.parse(data); } catch (e) { throw Object.assign(new Error('Data is not valid JSON'), { status: 400, code: 'bad_data' }); }
    if (!o || typeof o !== 'object' || Array.isArray(o) || !Array.isArray(o.invoices) || typeof o.company !== 'object') throw Object.assign(new Error('Data is not an HGI Billing book'), { status: 400, code: 'bad_data' });
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
      const r = await store.delete({ sub: g.sub, key: userKey(g.sub), email: g.email });
      return send(req, res, 200, { ok: true, ...r, email: g.email });
    }

    if (p.startsWith('/v1/')) {
      const { s, user } = await session(req);
      if (limited('u:' + user.key, 120)) return send(req, res, 429, { error: 'too_many', message: 'Syncing too often — will retry shortly.' });
      const renewed = sessions.maybeRenew(s);
      const extra = renewed ? { 'X-HGI-Session': renewed.token } : {};
      if (req.method === 'GET' && p === '/v1/me') return send(req, res, 200, { user: { key: user.key, email: user.email, name: user.name }, cloud: await store.meta(user) }, extra);
      if (req.method === 'GET' && p === '/v1/sync/meta') return send(req, res, 200, { cloud: await store.meta(user) }, extra);
      if (req.method === 'GET' && p === '/v1/sync') {
        const r = await store.read(user);
        return send(req, res, 200, { cloud: r.meta, data: r.data }, extra);
      }
      if (req.method === 'PUT' && p === '/v1/sync') {
        const b = await readBody(req);
        checkData(b.data);
        try {
          const meta = await store.write(user, b.data, { baseVersion: b.baseVersion === '*' ? '*' : Number(b.baseVersion) || 0, clientRev: b.clientRev, device: b.device });
          log({ event: 'saved', user: user.key, version: meta.version, bytes: meta.bytes, unchanged: !!meta.unchanged });
          return send(req, res, 200, { cloud: meta }, extra);
        } catch (e) {
          if (e instanceof ConflictError) return send(req, res, 409, { error: 'conflict', message: e.message, cloud: e.meta }, extra);
          throw e;
        }
      }
      if (req.method === 'DELETE' && p === '/v1/account') return send(req, res, 200, { ok: true, ...(await store.delete(user)) });
    }
    return send(req, res, 404, { error: 'not_found' });
  }

  return http.createServer((req, res) => {
    const t0 = Date.now();
    route(req, res).catch(e => {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
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
  server.listen(cfg.port, () => log({ event: 'listening', port: cfg.port, driveAuth: cfg.driveAuth, testLogin: cfg.allowTestLogin }));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = { createServer };
