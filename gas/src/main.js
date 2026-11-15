/* HGI Billing — Google Apps Script web app: the same API as the Cloud Run server (backend/lib/router.js), free of charge.
 *
 * Deploy: Execute as "Me" (the spreadsheet owner), access "Anyone". The app sends every call as ONE POST with a text/plain
 * JSON envelope  {m: method, p: path, q: {query}, t: session token, b: body}  (a "simple" request: no CORS pre-flight,
 * which Apps Script cannot answer) and gets back  {status, body}.  GET ?p=/v1/health · ?p=/privacy · ?p=/delete-account.
 *
 * Permission: ONLY https://www.googleapis.com/auth/drive.file — the script can open only spreadsheets it created itself.
 * On its first run it creates its own private spreadsheet (title from Script Property SHEET_TITLE) and keeps its ID.
 * Storage: that spreadsheet, through the Sheets API advanced service, with exactly the storage
 * engine of the Cloud Run server (backend/lib/sheet-db.js …). Apps Script keeps nothing between requests, so every request
 * reads the spreadsheet first; writes run under the script lock (one writer at a time) and are still one atomic
 * spreadsheets.batchUpdate each, checked against _Meta.writeCounter.
 * Secrets (session secret, password pepper) are created on the first request in Script Properties and never leave them;
 * they can be replaced ONCE by the owner-armed import (hgiArmSecretImport) so both servers share them (see docs/FREE-SERVER.md).
 * One server at a time: backend-guard.js (_Meta.activeBackend); switch with hgiActivateAppsScript / hgiActivateCloudRun.
 * Passwords: PBKDF2-HMAC-SHA256 with the pepper (Apps Script has no scrypt); iterations measured once, ~1 s per hash.
 * Not available here: e-invoice / e-way bill (needs RSA encryption), PDF cloud copies, GSTIN look-up.
 */
var HGI_SCHEMA_VERSION = '9.4-1';

function __props() { return PropertiesService.getScriptProperties(); }
function __log(e) { try { console.log(JSON.stringify(Object.assign({ severity: e.warn ? 'WARNING' : e.error ? 'ERROR' : 'INFO', at: new Date().toISOString() }, e))); } catch (x) { /* logging must never fail a request */ } }

/** secrets + settings, created once (under the lock) */
function __settings() {
  var P = __props(), all = P.getProperties();
  if (!all.SESSION_SECRET || !all.PASSWORD_PEPPER || !all.SHEETS_SPREADSHEET_ID || !all.PBKDF2_ITER) {
    var lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      all = P.getProperties();
      var set = {};
      var crypto = __require('crypto');
      if (!all.SESSION_SECRET) set.SESSION_SECRET = crypto.randomBytes(48).toString('base64');
      if (!all.PASSWORD_PEPPER) set.PASSWORD_PEPPER = crypto.randomBytes(48).toString('base64');
      if (!all.SHEETS_SPREADSHEET_ID) {
        // drive.file: the script may only open files it created — so it creates its own private spreadsheet
        var created = Sheets.Spreadsheets.create({ properties: { title: all.SHEET_TITLE || 'HGI Billing data (Apps Script TEST)', locale: 'en_IN', timeZone: 'Asia/Kolkata' } });
        set.SHEETS_SPREADSHEET_ID = created.spreadsheetId;
      }
      if (!all.PBKDF2_ITER) {
        // how many PBKDF2 rounds take about one second here (between 10,000 and 600,000)
        var t0 = Date.now(); crypto.pbkdf2Sync('probe', 'saltsaltsaltsalt', 2000, 32, 'sha256'); var ms = Math.max(1, Date.now() - t0);
        set.PBKDF2_ITER = String(Math.max(10000, Math.min(600000, Math.round(2000 * 1000 / ms / 1000) * 1000)));
      }
      if (Object.keys(set).length) { P.setProperties(set); __log({ event: 'settings_created', keys: Object.keys(set).filter(function (k) { return k !== 'SESSION_SECRET' && k !== 'PASSWORD_PEPPER'; }), secrets: !!(set.SESSION_SECRET || set.PASSWORD_PEPPER), pbkdf2: set.PBKDF2_ITER }); }
      all = P.getProperties();
    } finally { lock.releaseLock(); }
  }
  return {
    spreadsheetId: all.SHEETS_SPREADSHEET_ID, sessionSecret: all.SESSION_SECRET, passwordPepper: all.PASSWORD_PEPPER,
    kdf: 'pbkdf2', pbkdf2Iterations: Number(all.PBKDF2_ITER) || 20000,
    sessionDays: Number(all.SESSION_DAYS) || 30, allowSignup: all.ALLOW_SIGNUP !== '0',
    // Apps Script does not see the caller's IP: these are limits for everyone together
    signupPerMinute: Number(all.SIGNUP_PER_MINUTE) || 20, loginPerMinute: Number(all.LOGIN_PER_MINUTE) || 60,
    supportEmail: all.SUPPORT_EMAIL || '', maxBodyBytes: 25 * 1024 * 1024
  };
}

