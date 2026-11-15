#!/usr/bin/env node
'use strict';
/**
 * HGI Billing — cloud service (Google Cloud Run + Google Sheets as the database + optional Cloud Storage for PDFs).
 * No third-party dependencies (Node 20+).
 *
 *   POST   /v1/auth/signup     {username, password, device}        create an account → session
 *   POST   /v1/auth/login      {username, password, device}        → session
 *   POST   /v1/auth/logout                                         end this session on the server
 *   POST   /v1/auth/logout-all                                     end every other session of the account
 *   POST   /v1/auth/password   {currentPassword, newPassword}      change password (other sessions end)
 *   GET    /v1/me                                                  account, sync position, which cloud features are set up
 *   GET    /v1/sync/pull?since=N                                   records changed after sequence N (other devices' work)
 *   POST   /v1/sync/push       {device, records:[…]}               upload changed records (per-record conflict + number checks)
 *   POST   /v1/numbers/check   {docType, num, docId}               is a document number still free?
 *   GET    /v1/gstin/{GSTIN}                                       taxpayer details from GST records (authorised provider)
 *   PUT    /v1/files/pdf/{docId}  {base64, num, …}                 store an invoice PDF;  GET /v1/files (list), GET …/pdf/{docId}
 *   DELETE /v1/account          {password}                         delete the account and all its cloud data (in-app)
 *   POST   /v1/account/delete-with-password {username, password}  same, from the web page /delete-account
 *   E-invoice / e-way bill (government APIs through HGI's GSP; each business uses its own API login):
 *   GET    /v1/edoc/credentials · PUT|DELETE /v1/edoc/credentials/{GSTIN} · POST /v1/edoc/preview|generate|refresh|cancel-irn|
 *          cancel-ewb|partb|transporter · GET /v1/edoc/record?key=
 *   GET    /privacy, /delete-account, /v1/health (also /healthz locally — Cloud Run's front end reserves paths ending in 'z')
 *
 * Every /v1 request except sign-up / log-in needs a session; the account (userId) always comes from the session, never
 * from the request, so no request can read or change another account's rows.
 * The app never holds a Google credential, the password pepper or the GST provider's key: those stay on this server.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const { GoogleAccess } = require('./lib/google-access');
const { SheetsClient } = require('./lib/sheets-client');
const { SheetDB } = require('./lib/sheet-db');
const { TABLES } = require('./lib/sheets-schema');
const { SheetsRecordStore } = require('./lib/sheets-record-store');
const { SheetsDocStore } = require('./lib/sheets-doc-store');
const { Accounts } = require('./lib/accounts');
const { FileStore } = require('./lib/files');
const { GstLookup } = require('./lib/gst');
const { UpstreamError } = require('./lib/http');
const { ApiError } = require('./lib/nic-http');
const { CredentialVault } = require('./lib/credentials');
const { EdocStore } = require('./lib/edoc-store');
const { EdocService } = require('./lib/edoc-service');
const { createRouter, memoryLimiter } = require('./lib/router');

const log = e => console.log(JSON.stringify({ severity: e.warn ? 'WARNING' : e.error ? 'ERROR' : 'INFO', at: new Date().toISOString(), ...e }));

function createServer(cfg, deps = {}) {
  const startedAt = new Date().toISOString();   // /healthz: lets the live check prove a NEW instance re-read the spreadsheet
  const access = deps.access || new GoogleAccess(cfg);
  const client = deps.sheets || new SheetsClient({ spreadsheetId: cfg.spreadsheetId, endpoint: cfg.endpoints.sheets, access });
  const db = new SheetDB({ client, tables: TABLES, log: deps.log || log, reloadMs: cfg.sheetsReloadMinutes * 60e3, missReloadMs: cfg.sheetsMissReloadMs });
  const fsdb = new SheetsDocStore(db);
  const store = new SheetsRecordStore(db, fsdb, log);
  const accounts = new Accounts(db, cfg, log);
  // the spreadsheet is opened (tabs / columns created, data loaded) before the first request is answered
  let opening = null;
  const ready = () => (db.opened ? Promise.resolve() : (opening = opening || db.open().catch(e => { opening = null; throw e; })));
  const files = new FileStore(cfg, access);
  const gst = new GstLookup(cfg, fsdb, log);
  const edoc = new EdocService(cfg.edoc, { vault: new CredentialVault(fsdb, cfg.edoc.credKey), store: new EdocStore(fsdb), log, timeoutMs: deps.edocTimeoutMs || 30000 });
  if (edoc.keyError) log({ warn: edoc.keyError });
  const pub = f => fs.readFileSync(path.join(__dirname, 'public', f), 'utf8');

  const router = createRouter({ cfg, db, store, accounts, files, gst, edoc, ready, log, startedAt, runtime: 'cloud-run',
    page: f => pub(f).replace(/\{\{SUPPORT_EMAIL\}\}/g, cfg.supportEmail || (f === 'delete-account.html' ? '' : 'the e-mail shown in the app listing')).replace(/\{\{API\}\}/g, ''),
    limited: memoryLimiter(), UpstreamError, ApiError });

  /* ------------------------------------------------------------ http transport */
  const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Strict-Transport-Security': 'max-age=31536000' };
  function cors(req) {
    const o = req.headers.origin;
    if (!o || !cfg.allowedOrigins.includes(o)) return {};
    return { 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS', 'Access-Control-Expose-Headers': 'X-HGI-Session', 'Access-Control-Max-Age': '600' };
  }
  function send(req, res, status, obj) {
    res.writeHead(status, { ...SEC, ...cors(req), 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }
  function page(req, res, html) {
    res.writeHead(200, { ...SEC, 'Cache-Control': 'public, max-age=300', 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'" });
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

  const srv = http.createServer((req, res) => {
    const t0 = Date.now();
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...SEC, ...cors(req) }); return res.end(); }
    const url = new URL(req.url, 'http://x');
    let body;   // read once, on demand
    router.handle({ method: req.method, path: url.pathname, query: url.searchParams, auth: req.headers.authorization || '', ip: ip(req),
      readBody: () => (body = body || readBody(req)) })
      .then(r => (r.html !== undefined ? page(req, res, r.html) : send(req, res, r.status, r.body)))
      .catch(e => { log({ error: e.message, path: url.pathname }); if (!res.headersSent) send(req, res, 500, { error: 'error', message: 'Something went wrong on the server. Please try again.' }); })
      .finally(() => { if (Date.now() - t0 > 10000) log({ warn: 'slow request', path: url.pathname, ms: Date.now() - t0 }); });
  });
  srv.ready = ready;
  srv.db = db;
  return srv;
}

if (require.main === module) {
  let cfg;
  try { cfg = config.load(); } catch (e) { console.error(e.message); process.exit(1); }
  const server = createServer(cfg);
  server.listen(cfg.port, () => {
    log({ event: 'listening', port: cfg.port, spreadsheet: cfg.spreadsheetId.slice(0, 6) + '…', gst: !!cfg.gst.url, files: !!cfg.filesBucket, edoc: { env: cfg.edoc.env, irp: !!cfg.edoc.irp.baseUrl, ewb: !!cfg.edoc.ewb.baseUrl } });
    server.ready().catch(e => log({ error: 'could not open the spreadsheet: ' + e.message }));
  });
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = { createServer };
