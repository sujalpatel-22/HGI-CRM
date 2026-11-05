'use strict';
/**
 * Minimal Google Sheets API v4 client (REST, no SDK, no dependencies).
 * Production: https://sheets.googleapis.com with the Cloud Run service account's token (scope …/auth/spreadsheets).
 * Tests: the in-memory stand-in in test/fake-sheets.js (same REST subset).
 *
 * Only the calls the storage engine needs:
 *   meta()                 spreadsheets.get (tab titles, ids, grid sizes, protected ranges)
 *   batchGet(ranges)       spreadsheets.values.batchGet, UNFORMATTED_VALUE (numbers stay numbers, strings stay strings)
 *   getValue(range)        spreadsheets.values.get (one cell: the write counter)
 *   batchUpdate(requests)  spreadsheets.batchUpdate — ALL requests of one call are applied together or not at all
 *
 * Writes are sent once (no automatic retry): a write whose answer was lost is resolved by the engine, which re-reads the
 * write counter to learn whether it was applied (see sheet-db.js). Reads retry on 429 / 5xx.
 */
const { request, UpstreamError } = require('./http');

class SheetsClient {
  /** @param {{spreadsheetId:string, endpoint?:string, access:{get():Promise<string>, invalidate():void}}} o */
  constructor(o) {
    if (!o.spreadsheetId) throw new Error('spreadsheetId required');
    this.id = o.spreadsheetId;
    this.base = `${(o.endpoint || 'https://sheets.googleapis.com').replace(/\/$/, '')}/v4/spreadsheets/${encodeURIComponent(o.spreadsheetId)}`;
    this.access = o.access;
    this.calls = { read: 0, write: 0 };
  }
  async call(method, url, body, { retries = 3, timeoutMs = 60000 } = {}) {
    for (let i = 0; i < 2; i++) {
      const token = await this.access.get();
      try { return await request(method, url, { body, headers: { Authorization: `Bearer ${token}` }, retries, timeoutMs }); }
      catch (e) {
        if (e instanceof UpstreamError && e.status === 401 && i === 0) { this.access.invalidate(); continue; }
        if (e instanceof UpstreamError && e.status === 403) e.message = 'Google Sheets refused access — share the spreadsheet with the service account as Editor and enable the Sheets API. (' + e.message + ')';
        if (e instanceof UpstreamError && e.status === 404) e.message = 'Spreadsheet not found — check SHEETS_SPREADSHEET_ID. (' + e.message + ')';
        throw e;
      }
    }
  }
  async meta() {
    this.calls.read++;
    return this.call('GET', `${this.base}?fields=${encodeURIComponent('properties.title,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)),protectedRanges(protectedRangeId,range,description))')}`);
  }
  async batchGet(ranges) {
    if (!ranges.length) return [];
    this.calls.read++;
    const q = ranges.map(r => 'ranges=' + encodeURIComponent(r)).join('&');
    const r = await this.call('GET', `${this.base}/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&majorDimension=ROWS`);
    return (r.valueRanges || []).map(v => v.values || []);
  }
  async getValue(range) {
    this.calls.read++;
    const r = await this.call('GET', `${this.base}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`);
    return r.values && r.values[0] ? r.values[0][0] : undefined;
  }
  /** one atomic batch of structural + cell requests; never retried here (see header) */
  async batchUpdate(requests) {
    if (!requests.length) return {};
    this.calls.write++;
    return this.call('POST', `${this.base}:batchUpdate`, { requests, includeSpreadsheetInResponse: false }, { retries: 0, timeoutMs: 90000 });
  }
}

/* ---------------------------------------------------------------- cell values */
// Cells are always written as typed literals (userEnteredValue.stringValue / numberValue / boolValue): Sheets never parses
// them, so text such as "=IMPORTXML(…)" is stored as text and is never run as a formula inside the spreadsheet.
// Text that a spreadsheet program could still take for a formula when the sheet is downloaded as CSV (starting with
// = + - @ tab, CR or LF) gets a leading apostrophe, as do texts that already start with one; it is removed on reading,
// so the value comes back exactly as stored. (How Sheets keeps that apostrophe is probed at start-up: quoteMode.)
const RISKY = /^[=+\-@\t\r\n']/;
function cellOf(v) {
  if (v === undefined || v === null || v === '') return {};
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('number is not finite'); return { userEnteredValue: { numberValue: v } }; }
  if (typeof v === 'boolean') return { userEnteredValue: { boolValue: v } };
  const s = String(v);
  return { userEnteredValue: { stringValue: RISKY.test(s) ? "'" + s : s } };
}
/** value read back → the value that was written; quoteMode 'literal' (the apostrophe is kept as text) or 'prefix' (Sheets
 *  treats it as its quote prefix and drops it) */
function valueOf(v, quoteMode = 'literal') {
  if (typeof v !== 'string') return v;
  if (quoteMode === 'literal' && v.charCodeAt(0) === 39) return v.slice(1);
  return v;
}
const colLetter = n => { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const quoteTitle = t => `'${String(t).replace(/'/g, "''")}'`;

module.exports = { SheetsClient, cellOf, valueOf, colLetter, quoteTitle, RISKY };