/** the Sheets calls the storage engine needs, through the Sheets API advanced service */
function GasSheetsClient(id) { this.id = id; this.calls = { read: 0, write: 0 }; }
GasSheetsClient.prototype.wrap = function (fn) {
  var UpstreamError = __require('http').UpstreamError;
  try { return fn(); } catch (e) { throw new UpstreamError('Google Sheets: ' + (e && e.message || e), 503, true); }
};
GasSheetsClient.prototype.meta = function () {
  var id = this.id; this.calls.read++;
  return this.wrap(function () { return Sheets.Spreadsheets.get(id, { fields: 'properties.title,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)),protectedRanges(protectedRangeId,range,description))' }); });
};
GasSheetsClient.prototype.batchGet = function (ranges) {
  if (!ranges.length) return [];
  var id = this.id; this.calls.read++;
  var r = this.wrap(function () { return Sheets.Spreadsheets.Values.batchGet(id, { ranges: ranges, valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER', majorDimension: 'ROWS' }); });
  return (r.valueRanges || []).map(function (v) { return v.values || []; });
};
GasSheetsClient.prototype.getValue = function (range) {
  var id = this.id; this.calls.read++;
  var r = this.wrap(function () { return Sheets.Spreadsheets.Values.get(id, range, { valueRenderOption: 'UNFORMATTED_VALUE' }); });
  return r.values && r.values[0] ? r.values[0][0] : undefined;
};
GasSheetsClient.prototype.batchUpdate = function (requests) {
  if (!requests.length) return {};
  var id = this.id; this.calls.write++;
  return this.wrap(function () { return Sheets.Spreadsheets.batchUpdate({ requests: requests, includeSpreadsheetInResponse: false }, id); });
};

/** one request's worth of server: the bundled modules wired together */
function __server() {
  var cfg = __settings();
  var SheetDB = __require('sheet-db').SheetDB, TABLES = __require('sheets-schema').TABLES;
  var SheetsRecordStore = __require('sheets-record-store').SheetsRecordStore, SheetsDocStore = __require('sheets-doc-store').SheetsDocStore;
  var Accounts = __require('accounts').Accounts, createRouter = __require('router').createRouter;
  var guard = __require('backend-guard');
  var db = new SheetDB({ client: new GasSheetsClient(cfg.spreadsheetId), tables: TABLES, log: __log, reloadMs: 3600e3, missReloadMs: 3600e3, writeGuard: guard.writeGuard('apps-script') });
  // one writer at a time across all running requests
  db.exclusive = function (fn) { var lock = LockService.getScriptLock(); lock.waitLock(30000); try { return fn(); } finally { lock.releaseLock(); } };
  var ready = function () {
    if (db.opened) return;
    var P = __props();
    if (P.getProperty('SCHEMA_VERSION') !== HGI_SCHEMA_VERSION || !P.getProperty('QUOTE_MODE')) {
      db.open();                                               // creates tabs / columns, probes the apostrophe mode, loads
      P.setProperties({ SCHEMA_VERSION: HGI_SCHEMA_VERSION, QUOTE_MODE: db.quoteMode });
    } else {
      db.quoteMode = P.getProperty('QUOTE_MODE'); db.t('_Meta').quoteMode = db.quoteMode;
      db.load(); db.opened = true;
    }
  };
  var docs = new SheetsDocStore(db);
  var store = new SheetsRecordStore(db, docs, __log);
  var accounts = new Accounts(db, cfg, __log);
  var off = { enabled: function () { return false; }, configured: function () { return false; }, features: function () { return { irp: false, ewb: false, env: null }; } };
  var edocOff = function () { var e = new Error('E-invoice and e-way bill are not available on the free (Apps Script) server. Nothing was sent to the GST system.'); e.status = 503; e.code = 'EDOC_NOT_CONFIGURED'; throw e; };
  var edoc = { features: off.features, listCredentials: function () { return []; }, saveCredentials: edocOff, deleteCredentials: edocOff, record: edocOff, preview: edocOff, generate: edocOff, refresh: edocOff, cancelIrn: edocOff, cancelEwb: edocOff, updatePartB: edocOff, updateTransporter: edocOff };
  var gst = { configured: off.configured, lookup: function () { var e = new Error('GST lookup is not set up on the server yet.'); e.status = 503; e.code = 'gst_not_configured'; throw e; } };
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { /* not deployed (editor run) */ }
  var page = function (name) {
    var html = __PAGES[name] || '';
    return html.replace(/\{\{SUPPORT_EMAIL\}\}/g, cfg.supportEmail || (name === 'delete-account.html' ? '' : 'the e-mail shown in the app listing')).replace(/\{\{API\}\}/g, url).replace(/href="\/(privacy|delete-account)"/g, 'href="' + url + '?p=/$1" target="_top"');
  };
  var cache = CacheService.getScriptCache();
  var limited = function (key, perMin) {
    var k = 'rl:' + key + ':' + Math.floor(Date.now() / 60000), n = Number(cache.get(k) || 0) + 1;
    cache.put(k, String(n), 120);
    return n > perMin;
  };
  cfg.retiredRecheckMs = 0;                                  // every request reads the spreadsheet anyway
  var router = createRouter({ cfg: cfg, db: db, store: store, accounts: accounts, files: off, gst: gst, edoc: edoc, ready: ready, log: __log, startedAt: new Date().toISOString(), runtime: 'apps-script', backend: 'apps-script', page: page, limited: limited });
  return { router: router, db: db, cfg: cfg, ready: ready, guard: guard };
}

function __json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function __answer(r) {
  if (r.html !== undefined) return HtmlService.createHtmlOutput(r.html).setTitle('HGI Billing').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return __json({ status: r.status, body: r.body });
}
function __handle(req) {
  try { return __server().router.handle(req); }
  catch (e) { __log({ error: String(e && e.stack || e) }); return { status: 500, body: { error: 'error', message: 'Something went wrong on the server. Please try again.' } }; }
}

function doPost(e) {
  var raw = e && e.postData ? e.postData.contents : '';
  if (raw.length > 25 * 1024 * 1024) return __json({ status: 413, body: { error: 'too_large', message: 'Data is too large to sync' } });
  var env;
  try { env = JSON.parse(raw || '{}'); } catch (x) { return __json({ status: 400, body: { error: 'bad_json', message: 'Request is not valid JSON' } }); }
  if (env.p === '/v1/admin/import-secrets') { try { return __json(__importSecrets(env.b || {})); } catch (x) { __log({ error: 'import: ' + x.message }); return __json({ status: 500, body: { error: 'error', message: 'Import failed.' } }); } }
  var q = env.q && typeof env.q === 'object' ? env.q : {};
  var r = __handle({ method: String(env.m || 'POST').toUpperCase(), path: String(env.p || '/'), query: { get: function (k) { return q[k] === undefined ? null : String(q[k]); } },
    auth: typeof env.t === 'string' && env.t ? 'Bearer ' + env.t : '', ip: 'apps-script', readBody: function () { return env.b && typeof env.b === 'object' ? env.b : {}; } });
  return __json({ status: r.status, body: r.html !== undefined ? { error: 'not_found' } : r.body });
}

function doGet(e) {
  var p = (e && e.parameter && e.parameter.p) || '/';
  var q = (e && e.parameter) || {};
  var r = __handle({ method: 'GET', path: String(p), query: { get: function (k) { return q[k] === undefined ? null : String(q[k]); } }, auth: '', ip: 'apps-script', readBody: function () { return {}; } });
  return __answer(r);
}

/** run once from the editor (optional): creates secrets, tabs and columns and shows the result in the log */
function hgiSetup() {
  var s = __server(); s.router.handle({ method: 'GET', path: '/v1/health', query: { get: function () { return null; } }, auth: '', ip: 'setup', readBody: function () { return {}; } });
  __log({ event: 'setup_done', quoteMode: s.db.quoteMode, pbkdf2Iterations: s.cfg.pbkdf2Iterations, cells: s.db.cellsUsed() });
}


/* ---------------------------------------------------------------- owner tools (run from the Apps Script editor) */

/** which server serves the app now, the spreadsheet, the secrets' state (never their values) */
function hgiStatus() {
  var s = __server(); s.ready(); var P = __props().getProperties();
  var users = s.db.t('Users').all().filter(function (u) { return u.status === 'active'; }).length;
  __log({ event: 'status', spreadsheetId: s.cfg.spreadsheetId, activeBackend: s.guard.activeOf(s.db) || '(not set)', activeUsers: users,
    secrets: { session: !!P.SESSION_SECRET, pepper: !!P.PASSWORD_PEPPER, imported: P.SECRETS_IMPORTED_AT || 'no' }, pbkdf2Iterations: s.cfg.pbkdf2Iterations });
}
/** cut-over: this Apps Script server serves the app; the Cloud Run server answers "install the update" */
function hgiActivateAppsScript() { var s = __server(); s.ready(); s.guard.activate(s.db, 'apps-script', 'owner (Apps Script editor)'); __log({ event: 'activated', active: 'apps-script' }); }
/** roll-back: the Cloud Run server serves the app again; this server answers "install the update" */
function hgiActivateCloudRun() { var s = __server(); s.ready(); s.guard.activate(s.db, 'cloud-run', 'owner (Apps Script editor)'); __log({ event: 'activated', active: 'cloud-run' }); }

/**
 * Allows ONE import of the two secrets (so this server and the Cloud Run server accept the same passwords and sessions)
 * during the next 15 minutes, with the one-time code shown in this execution's log. The import is refused when any
 * active account exists (changing the pepper would lock those users out). Values travel only from Secret Manager to here.
 */
function hgiArmSecretImport() {
  var code = __require('crypto').randomBytes(12).toString('base64url');
  __props().setProperties({ IMPORT_CODE: code, IMPORT_UNTIL: String(Date.now() + 15 * 60e3), IMPORT_TRIES: '0' });
  __log({ event: 'secret_import_armed', code: code, until: new Date(Date.now() + 15 * 60e3).toISOString() });
}
function __importSecrets(b) {
  var P = __props(), all = P.getProperties();
  var deny = function (msg) { return { status: 403, body: { error: 'import_refused', message: msg } }; };
  if (!all.IMPORT_CODE || !(Number(all.IMPORT_UNTIL) > Date.now())) return deny('Import is not armed (run hgiArmSecretImport in the editor).');
  var tries = Number(all.IMPORT_TRIES || 0) + 1;
  if (typeof b.code !== 'string' || b.code !== all.IMPORT_CODE) {
    if (tries >= 5) { P.deleteProperty('IMPORT_CODE'); P.deleteProperty('IMPORT_UNTIL'); } else P.setProperty('IMPORT_TRIES', String(tries));
    return deny('Wrong import code.');
  }
  var ss = String(b.sessionSecret || ''), pp = String(b.passwordPepper || '');
  if (ss.length < 32 || pp.length < 32 || ss === pp) return { status: 400, body: { error: 'bad_secrets', message: 'Both secrets must be at least 32 characters and different.' } };
  var s = __server(); s.ready();
  var active = s.db.t('Users').all().filter(function (u) { return u.status === 'active'; }).length;
  if (active) return deny('There are ' + active + ' active accounts: replacing the password pepper now would lock them out.');
  P.setProperties({ SESSION_SECRET: ss, PASSWORD_PEPPER: pp, SECRETS_IMPORTED_AT: new Date().toISOString() });
  P.deleteProperty('IMPORT_CODE'); P.deleteProperty('IMPORT_UNTIL'); P.deleteProperty('IMPORT_TRIES');
  __log({ event: 'secrets_imported' });
  return { status: 200, body: { ok: true } };
}

/**
 * Proves on the real deployment: the script can CREATE its spreadsheet, READ it, UPDATE it, that one spreadsheets.batchUpdate
 * is applied completely or not at all, and that an invoice (document row + its lines + payment + number claim) is written
 * by exactly ONE such call. Leaves no account behind.
 */
function hgiSelfTest() {
  var out = { ok: true, checks: [] };
  var check = function (c, m) { out.checks.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) out.ok = false; };
  var s = __server(); s.ready();
  var id = s.cfg.spreadsheetId, db = s.db;
  var meta = Sheets.Spreadsheets.get(id, { fields: 'properties.title,sheets.properties.title' });
  check(!!meta.properties.title, 'create + read: the script opened its own spreadsheet "' + meta.properties.title + '" (' + meta.sheets.length + ' tabs)');
  // update + read back through Google (not the in-memory copy)
  var stamp = 'selftest ' + new Date().toISOString();
  db.tx(function (w) { w.put('_Meta', { key: 'selfTest', value: stamp }); }, { bypassGuard: true });
  var T = db.t('_Meta'), e = T.byKey.get(T.keyOf({ key: 'selfTest' })), vi = T.colAt.get('value');
  var cell = "'_Meta'!" + __require('sheets-client').colLetter(vi) + (e.r + 2);
  var readBack = Sheets.Spreadsheets.Values.get(id, cell, { valueRenderOption: 'UNFORMATTED_VALUE' }).values[0][0];
  check(readBack === stamp, 'update + read: wrote and read back ' + cell);
  // all-or-nothing: a valid change + an invalid request in ONE batchUpdate → Google must apply neither
  var counterBefore = db.readCounter(), failed = false;
  try {
    Sheets.Spreadsheets.batchUpdate({ requests: [
      { updateCells: { range: { sheetId: T.sheetId, startRowIndex: e.r + 1, endRowIndex: e.r + 2, startColumnIndex: vi, endColumnIndex: vi + 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: 'MUST-NOT-APPEAR' } }] }], fields: 'userEnteredValue' } },
      { updateCells: { range: { sheetId: 987654321, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: 'x' } }] }], fields: 'userEnteredValue' } }
    ] }, id);
  } catch (x) { failed = true; }
  var after = Sheets.Spreadsheets.Values.get(id, cell, { valueRenderOption: 'UNFORMATTED_VALUE' }).values[0][0];
  check(failed && after === stamp && db.readCounter() === counterBefore, 'all-or-nothing: a batch with one bad request was rejected and its valid part was NOT applied');
  // an invoice with 2 lines + 1 payment through the real API path: one write (writeCounter +1), rows in 4 tabs
  var r = function (m, p, b, t) { return s.router.handle({ method: m, path: p, query: { get: function () { return null; } }, auth: t ? 'Bearer ' + t : '', ip: 'selftest', readBody: function () { return b || {}; } }); };
  var user = 'selftest-' + __require('crypto').randomBytes(3).toString('hex'), pw = 'Self-' + __require('crypto').randomBytes(9).toString('base64url');
  var su = r('POST', '/v1/auth/signup', { username: user, password: pw, device: 'selftest' });
  check(su.status === 201, 'sign-up of a temporary account (' + su.status + ')');
  if (su.status === 201) {
    var tok = su.body.session, uid = su.body.user.key;
    var doc = { id: 'ST1', docType: 'INV', num: 'ST/1', date: '2026-11-16', buyerName: 'Self Test Buyer', items: [{ desc: 'Line one', qty: 2, rate: 100, gst: 18 }, { desc: 'Line two', qty: 1, rate: 50, gst: 5 }], payments: [{ id: 'P1', date: '2026-11-16', amount: 100, mode: 'UPI' }], grandTotal: 288.5 };
    var c0 = db.readCounter();
    var p = r('POST', '/v1/sync/push', { device: 'selftest', records: [{ kind: 'invoice', id: 'ST1', baseRev: 0, data: JSON.stringify(doc) }] }, tok);
    var c1 = db.readCounter();
    check(p.status === 200 && p.body.results[0].status === 'ok', 'invoice upload accepted');
    check(c1 === c0 + 1, 'the invoice, its 2 lines, its payment and its number were written by ONE all-or-nothing batch (writeCounter ' + c0 + ' → ' + c1 + ')');
    db.load();
    var rows = function (tab) { return db.t(tab).all().filter(function (x) { return x.userId === uid; }).length; };
    check(rows('Invoices') === 1 && rows('InvoiceItems') === 2 && rows('Payments') === 1 && rows('DocNumbers') === 1, 'rows: Invoices 1, InvoiceItems 2, Payments 1, DocNumbers 1');
    var back = r('GET', '/v1/sync/pull', null, tok);
    check(back.status === 200 && back.body.records.some(function (x) { return x.id === 'ST1' && x.data === JSON.stringify(doc); }), 'read back byte-for-byte');
    var del = r('DELETE', '/v1/account', { password: pw }, tok);
    check(del.status === 200, 'temporary account deleted (' + del.status + ')');
  }
  __log({ event: 'selftest', ok: out.ok, checks: out.checks });
  return out;
}
