'use strict';
/**
 * A local stand-in for Google Apps Script, to test gas/dist/Code.js before it is deployed:
 *   - Utilities (digests, HMAC-SHA256 with Java-style signed bytes, getUuid), Sheets advanced service (→ test/fake-sheets.js),
 *     PropertiesService, LockService (refuses nested locking, which Apps Script would deadlock on), CacheService,
 *     ContentService, HtmlService, ScriptApp, SpreadsheetApp.getActiveSpreadsheet()
 *   - every request runs in a NEW global scope (Apps Script keeps nothing in memory between executions)
 *   - an HTTP front that behaves like script.google.com/macros/s/…/exec for the app and scripts/verify-deployment.js --gas
 * It proves the bundle's logic; it is not Google's runtime (quotas, speed, real redirects are checked on the real deployment).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const crypto = require('crypto');

const signed = b => Array.from(b, v => (v > 127 ? v - 256 : v));
const bytes = x => (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map(v => v & 255)));

class GasSim {
  constructor({ fake, spreadsheetId, codePath, props = {} }) {
    this.fake = fake; this.spreadsheetId = spreadsheetId;
    this.code = new vm.Script(fs.readFileSync(codePath || path.join(__dirname, '..', '..', 'gas', 'dist', 'Code.js'), 'utf8'), { filename: 'Code.js' });
    this.props = { ...props }; this.cache = new Map(); this.locked = false; this.url = '';
    this.logs = []; this.executions = 0; this.hmacCalls = 0; this.createdSheets = [];
  }
  globals() {
    const sim = this, fake = this.fake;
    const sheetsCall = (id, rest, method, search, body) => {
      const url = new URL('https://sheets.test/v4/spreadsheets/' + encodeURIComponent(id) + rest + (search || ''));
      try { return JSON.parse(JSON.stringify(fake.run(id, rest, { method }, url, body))); }
      catch (e) { throw new Error(`GoogleJsonResponseException: API call to sheets failed with error: ${e.message}`); }
    };
    const qs = o => '?' + Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, x]) : [[k, v]])).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const lock = {
      waitLock() { if (sim.locked) throw new Error('LockService: nested waitLock in one execution (would deadlock on Apps Script)'); sim.locked = true; },
      tryLock() { this.waitLock(); return true; },
      releaseLock() { sim.locked = false; },
      hasLock() { return sim.locked; }
    };
    return {
      console: { log: (...a) => sim.logs.push(a.join(' ')) },
      Utilities: {
        DigestAlgorithm: { SHA_1: 'sha1', SHA_256: 'sha256' },
        computeDigest: (alg, value) => signed(crypto.createHash(alg).update(bytes(value)).digest()),
        computeHmacSha256Signature: (value, key) => { sim.hmacCalls++; return signed(crypto.createHmac('sha256', bytes(key)).update(bytes(value)).digest()); },
        getUuid: () => crypto.randomUUID()
      },
      Sheets: {
        Spreadsheets: {
          create: body => { const id = fake.create((body.properties || {}).title || 'Untitled'); sim.createdSheets.push(id); return { spreadsheetId: id, properties: body.properties }; },
          get: (id, o = {}) => sheetsCall(id, '', 'GET', o.fields ? qs({ fields: o.fields }) : ''),
          batchUpdate: (body, id) => sheetsCall(id, ':batchUpdate', 'POST', '', body),
          Values: {
            batchGet: (id, o) => sheetsCall(id, '/values:batchGet', 'GET', qs({ ranges: o.ranges, valueRenderOption: o.valueRenderOption, dateTimeRenderOption: o.dateTimeRenderOption, majorDimension: o.majorDimension })),
            get: (id, range, o = {}) => sheetsCall(id, '/values/' + range, 'GET', qs({ valueRenderOption: o.valueRenderOption || 'FORMATTED_VALUE' }))
          }
        }
      },
      PropertiesService: { getScriptProperties: () => ({
        getProperties: () => ({ ...sim.props }), getProperty: k => (k in sim.props ? sim.props[k] : null), deleteProperty: k => { delete sim.props[k]; },
        setProperties: o => { for (const [k, v] of Object.entries(o)) sim.props[k] = String(v); }, setProperty: (k, v) => { sim.props[k] = String(v); }
      }) },
      LockService: { getScriptLock: () => lock },
      CacheService: { getScriptCache: () => ({
        get: k => { const e = sim.cache.get(k); return e && e.until > Date.now() ? e.v : null; },
        put: (k, v, s) => { sim.cache.set(k, { v: String(v), until: Date.now() + (s || 600) * 1000 }); }
      }) },
      ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: s => ({ content: s, setMimeType(m) { this.mime = m; return this; } }) },
      HtmlService: { createHtmlOutput: h => ({ html: h, setTitle() { return this; }, addMetaTag() { return this; } }) },
      ScriptApp: { getService: () => ({ getUrl: () => sim.url }) }
    };
  }
  /** one execution: fresh globals, run the bundle, call fnName(arg) */
  exec(fnName, arg) {
    this.executions++;
    const ctx = vm.createContext(this.globals());
    this.code.runInContext(ctx);
    if (this.locked) throw new Error('lock still held from a previous execution');
    try { return ctx[fnName](arg); } finally { if (this.locked) { this.locked = false; throw new Error('execution ended holding the script lock'); } }
  }
  post(envelope) { const out = this.exec('doPost', { postData: { contents: typeof envelope === 'string' ? envelope : JSON.stringify(envelope), type: 'text/plain' } }); return JSON.parse(out.content); }
  get(params) { return this.exec('doGet', { parameter: params }); }

  /** an HTTP front like script.google.com: POST text/plain envelope → JSON; GET ?p=… → JSON or HTML. CORS like Google's. */
  listen(port = 0) {
    const srv = http.createServer((req, res) => {
      const chunks = []; req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const hdr = { 'Access-Control-Allow-Origin': '*' };
        try {
          if (req.method === 'OPTIONS') { res.writeHead(405, hdr); return res.end(); }      // Apps Script answers no pre-flight
          if (req.method === 'POST') {
            const out = this.exec('doPost', { postData: { contents: Buffer.concat(chunks).toString('utf8'), type: req.headers['content-type'] } });
            res.writeHead(200, { ...hdr, 'Content-Type': 'application/json' }); return res.end(out.content);
          }
          const u = new URL(req.url, 'http://x');
          const out = this.exec('doGet', { parameter: Object.fromEntries(u.searchParams) });
          if (out.html !== undefined) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(out.html); }
          res.writeHead(200, { ...hdr, 'Content-Type': 'application/json' }); return res.end(out.content);
        } catch (e) { res.writeHead(500, hdr); res.end(String(e.stack || e)); }
      });
    });
    return new Promise(r => srv.listen(port, '127.0.0.1', () => { this.url = `http://127.0.0.1:${srv.address().port}/exec`; r(srv); }));
  }
}

module.exports = { GasSim };
