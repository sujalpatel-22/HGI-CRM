'use strict';
/**
 * The HTTP API, independent of how requests arrive. Used by server.js (Node on Cloud Run) and by the Google Apps Script
 * web app (gas/, where every call arrives as one POST envelope). Same routes, same answers, same checks.
 *
 *   handle(req) → { status, body } | { status, html }
 *   req = { method, path, query: { get(name) }, auth: 'Bearer …' | '', ip, readBody: async () => object }
 *
 * deps: { cfg, db, store, accounts, files, gst, edoc, ready, log, startedAt, page(name) → html, limited(key, perMin),
 *         UpstreamError, ApiError }  (the two error classes are optional: matched by name when not given)
 */
const guard = require('./backend-guard');

function createRouter(d) {
  const { cfg, db, store, accounts, files, gst, edoc, log } = d;
  const isUpstream = e => (d.UpstreamError ? e instanceof d.UpstreamError : false) || (e && e.name === 'UpstreamError');
  const isApi = e => (d.ApiError ? e instanceof d.ApiError : false) || (e && e.isApiError === true);
  const ok = (status, body) => ({ status, body });
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : '');
  const limited = d.limited;

  async function deleteAccount(uid) {
    let n = 0;
    if (files.enabled()) for (const f of await store.fileEntries(uid)) { await files.remove(f.object); n++; }
    const r = await accounts.deleteAccount(uid, w => store.deleteAll(uid, w));
    return { records: r.records, files: n, deletedAt: r.deletedAt };
  }

  async function route(req) {
    const p = req.path, M = req.method;
    if (M === 'GET' && (p === '/v1/health' || p === '/healthz')) {
      try { await d.ready(); } catch (e) { return ok(503, { ok: false, error: 'sheets_unavailable', message: e.message }); }
      const cells = db.cellsUsed(), active = guard.activeOf(db);
      return ok(200, { ok: true, storage: 'google-sheets', runtime: d.runtime || 'node', backend: d.backend, activeBackend: active || null, serving: !active || active === d.backend, startedAt: d.startedAt, quoteMode: db.quoteMode, cells, cellLimit: 10e6, ...(cells > 7e6 ? { warning: 'The spreadsheet is above 70 % of Google\'s 10 million cell limit.' } : {}) });
    }
    if (M === 'GET' && (p === '/' || p === '/privacy')) return { status: 200, html: d.page(p === '/' ? 'index.html' : 'privacy.html') };
    if (M === 'GET' && p === '/delete-account') return { status: 200, html: d.page('delete-account.html') };
    if (!p.startsWith('/v1/')) return ok(404, { error: 'not_found' });
    await d.ready();
    if (d.backend) {                                       // the switched-off server answers "install the update"
      const a = guard.activeOf(db);
      if (a && a !== d.backend) await db.refreshIfOlder(cfg.retiredRecheckMs == null ? 15000 : cfg.retiredRecheckMs);   // switched back since?
      guard.checkActive(db, d.backend);
    }

    if (M === 'POST' && p === '/v1/auth/signup') {
      if (!cfg.allowSignup) return ok(403, { error: 'signup_closed', message: 'New accounts are not being accepted right now.' });
      if (await limited('signup:' + req.ip, cfg.signupPerMinute)) return ok(429, { error: 'too_many', message: 'Too many new accounts from this network. Wait a minute.' });
      const b = await req.readBody();
      return ok(201, await accounts.signup({ username: str(b.username, 60), password: str(b.password, 512), device: str(b.device, 200) }));
    }
    if (M === 'POST' && p === '/v1/auth/login') {
      if (await limited('login:' + req.ip, cfg.loginPerMinute)) return ok(429, { error: 'too_many', message: 'Too many log-in attempts. Wait a minute.' });
      const b = await req.readBody();
      return ok(200, await accounts.login({ username: str(b.username, 60), password: str(b.password, 512), device: str(b.device, 200) }));
    }
    if (M === 'POST' && p === '/v1/account/delete-with-password') {
      if (await limited('login:' + req.ip, cfg.loginPerMinute)) return ok(429, { error: 'too_many', message: 'Too many attempts. Wait a minute.' });
      const b = await req.readBody();
      const u = await accounts.findForDeletion(str(b.username, 60), str(b.password, 512));
      const r = await deleteAccount(u.userId);
      return ok(200, { ok: true, ...r, deleted: true, username: u.username });
    }

    const { user, sessionId } = await accounts.authenticate(req.auth);
    if (await limited('u:' + user.key, 240)) return ok(429, { error: 'too_many', message: 'Syncing too often — will retry shortly.' });
    const uid = user.key;
    if (M === 'POST' && p === '/v1/auth/logout') { await accounts.logout(sessionId); return ok(200, { ok: true }); }
    if (M === 'POST' && p === '/v1/auth/logout-all') return ok(200, { ok: true, ended: await accounts.logoutAll(uid, sessionId) });
    if (M === 'POST' && p === '/v1/auth/password') {
      if (await limited('pw:' + uid, 10)) return ok(429, { error: 'too_many', message: 'Too many attempts. Wait a minute.' });
      const b = await req.readBody();
      return ok(200, await accounts.changePassword(uid, sessionId, str(b.currentPassword, 512), str(b.newPassword, 512)));
    }
    if (M === 'GET' && p === '/v1/me') return ok(200, { user: { key: uid, username: user.username, createdAt: user.createdAt }, cloud: await store.state(uid), features: { gst: gst.configured(), files: files.enabled(), edoc: edoc.features() } });
    if (M === 'GET' && p === '/v1/sync/pull') {
      const since = Math.max(0, Number(req.query.get('since')) || 0), limit = Math.min(500, Math.max(1, Number(req.query.get('limit')) || 300));
      return ok(200, await store.pull(uid, since, limit));
    }
    if (M === 'POST' && p === '/v1/sync/push') {
      const b = await req.readBody();
      const r = await store.push(uid, user, b.records, b.device);
      const counts = r.results.reduce((a, x) => (a[x.status] = (a[x.status] || 0) + 1, a), {});
      log({ event: 'push', user: uid, ...counts });
      return ok(200, r);
    }
    if (M === 'POST' && p === '/v1/numbers/check') {
      const b = await req.readBody();
      if (!b.num) return ok(400, { error: 'bad_request', message: 'num required' });
      return ok(200, await store.numberFree(uid, b.docType || 'INV', b.num, b.docId || ''));
    }
    let m;
    if (M === 'GET' && (m = /^\/v1\/gstin\/([0-9A-Za-z]{15})$/.exec(p))) {
      if (await limited('gst:' + uid, 30)) return ok(429, { error: 'too_many', message: 'Too many GST lookups — wait a minute.' });
      return ok(200, await gst.lookup(m[1], { fresh: req.query.get('fresh') === '1' }));
    }
    if (M === 'GET' && p === '/v1/files') return ok(200, { files: files.enabled() ? (await store.fileEntries(uid)).map(({ object, ...x }) => x) : [], enabled: files.enabled() });
    if ((m = /^\/v1\/files\/pdf\/([^/]{1,200})$/.exec(p))) {
      if (!files.enabled()) return ok(503, { error: 'files_not_configured', message: 'PDF storage is not set up on the server yet.' });
      const docId = decodeURIComponent(m[1]);
      if (M === 'PUT') {
        const b = await req.readBody();
        const buf = Buffer.from(String(b.base64 || ''), 'base64');
        if (buf.length < 100 || buf.slice(0, 5).toString() !== '%PDF-') return ok(400, { error: 'not_pdf', message: 'That is not a PDF file.' });
        if (buf.length > 15 * 1024 * 1024) return ok(413, { error: 'too_large', message: 'PDF is larger than 15 MB.' });
        const object = files.object(uid, docId);
        await files.put(object, buf);
        const entry = { object, bytes: buf.length, num: String(b.num || '').slice(0, 60), docType: String(b.docType || '').slice(0, 10), hash: String(b.hash || '').slice(0, 64), uploadedAt: new Date().toISOString() };
        await store.putFileEntry(uid, docId, entry);
        return ok(200, { ok: true, bytes: buf.length });
      }
      if (M === 'GET') {
        const e = await store.getFileEntry(uid, docId);
        if (!e) return ok(404, { error: 'not_found' });
        const buf = await files.get(e.object);
        if (!buf) return ok(404, { error: 'not_found' });
        return ok(200, { base64: buf.toString('base64'), num: e.num, uploadedAt: e.uploadedAt });
      }
    }
    if (p.startsWith('/v1/edoc/')) {
      if (await limited('edoc:' + uid, 40)) return ok(429, { error: 'too_many', message: 'Too many e-invoice requests — wait a minute.' });
      const by = user.username;
      if (M === 'GET' && p === '/v1/edoc/credentials') return ok(200, { credentials: await edoc.listCredentials(uid), features: edoc.features() });
      if ((m = /^\/v1\/edoc\/credentials\/([0-9A-Za-z]{15})$/.exec(p))) {
        if (M === 'PUT') return ok(200, { credential: await edoc.saveCredentials(uid, m[1], await req.readBody()) });
        if (M === 'DELETE') { await edoc.deleteCredentials(uid, m[1]); return ok(200, { ok: true }); }
      }
      if (M === 'GET' && p === '/v1/edoc/record') return ok(200, await edoc.record(uid, req.query.get('key'), req.query.get('full') === '1'));
      if (M === 'POST') {
        const b = await req.readBody();
        if (p === '/v1/edoc/preview') return ok(200, await edoc.preview(uid, b.doc, b.company, b.mode));
        if (p === '/v1/edoc/generate') return ok(200, await edoc.generate(uid, b.doc, b.company, b.mode, by));
        if (p === '/v1/edoc/refresh') return ok(200, await edoc.refresh(uid, String(b.key || '')));
        if (p === '/v1/edoc/cancel-irn') return ok(200, await edoc.cancelIrn(uid, String(b.key || ''), b.reasonCode, b.remark, by));
        if (p === '/v1/edoc/cancel-ewb') return ok(200, await edoc.cancelEwb(uid, String(b.key || ''), b.reasonCode, b.remark, by));
        if (p === '/v1/edoc/partb') return ok(200, await edoc.updatePartB(uid, String(b.key || ''), b, by));
        if (p === '/v1/edoc/transporter') return ok(200, await edoc.updateTransporter(uid, String(b.key || ''), b.transporterId, by));
      }
      return ok(404, { error: 'not_found' });
    }
    if (M === 'DELETE' && p === '/v1/account') {
      const b = await req.readBody();
      await accounts.checkPasswordOf(uid, str(b.password, 512));          // a second check that the owner is deleting
      return ok(200, { ok: true, ...(await deleteAccount(uid)) });
    }
    return ok(404, { error: 'not_found' });
  }

  /** route + the error answers (never success for a failure; internal details are logged, not shown) */
  async function handle(req) {
    try {
      return await route(req);
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (isApi(e)) {
        if (e.status >= 500) log({ warn: true, error: e.message, code: e.code, path: req.path });
        return ok(e.status || 502, { error: e.code, message: e.message, errors: e.errors || [], warnings: (e.info && e.info.warnings) || [] });
      }
      const upstream = isUpstream(e);
      const code = upstream ? 503 : status;
      if (code >= 500) log({ error: e.message, path: req.path, status: code });
      const message = upstream ? 'Cloud storage (Google Sheets) is not reachable right now. Your data is safe on this phone and will sync later.'
        : code >= 500 && !e.code ? 'Something went wrong on the server. Please try again.' : e.message;
      return ok(code, { error: e.code || (upstream ? 'cloud_unavailable' : 'error'), message });
    }
  }
  return { handle, deleteAccount };
}

/** in-memory per-minute counters (one Node process) */
function memoryLimiter() {
  const buckets = new Map();
  return function limited(key, perMin) {
    const now = Date.now(); let b = buckets.get(key);
    if (!b || now - b.t > 60e3) { b = { t: now, n: 0 }; buckets.set(key, b); }
    if (buckets.size > 20000) for (const [k, v] of buckets) if (now - v.t > 60e3) buckets.delete(k);
    return ++b.n > perMin;
  };
}

module.exports = { createRouter, memoryLimiter };
