'use strict';
/**
 * TEST ONLY — an in-memory stand-in for the subset of the Google Sheets API v4 the service uses, written from Google's
 * API reference and kept strict where the real service is strict:
 *   GET  /v4/spreadsheets/{id}                         properties + sheets(properties, protectedRanges)
 *   GET  /v4/spreadsheets/{id}/values:batchGet         ranges in A1 notation ('Tab', 'Tab'!1:1, 'Tab'!A:D, 'Tab'!B12, 'Tab'!A1:C9),
 *                                                     UNFORMATTED_VALUE: numbers / booleans as JSON numbers / booleans,
 *                                                     trailing empty rows and cells left out, empty cells inside as ""
 *   GET  /v4/spreadsheets/{id}/values/{range}
 *   POST /v4/spreadsheets/{id}:batchUpdate             addSheet, updateCells (userEnteredValue), repeatCell, addProtectedRange,
 *                                                     appendDimension, deleteDimension — all requests applied together or
 *                                                     none (a failing request leaves the spreadsheet unchanged)
 * Limits as documented: 50,000 characters per cell, 10,000,000 cells per spreadsheet, writes outside the grid refused.
 * `quoteMode`: 'literal' keeps a leading apostrophe of a written text as part of the text; 'prefix' drops it the way the
 * Sheets editor treats a typed apostrophe — the service probes which one it gets, so both are tested.
 * Never used by the production server.
 */
const crypto = require('crypto');

const CELL_LIMIT = 50000, GRID_LIMIT = 10e6;
const colNum = s => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

class SheetsError extends Error { constructor(status, msg, st = 'INVALID_ARGUMENT') { super(msg); this.status = status; this.st = st; } }

class FakeSheets {
  constructor() {
    this.books = new Map();     // spreadsheetId → { title, sheets: [{props, cells: [[v]], protectedRanges}] }
    this.quoteMode = 'literal';
    this.calls = [];
    this.failures = [];         // {match:RegExp, status, times, applyFirst}
    this.readCount = 0; this.writeCount = 0;
  }
  create(title = 'HGI Billing data') { const id = crypto.randomBytes(22).toString('base64url').slice(0, 30); this.books.set(id, { title, sheets: [{ props: { sheetId: 0, title: 'Sheet1', index: 0, gridProperties: { rowCount: 1000, columnCount: 26 } }, cells: [], protectedRanges: [] }] }); return id; }
  fail(match, status, times = 1, applyFirst = false) { this.failures.push({ match, status, times, applyFirst }); }
  book(id) { const b = this.books.get(id); if (!b) throw new SheetsError(404, 'Requested entity was not found.', 'NOT_FOUND'); return b; }
  sheetByTitle(b, t) { const s = b.sheets.find(x => x.props.title === t); if (!s) throw new SheetsError(400, `Unable to parse range: ${t}`); return s; }
  sheetById(b, id) { const s = b.sheets.find(x => x.props.sheetId === id); if (!s) throw new SheetsError(400, `No grid with id: ${id}`); return s; }

