'use strict';
/**
 * TEST ONLY — an in-memory stand-in for the Google endpoints the sync service uses:
 * ID-token signing keys (JWKS), OAuth token endpoint, Cloud Run metadata server, Drive v3 files and Sheets v4 values.
 * It enforces the real limits that matter (50,000 characters per cell, grid size, bearer token) and can inject failures.
 * It is never used by the production server.
 */
const http = require('http');
const crypto = require('crypto');

function rsa() { return crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); }

class FakeGoogle {
  constructor() {
    this.kid = 'kid-1';
    this.keys = rsa();
    this.files = new Map();        // id -> { id, name, mimeType, parents, appProperties, trashed, createdTime, permissions }
    this.sheets = new Map();       // id -> [{ sheetId, title, hidden, rows, cols, cells: Map }]
    this.tokens = new Set();
    this.failures = [];            // { match: RegExp, method, status, times, body }
    this.calls = [];
    this.valueInputOptions = [];
    this.corruptReadOnce = false;
    this.seq = 1;
  }
  idToken(claims, opts = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', kid: opts.kid || this.kid, typ: 'JWT' };
    const payload = { iss: 'https://accounts.google.com', aud: 'test-web-client.apps.googleusercontent.com', iat: now, exp: now + 3600, email_verified: true, ...claims };
    const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = enc(header) + '.' + enc(payload);
    const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), (opts.privateKey || this.keys.privateKey)).toString('base64url');
    return unsigned + '.' + sig;
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
    return { certs: this.base + '/certs', token: this.base + '/token', drive: this.base + '/drive/v3', sheets: this.base + '/sheets/v4', metadata: this.base + '/metadata/token' };
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const body = await new Promise(r => { const b = []; req.on('data', c => b.push(c)); req.on('end', () => r(Buffer.concat(b).toString('utf8'))); });
    const json = (s, o, h = {}) => { res.writeHead(s, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
    const err = (s, m) => json(s, { error: { code: s, message: m } });
    this.calls.push(`${req.method} ${url.pathname}`);
    for (const f of this.failures) {
      if (f.times > 0 && f.match.test(`${req.method} ${url.pathname}${url.search}`) && (!f.method || f.method === req.method)) { f.times--; return err(f.status, 'injected failure'); }
    }
    const p = url.pathname;
    if (p === '/certs') {
      const jwk = this.keys.publicKey.export({ format: 'jwk' });
      return json(200, { keys: [{ ...jwk, kid: this.kid, alg: 'RS256', use: 'sig' }] }, { 'Cache-Control': 'public, max-age=3600' });
    }
    if (p === '/token' || p === '/metadata/token') {
      if (p === '/metadata/token' && req.headers['metadata-flavor'] !== 'Google') return err(403, 'missing Metadata-Flavor');
      if (p === '/token') {
        const f = new URLSearchParams(body);
        if (f.get('grant_type') === 'refresh_token' && f.get('refresh_token') !== 'good-refresh') return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
        if (f.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer' && (f.get('assertion') || '').split('.').length !== 3) return json(400, { error: 'invalid_grant' });
      }
      const t = 'at-' + crypto.randomBytes(8).toString('hex'); this.tokens.add(t);
      return json(200, { access_token: t, expires_in: 3599, token_type: 'Bearer' });
    }
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!auth || !this.tokens.has(auth[1])) return err(401, 'Request had invalid authentication credentials.');
    const data = body ? JSON.parse(body) : {};

    /* ------------------------------------------------ Drive v3 */
    if (p === '/drive/v3/files' && req.method === 'GET') {
      if (url.searchParams.get('supportsAllDrives') !== 'true') return err(400, 'supportsAllDrives expected');
      const q = url.searchParams.get('q');
      const list = [...this.files.values()].filter(f => this.matches(f, q));
      return json(200, { files: list.map(f => ({ id: f.id, name: f.name, appProperties: f.appProperties, createdTime: f.createdTime })) });
    }
    if (p === '/drive/v3/files' && req.method === 'POST') {
      const id = 'f' + (this.seq++) + crypto.randomBytes(3).toString('hex');
      this.files.set(id, { id, name: data.name, mimeType: data.mimeType, parents: data.parents || [], appProperties: data.appProperties || {}, trashed: false, createdTime: new Date(Date.now() + this.seq).toISOString(), permissions: [] });
      if (data.mimeType === 'application/vnd.google-apps.spreadsheet') this.sheets.set(id, [this.newSheet(0, 'Sheet1')]);
      return json(200, { id });
    }
    let m;
    if ((m = /^\/drive\/v3\/files\/([^/]+)\/permissions$/.exec(p)) && req.method === 'POST') { const f = this.files.get(m[1]); if (!f) return err(404, 'File not found'); f.permissions.push(data); return json(200, { id: 'perm' }); }
    if ((m = /^\/drive\/v3\/files\/([^/]+)$/.exec(p))) {
      const f = this.files.get(decodeURIComponent(m[1])); if (!f) return err(404, 'File not found');
      if (req.method === 'DELETE') { this.files.delete(f.id); this.sheets.delete(f.id); res.writeHead(204); return res.end(); }
      if (req.method === 'PATCH') { Object.assign(f, data); return json(200, { id: f.id }); }
    }

    /* ------------------------------------------------ Sheets v4 */
    if ((m = /^\/sheets\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(p))) {
      const id = decodeURIComponent(m[1]), rest = m[2];
      const tabs = this.sheets.get(id); if (!tabs || (this.files.get(id) || {}).trashed) return err(404, 'Requested entity was not found.');
      if (rest === '' && req.method === 'GET') return json(200, { sheets: tabs.map(t => ({ properties: { sheetId: t.sheetId, title: t.title, hidden: !!t.hidden, gridProperties: { rowCount: t.rows, columnCount: t.cols } } })) });
      if (rest === ':batchUpdate') {
        for (const r of data.requests) {
          if (r.addSheet) { const pr = r.addSheet.properties; if (tabs.some(t => t.title === pr.title)) return err(400, 'sheet exists'); const t = this.newSheet(tabs.length * 7 + 11, pr.title); t.hidden = pr.hidden; if (pr.gridProperties) { t.rows = pr.gridProperties.rowCount; t.cols = pr.gridProperties.columnCount; } tabs.push(t); }
          else if (r.updateSheetProperties) { const pr = r.updateSheetProperties.properties; const t = tabs.find(x => x.sheetId === pr.sheetId); if (!t) return err(400, 'no sheet'); if (pr.title) t.title = pr.title; if (pr.gridProperties) { t.rows = pr.gridProperties.rowCount || t.rows; t.cols = pr.gridProperties.columnCount || t.cols; } }
          else return err(400, 'unsupported request');
        }
        return json(200, {});
      }
      if (rest === '/values:batchClear') { for (const r of data.ranges) { const g = this.range(tabs, r); if (g.error) return err(400, g.error); this.each(g, (row, col) => g.tab.cells.delete(row + ',' + col)); } return json(200, {}); }
      if (rest === '/values:batchUpdate') {
        this.valueInputOptions.push(data.valueInputOption);
        if (!['RAW', 'USER_ENTERED'].includes(data.valueInputOption)) return err(400, 'valueInputOption required');
        for (const d of data.data) {
          const g = this.range(tabs, d.range); if (g.error) return err(400, g.error);
          for (let i = 0; i < d.values.length; i++) for (let j = 0; j < d.values[i].length; j++) {
            const row = g.r0 + i, col = g.c0 + j;
            if (row >= g.tab.rows || col >= g.tab.cols) return err(400, `Range (${d.range}) exceeds grid limits. Max rows: ${g.tab.rows}, max columns: ${g.tab.cols}`);
            const v = d.values[i][j];
            if (typeof v === 'string' && v.length > 50000) return err(400, 'Your input contains more than the maximum of 50000 characters in a single cell.');
            if (v === '' || v === null) g.tab.cells.delete(row + ',' + col); else g.tab.cells.set(row + ',' + col, v);
          }
        }
        return json(200, {});
      }
      if ((m = /^\/values\/(.+)$/.exec(rest)) && req.method === 'GET') {
        const g = this.range(tabs, decodeURIComponent(m[1])); if (g.error) return err(400, g.error);
        const cols = url.searchParams.get('majorDimension') === 'COLUMNS';
        const out = [];
        this.each(g, (row, col) => { if (g.tab.cells.has(row + ',' + col)) { const a = cols ? col - g.c0 : row - g.r0, b = cols ? row - g.r0 : col - g.c0; (out[a] = out[a] || [])[b] = String(g.tab.cells.get(row + ',' + col)); } });
        for (let i = 0; i < out.length; i++) { out[i] = out[i] || []; for (let k = 0; k < out[i].length; k++) if (out[i][k] === undefined) out[i][k] = ''; }
        if (this.corruptReadOnce && cols && out[0] && out[0][0]) { this.corruptReadOnce = false; out[0][0] = 'AAAA' + out[0][0].slice(4); }
        return json(200, { range: m[1], values: out.length ? out : undefined });
      }
    }
    return err(404, 'fake: no route ' + req.method + ' ' + p);
  }

  newSheet(sheetId, title) { return { sheetId, title, hidden: false, rows: 1000, cols: 26, cells: new Map() }; }
  // 'Tab'!A1:B9 | 'Tab'!A:A | 'Tab'!A1 | 'Tab'
  range(tabs, a1) {
    const m = /^'((?:[^']|'')+)'(?:!([A-Z]+)(\d+)?(?::([A-Z]+)(\d+)?)?)?$/.exec(a1);
    if (!m) return { error: 'Unable to parse range: ' + a1 };
    const tab = tabs.find(t => t.title === m[1].replace(/''/g, "'"));
    if (!tab) return { error: 'Unable to parse range: ' + a1 };
    const col = s => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const c0 = m[2] ? col(m[2]) : 0, r0 = m[3] ? Number(m[3]) - 1 : 0;
    const c1 = m[4] ? col(m[4]) : (m[2] && !m[4] && m[3] ? c0 : (m[2] ? c0 : tab.cols - 1));
    const r1 = m[5] ? Number(m[5]) - 1 : (m[3] && !m[4] ? r0 : tab.rows - 1);
    if (r0 >= tab.rows && m[3]) return { error: `Range (${a1}) exceeds grid limits.` };
    return { tab, r0, c0, r1: Math.min(r1, tab.rows - 1), c1: Math.min(c1, tab.cols - 1) };
  }
  each(g, fn) { for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) fn(r, c); }

  // the subset of the Drive query language the service uses
  matches(f, q) {
    for (const clause of q.split(/\s+and\s+(?![^{]*})/)) {
      let m;
      if ((m = /^'(.+)' in parents$/.exec(clause))) { if (!f.parents.includes(m[1])) return false; }
      else if ((m = /^appProperties has \{ key='(.+)' and value='(.+)' \}$/.exec(clause))) { if ((f.appProperties || {})[m[1]] !== m[2].replace(/\\'/g, "'")) return false; }
      else if ((m = /^mimeType='(.+)'$/.exec(clause))) { if (f.mimeType !== m[1]) return false; }
      else if (clause === 'trashed=false') { if (f.trashed) return false; }
      else throw new Error('fake Drive: unsupported query clause ' + clause);
    }
    return true;
  }
  spreadsheetOf(key) { return [...this.files.values()].find(f => f.appProperties.hgiUser === key && f.mimeType === 'application/vnd.google-apps.spreadsheet'); }
  tab(id, title) { return (this.sheets.get(id) || []).find(t => t.title === title); }
  rows(id, title) {
    const t = this.tab(id, title); if (!t) return null;
    const out = [];
    for (const [k, v] of t.cells) { const [r, c] = k.split(',').map(Number); (out[r] = out[r] || [])[c] = v; }
    return out;
  }
}

module.exports = { FakeGoogle, rsa };
