/* HGI Billing — Google Apps Script web app: the same API as the Cloud Run server (backend/lib/router.js), free of charge.
 *
 * Deploy: Execute as "Me" (the spreadsheet owner), access "Anyone". The app sends every call as ONE POST with a text/plain
 * JSON envelope  {m: method, p: path, q: {query}, t: session token, b: body}  (a "simple" request: no CORS pre-flight,
 * which Apps Script cannot answer) and gets back  {status, body}.  GET ?p=/v1/health · ?p=/privacy · ?p=/delete-account.
 *
 * Storage: the bound spreadsheet ("HGI Billing data"), through the Sheets API advanced service, with exactly the storage
 * engine of the Cloud Run server (backend/lib/sheet-db.js …). Apps Script keeps nothing between requests, so every request
 * reads the spreadsheet first; writes run under the script lock (one writer at a time) and are still one atomic
 * spreadsheets.batchUpdate each, checked against _Meta.writeCounter.
 * Secrets (session secret, password pepper) are created on the first request in Script Properties and never leave them.
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
      if (!all.SHEETS_SPREADSHEET_ID) { var ss = SpreadsheetApp.getActiveSpreadsheet(); if (!ss) throw new Error('Script is not bound to a spreadsheet and SHEETS_SPREADSHEET_ID is not set'); set.SHEETS_SPREADSHEET_ID = ss.getId(); }
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
  var db = new SheetDB({ client: new GasSheetsClient(cfg.spreadsheetId), tables: TABLES, log: __log, reloadMs: 3600e3, missReloadMs: 3600e3 });
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
  var router = createRouter({ cfg: cfg, db: db, store: store, accounts: accounts, files: off, gst: gst, edoc: edoc, ready: ready, log: __log, startedAt: new Date().toISOString(), runtime: 'apps-script', page: page, limited: limited });
  return { router: router, db: db, cfg: cfg };
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