  /** 'Title'!A1:B2 → {sheet, r0, r1, c0, c1} (end exclusive; open ends = grid) */
  range(b, a1) {
    const m = /^(?:'((?:[^']|'')+)'|([^!']+))(?:!(.+))?$/.exec(a1);
    if (!m) throw new SheetsError(400, 'Unable to parse range: ' + a1);
    const title = m[1] ? m[1].replace(/''/g, "'") : m[2];
    const sh = this.sheetByTitle(b, title), g = sh.props.gridProperties, r = m[3];
    let r0 = 0, r1 = g.rowCount, c0 = 0, c1 = g.columnCount, x;
    if (!r) { /* whole sheet */ }
    else if ((x = /^(\d+):(\d+)$/.exec(r))) { r0 = Number(x[1]) - 1; r1 = Number(x[2]); }
    else if ((x = /^([A-Z]+):([A-Z]+)$/.exec(r))) { c0 = colNum(x[1]); c1 = colNum(x[2]) + 1; }
    else if ((x = /^([A-Z]+)(\d+)$/.exec(r))) { c0 = colNum(x[1]); c1 = c0 + 1; r0 = Number(x[2]) - 1; r1 = r0 + 1; }
    else if ((x = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(r))) { c0 = colNum(x[1]); r0 = Number(x[2]) - 1; c1 = colNum(x[3]) + 1; r1 = Number(x[4]); }
    else throw new SheetsError(400, 'Unable to parse range: ' + a1);
    return { sh, r0, r1: Math.min(r1, g.rowCount), c0, c1: Math.min(c1, g.columnCount) };
  }
  values(b, a1) {
    const { sh, r0, r1, c0, c1 } = this.range(b, a1);
    const out = [];
    for (let r = r0; r < r1; r++) {
      const row = sh.cells[r] || [];
      const vals = [];
      for (let c = c0; c < c1; c++) vals.push(row[c] === undefined || row[c] === null ? '' : row[c]);
      while (vals.length && vals[vals.length - 1] === '') vals.pop();
      out.push(vals);
    }
    while (out.length && !out[out.length - 1].length) out.pop();
    return out;
  }
  cellValue(cd) {
    const u = cd && cd.userEnteredValue;
    if (!u) return undefined;
    if ('formulaValue' in u) throw new SheetsError(400, 'this stand-in does not evaluate formulas');
    if ('stringValue' in u) {
      const s = String(u.stringValue);
      if (s.length > CELL_LIMIT) throw new SheetsError(400, `Your input contains more than the maximum of ${CELL_LIMIT} characters in a single cell.`);
      return this.quoteMode === 'prefix' && s.charCodeAt(0) === 39 ? s.slice(1) : s;
    }
    if ('numberValue' in u) return Number(u.numberValue);
    if ('boolValue' in u) return !!u.boolValue;
    return undefined;
  }
  apply(b, req) {
    const [type] = Object.keys(req), q = req[type];
    if (type === 'addSheet') {
      const p = q.properties || {};
      if (b.sheets.some(s => s.props.title === p.title)) throw new SheetsError(400, `A sheet with the name "${p.title}" already exists. Please enter another name.`);
      const id = p.sheetId !== undefined ? p.sheetId : Math.max(0, ...b.sheets.map(s => s.props.sheetId)) + 1;
      if (b.sheets.some(s => s.props.sheetId === id)) throw new SheetsError(400, `Invalid requests[0].addSheet: Sheet with id ${id} already exists.`);
      const g = p.gridProperties || {};
      b.sheets.push({ props: { sheetId: id, title: p.title, index: b.sheets.length, gridProperties: { rowCount: g.rowCount || 1000, columnCount: g.columnCount || 26, frozenRowCount: g.frozenRowCount || 0 } }, cells: [], protectedRanges: [] });
      return { addSheet: { properties: { sheetId: id, title: p.title } } };
    }
    if (type === 'updateCells') {
      const sh = this.sheetById(b, q.range.sheetId), g = sh.props.gridProperties;
      if (q.fields !== 'userEnteredValue') throw new SheetsError(400, 'stand-in: only fields=userEnteredValue');
      const r0 = q.range.startRowIndex || 0, c0 = q.range.startColumnIndex || 0;
      const r1 = q.range.endRowIndex ?? g.rowCount, c1 = q.range.endColumnIndex ?? g.columnCount;
      if (r1 > g.rowCount || c1 > g.columnCount) throw new SheetsError(400, `Range ('${sh.props.title}'!R${r0 + 1}C${c0 + 1}:R${r1}C${c1}) exceeds grid limits. Max rows: ${g.rowCount}, max columns: ${g.columnCount}`);
      (q.rows || []).forEach((row, i) => {
        const r = r0 + i; if (r >= r1) throw new SheetsError(400, 'more rows than the range');
        const vals = row.values || [];
        if (c0 + vals.length > c1) throw new SheetsError(400, 'more cells than the range');
        for (let j = 0; j < c1 - c0; j++) {
          const v = j < vals.length ? this.cellValue(vals[j]) : undefined;
          // with fields=userEnteredValue, a cell given as {} (or missing inside the range) is cleared
          if (!sh.cells[r]) sh.cells[r] = [];
          if (v === undefined) delete sh.cells[r][c0 + j]; else sh.cells[r][c0 + j] = v;
        }
      });
      return {};
    }
    if (type === 'repeatCell') { this.sheetById(b, q.range.sheetId); return {}; }
    if (type === 'addProtectedRange') { const sh = this.sheetById(b, q.protectedRange.range.sheetId); const id = sh.protectedRanges.length + 1; sh.protectedRanges.push({ protectedRangeId: id, ...q.protectedRange }); return { addProtectedRange: { protectedRange: { protectedRangeId: id } } }; }
    if (type === 'appendDimension') {
      const sh = this.sheetById(b, q.sheetId), g = sh.props.gridProperties;
      if (!(q.length > 0)) throw new SheetsError(400, 'length must be positive');
      if (q.dimension === 'ROWS') g.rowCount += q.length; else if (q.dimension === 'COLUMNS') g.columnCount += q.length; else throw new SheetsError(400, 'bad dimension');
      return {};
    }
    if (type === 'deleteDimension') {
      const sh = this.sheetById(b, q.range.sheetId), g = sh.props.gridProperties, s = q.range.startIndex, e = q.range.endIndex;
      if (q.range.dimension === 'ROWS') { sh.cells.splice(s, e - s); g.rowCount -= e - s; } else { sh.cells.forEach(r => r && r.splice(s, e - s)); g.columnCount -= e - s; }
      return {};
    }
    throw new SheetsError(400, `stand-in: unsupported request ${type}`);
  }
  cellsUsed(b) { return b.sheets.reduce((a, s) => a + s.props.gridProperties.rowCount * s.props.gridProperties.columnCount, 0); }

  /** returns true when the request was handled */
  async handle(req, res, url, body, json) {
    const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(url.pathname);
    if (!m) return false;
    const id = decodeURIComponent(m[1]), rest = decodeURIComponent(m[2]);
    const sig = `${req.method} ${rest || '/'}${url.search}`;
    this.calls.push(sig);
    try {
      for (const f of this.failures) if (f.times > 0 && f.match.test(sig)) {
        f.times--;
        if (f.applyFirst && req.method === 'POST') { this.run(id, rest, req, url, body); this.writeCount++; }
        throw new SheetsError(f.status, f.applyFirst ? 'injected: applied, reply lost' : 'injected failure', f.status === 429 ? 'RESOURCE_EXHAUSTED' : 'UNAVAILABLE');
      }
      const out = this.run(id, rest, req, url, body);
      json(200, out);
    } catch (e) {
      if (!(e instanceof SheetsError)) throw e;
      json(e.status, { error: { code: e.status, message: e.message, status: e.st } });
    }
    return true;
  }
  run(id, rest, req, url, body) {
    const b = this.book(id);
    if (req.method === 'GET' && !rest) {
      this.readCount++;
      return { spreadsheetId: id, properties: { title: b.title }, sheets: b.sheets.map(s => ({ properties: JSON.parse(JSON.stringify(s.props)), protectedRanges: s.protectedRanges })) };
    }
    if (req.method === 'GET' && rest === '/values:batchGet') {
      this.readCount++;
      if (url.searchParams.get('valueRenderOption') !== 'UNFORMATTED_VALUE') throw new SheetsError(400, 'stand-in: tests expect UNFORMATTED_VALUE');
      return { spreadsheetId: id, valueRanges: url.searchParams.getAll('ranges').map(r => ({ range: r, majorDimension: 'ROWS', values: this.values(b, r) })) };
    }
    if (req.method === 'GET' && rest.startsWith('/values/')) { this.readCount++; return { range: rest.slice(8), values: this.values(b, rest.slice(8)) }; }
    if (req.method === 'POST' && rest === ':batchUpdate') {
      this.writeCount++;
      const snapshot = JSON.stringify(b);
      try {
        const replies = (body.requests || []).map(r => this.apply(b, r));
        if (this.cellsUsed(b) > GRID_LIMIT) throw new SheetsError(400, `This action would increase the number of cells in the workbook above the limit of ${GRID_LIMIT} cells.`);
        return { spreadsheetId: id, replies };
      } catch (e) { const back = JSON.parse(snapshot); b.sheets = back.sheets; throw e; }
    }
    throw new SheetsError(404, 'stand-in: no route ' + req.method + ' ' + rest, 'NOT_FOUND');
  }
  /** what a person sees in a tab (tests): rows of values */
  dump(id, title) { const b = this.book(id); return this.values(b, `'${title.replace(/'/g, "''")}'`); }
  /** a person editing a cell by hand (tests) */
  setCell(id, title, r, c, v) { const sh = this.sheetByTitle(this.book(id), title); if (!sh.cells[r]) sh.cells[r] = []; sh.cells[r][c] = v; }
}

module.exports = { FakeSheets };
