'use strict';
/**
 * Google Sheets as the database: one spreadsheet, one tab per table, row 1 = column names.
 *
 *  - Columns are found by their NAME in row 1, so the owner may reorder columns or add their own (extra columns are kept
 *    untouched); missing columns are added at the end on start-up. Tabs are never deleted or renamed by the server.
 *  - The server keeps an in-memory copy of the spreadsheet (loaded on start, reloaded every few minutes and whenever the
 *    spreadsheet changed behind its back). Reads are served from that copy; every write goes to Google Sheets first and
 *    reaches the copy only after Google confirmed it.
 *  - One writer at a time: writes run one after another (a queue), and each write is ONE spreadsheets.batchUpdate call,
 *    which Google applies completely or not at all. A write counter in the _Meta tab is part of every write; it is read
 *    before each write, so a change by anybody else (a second server instance, a person editing the sheet) is noticed:
 *    the copy is reloaded and the operation re-checked against the real data before anything is written.
 *    Deploy with ONE instance (Cloud Run --max-instances=1): Google Sheets has no transactions across writers.
 *  - Cells are written as typed literals — nothing is ever evaluated as a formula (see sheets-client.js).
 *  - A JSON cell longer than 40,000 characters (Google's limit is 50,000) is split into the _Blobs tab.
 *  - Rows are never physically deleted while the service runs: a removed row is blanked and reused later, so a write
 *    whose answer was lost can never shift other rows.
 */
const crypto = require('crypto');
const { cellOf, valueOf, colLetter, quoteTitle } = require('./sheets-client');
const { UpstreamError } = require('./http');

const CHUNK = 40000;
const BLOB_MARK = '~blob:';
const KEY_SEP = '\u0001';

class SheetConflict extends Error { constructor(m) { super(m); this.code = 'sheet_changed'; } }

class Table {
  constructor(def) {
    this.def = def;
    this.name = def.name;
    this.cols = def.columns.map(c => (typeof c === 'string' ? { name: c } : c));
    this.colDef = new Map(this.cols.map(c => [c.name, c]));
    this.key = def.key;
    this.indexCols = def.index || [];
    this.reset();
  }
  reset() {
    this.header = []; this.colAt = new Map(); this.rows = []; this.byKey = new Map(); this.free = []; this.idx = new Map(this.indexCols.map(c => [c, new Map()]));
    this.sheetId = null; this.gridRows = 0; this.gridCols = 0; this.duplicates = 0;
  }
  keyOf(obj) { return this.key.map(k => String(obj[k] == null ? '' : obj[k])).join(KEY_SEP); }
  indexAdd(k, obj) { for (const c of this.indexCols) { const v = obj[c]; if (v == null || v === '') continue; const m = this.idx.get(c); let s = m.get(v); if (!s) m.set(v, (s = new Set())); s.add(k); } }
  indexDel(k, obj) { for (const c of this.indexCols) { const v = obj[c]; const s = v == null ? null : this.idx.get(c).get(v); if (s) { s.delete(k); if (!s.size) this.idx.get(c).delete(v); } } }
  /** a copy of the stored row, or null */
  get(keyObj) { const e = this.byKey.get(typeof keyObj === 'string' ? keyObj : this.keyOf(keyObj)); return e ? { ...e.obj } : null; }
  /** rows whose indexed column equals value */
  where(col, value) {
    const s = this.idx.get(col); if (!s) throw new Error(`${this.name}.${col} is not indexed`);
    const keys = s.get(value); if (!keys) return [];
    return [...keys].map(k => ({ ...this.byKey.get(k).obj }));
  }
  all() { return [...this.byKey.values()].map(e => ({ ...e.obj })); }
  get size() { return this.byKey.size; }
}

class SheetDB {
  /**
   * @param {{client: import('./sheets-client').SheetsClient, tables: object[], log?: Function, reloadMs?: number}} o
   */
  constructor(o) {
    this.client = o.client;
    this.log = o.log || (() => {});
    this.reloadMs = o.reloadMs == null ? 10 * 60e3 : o.reloadMs;
    this.missReloadMs = o.missReloadMs == null ? 60000 : o.missReloadMs;
    this.tables = new Map();
    for (const def of [...o.tables, META, BLOBS]) this.tables.set(def.name, new Table(def));
    this.queue = Promise.resolve();
    this.counter = 0; this.loadedAt = 0; this.dirty = true; this.quoteMode = 'literal'; this.opened = false;
    this.stats = { loads: 0, writes: 0, conflicts: 0, lostReplies: 0 };
  }
  t(name) { const t = this.tables.get(name); if (!t) throw new Error('no table ' + name); return t; }

  /* ------------------------------------------------------------ the write queue */
  exclusive(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /* ------------------------------------------------------------ open: create missing tabs / columns, probe, load */
  async open() {
    return this.exclusive(async () => {
      await this.ensureSchema();
      await this.probeQuoteMode();
      await this.load();
      this.opened = true;
    });
  }
  async ensureSchema() {
    const meta = await this.client.meta();
    const existing = new Map((meta.sheets || []).map(s => [s.properties.title, s]));
    const usedIds = new Set((meta.sheets || []).map(s => s.properties.sheetId));
    const reqs = [];
    let nextId = 1000;
    const heads = [...this.tables.values()].filter(t => existing.has(t.name)).map(t => `${quoteTitle(t.name)}!1:1`);
    const headRows = await this.client.batchGet(heads);
    const headOf = new Map([...this.tables.values()].filter(t => existing.has(t.name)).map((t, i) => [t.name, (headRows[i][0] || []).map(String)]));
    for (const t of this.tables.values()) {
      const names = t.cols.map(c => c.name);
      const sh = existing.get(t.name);
      if (!sh) {
        while (usedIds.has(nextId)) nextId++;
        const sheetId = nextId; usedIds.add(sheetId);
        reqs.push({ addSheet: { properties: { sheetId, title: t.name, gridProperties: { rowCount: 1000, columnCount: names.length, frozenRowCount: 1 } } } });
        reqs.push(headerCells(sheetId, 0, names));
        reqs.push({ repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } });
        reqs.push({ addProtectedRange: { protectedRange: { range: { sheetId }, description: 'HGI Billing — written only by the HGI server. Do not edit by hand.', warningOnly: false } } });
        this.log({ event: 'sheet_created', tab: t.name });
        continue;
      }
      const have = headOf.get(t.name) || [];
      const missing = names.filter(n => !have.includes(n));
      if (missing.length) {
        const sheetId = sh.properties.sheetId, start = have.length, cols = sh.properties.gridProperties.columnCount;
        if (start + missing.length > cols) reqs.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: start + missing.length - cols } });
        reqs.push(headerCells(sheetId, start, missing));
        this.log({ event: 'sheet_columns_added', tab: t.name, columns: missing });
      }
    }
    if (reqs.length) await this.client.batchUpdate(reqs);
  }
  /** how Google keeps a leading apostrophe written as text (see sheets-client.js valueOf) */
  async probeQuoteMode() {
    const t = this.t('_Meta');
    const meta = await this.client.meta();
    const sh = (meta.sheets || []).find(s => s.properties.title === '_Meta');
    const head = (await this.client.batchGet([`${quoteTitle('_Meta')}!1:1`]))[0][0] || [];
    const ki = head.indexOf('key'), vi = head.indexOf('value');
    const rows = (await this.client.batchGet([`${quoteTitle('_Meta')}!A:${colLetter(Math.max(ki, vi))}`]))[0] || [];
    let r = rows.findIndex((row, i) => i > 0 && row[ki] === 'quoteProbe');
    if (r < 0) r = Math.max(rows.length, 1);
    await this.client.batchUpdate([
      ...(r + 1 > sh.properties.gridProperties.rowCount ? [{ appendDimension: { sheetId: sh.properties.sheetId, dimension: 'ROWS', length: 100 } }] : []),
      { updateCells: { range: { sheetId: sh.properties.sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: ki, endColumnIndex: ki + 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: 'quoteProbe' } }] }], fields: 'userEnteredValue' } },
      { updateCells: { range: { sheetId: sh.properties.sheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: vi, endColumnIndex: vi + 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: "'probe" } }] }], fields: 'userEnteredValue' } }
    ]);
    const back = await this.client.getValue(`${quoteTitle('_Meta')}!${colLetter(vi)}${r + 1}`);
    this.quoteMode = back === "'probe" ? 'literal' : 'prefix';
    if (back !== "'probe" && back !== 'probe') this.log({ warn: true, event: 'quote_probe_unexpected', got: String(back) });
    t.quoteMode = this.quoteMode;
  }

  /* ------------------------------------------------------------ load the whole spreadsheet into memory */
  async load() {
    const meta = await this.client.meta();
    const props = new Map((meta.sheets || []).map(s => [s.properties.title, s.properties]));
    const list = [...this.tables.values()];
    for (const t of list) if (!props.has(t.name)) throw new Error(`Tab "${t.name}" is missing from the spreadsheet — restart the service to create it.`);
    const data = await this.client.batchGet(list.map(t => quoteTitle(t.name)));
    // blobs first: other tabs' JSON cells may point into them
    const order = list.map((t, i) => [t, data[i]]).sort((a, b) => (a[0].name === '_Blobs' ? -1 : b[0].name === '_Blobs' ? 1 : 0));
    let blobText = new Map();
    for (const [t, values] of order) {
      t.reset();
      const p = props.get(t.name);
      t.sheetId = p.sheetId; t.gridRows = p.gridProperties.rowCount; t.gridCols = p.gridProperties.columnCount;
      t.header = (values[0] || []).map(String);
      t.header.forEach((h, i) => { if (h && !t.colAt.has(h)) t.colAt.set(h, i); });
      for (let r = 1; r < values.length; r++) this.loadRow(t, r - 1, values[r] || [], blobText);
      t.free.sort((a, b) => a - b);
      if (t.name === '_Blobs') blobText = blobsByRef(t);
    }
    const m = this.t('_Meta').get({ key: 'writeCounter' });
    this.counter = m ? Number(m.value) || 0 : 0;
    this.loadedAt = Date.now(); this.dirty = false; this.stats.loads++;
    const corrupt = list.reduce((a, t) => a + [...t.byKey.values()].filter(e => e.obj.__corrupt).length, 0);
    const dups = list.reduce((a, t) => a + t.duplicates, 0);
    this.log({ event: 'sheets_loaded', rows: Object.fromEntries(list.map(t => [t.name, t.size])), counter: this.counter, quoteMode: this.quoteMode, ...(corrupt ? { warn: true, corruptCells: corrupt } : {}), ...(dups ? { warn: true, duplicateKeys: dups } : {}) });
  }
  loadRow(t, r, raw, blobText) {
    if (!raw.some(v => v !== '' && v !== null && v !== undefined)) { t.rows[r] = null; t.free.push(r); return; }
    const vals = raw.map(v => valueOf(v, this.quoteMode));
    const obj = {};
    for (const c of t.cols) {
      const i = t.colAt.get(c.name); if (i === undefined) continue;
      let v = vals[i];
      if (v === '' || v === undefined || v === null) continue;
      if (c.json) {
        if (typeof v === 'string' && v.startsWith(BLOB_MARK)) { const txt = blobText.get(v); if (txt === undefined) { obj.__corrupt = `${c.name}: missing blob ${v}`; continue; } v = txt; }
        try { v = JSON.parse(v); } catch (e) { obj.__corrupt = `${c.name}: not valid JSON`; continue; }
      }
      obj[c.name] = v;
    }
    const k = t.keyOf(obj);
    const e = { r, raw: vals, obj };
    t.rows[r] = e;
    if (t.byKey.has(k)) { t.duplicates++; this.log({ warn: true, event: 'duplicate_key', tab: t.name, row: r + 2 }); return; }
    t.byKey.set(k, e); t.indexAdd(k, obj);
  }
  /** a row that should exist was not found: reload (at most every missReloadMs), in case another writer added it */
  async reloadForMiss() {
    if (this.inTx || Date.now() - this.loadedAt < this.missReloadMs) return false;
    await this.exclusive(async () => { if (Date.now() - this.loadedAt >= this.missReloadMs) await this.load(); });
    return true;
  }
  async fresh() {
    if (this.inTx) return;                     // inside a write: the copy was checked when the write began
    if (!this.dirty && Date.now() - this.loadedAt < this.reloadMs) return;
    await this.exclusive(async () => { if (this.dirty || Date.now() - this.loadedAt >= this.reloadMs) await this.load(); });
  }

  /* ------------------------------------------------------------ transactions */
  /**
   * fn(w) reads through w.get / table methods and stages changes with w.put / w.remove; its result is returned once
   * Google confirmed the write. fn may run more than once (after a reload) — it must not have side effects of its own.
   */
  async tx(fn) {
    return this.exclusive(async () => {
      for (let attempt = 0; ; attempt++) {
        if (this.dirty || Date.now() - this.loadedAt >= this.reloadMs) await this.load();
        const w = new Writer(this);
        let result;
        this.inTx = true;
        try { result = await fn(w); } finally { this.inTx = false; }
        if (!w.changes()) return result;
        // anybody else written since our copy was loaded? → reload and run fn again on the real data
        const now = await this.readCounter();
        if (now !== this.counter) {
          this.stats.conflicts++;
          this.log({ warn: true, event: 'sheet_changed_elsewhere', expected: this.counter, found: now });
          this.dirty = true;
          if (attempt >= 2) throw Object.assign(new SheetConflict('The spreadsheet is being changed by someone else. Try again in a moment.'), { status: 503 });
          continue;
        }
        const plan = w.plan(this.counter + 1);
        try {
          await this.client.batchUpdate(plan.requests);
        } catch (e) {
          // a lost answer: was it applied? the counter tells
          let after;
          try { after = await this.readCounter(); } catch (e2) { this.dirty = true; throw e; }
          if (after === this.counter + 1) { this.stats.lostReplies++; this.log({ warn: true, event: 'write_reply_lost_but_applied' }); }
          else { if (after !== this.counter) this.dirty = true; throw e; }
        }
        plan.apply();
        this.counter += 1; this.stats.writes++;
        return result;
      }
    });
  }
  async readCounter() {
    const t = this.t('_Meta'), e = t.byKey.get(t.keyOf({ key: 'writeCounter' }));
    const vi = t.colAt.get('value');
    if (!e) return 0;
    const v = await this.client.getValue(`${quoteTitle('_Meta')}!${colLetter(vi)}${e.r + 2}`);
    return Number(valueOf(v, this.quoteMode)) || 0;
  }
  /** total cells in use (Google's limit is 10 million per spreadsheet) */
  cellsUsed() { let n = 0; for (const t of this.tables.values()) n += t.gridRows * t.gridCols; return n; }
}

/* ---------------------------------------------------------------- one write */
class Writer {
  constructor(db) { this.db = db; this.staged = new Map(); }
  /** the row as it will be after this write (staged), else as stored */
  get(name, keyObj) {
    const t = this.db.t(name), k = typeof keyObj === 'string' ? keyObj : t.keyOf(keyObj);
    const s = this.staged.get(name);
    if (s && s.has(k)) { const v = s.get(k); return v ? { ...v } : null; }
    return t.get(k);
  }
  put(name, obj) {
    const t = this.db.t(name);
    for (const kc of t.key) if (obj[kc] === undefined || obj[kc] === null || obj[kc] === '') throw new Error(`${name}: key column ${kc} empty`);
    for (const k of Object.keys(obj)) if (!t.colDef.has(k)) throw new Error(`${name}: unknown column ${k}`);
    if (!this.staged.has(name)) this.staged.set(name, new Map());
    this.staged.get(name).set(t.keyOf(obj), { ...obj });
  }
  remove(name, keyObj) {
    const t = this.db.t(name), k = typeof keyObj === 'string' ? keyObj : t.keyOf(keyObj);
    if (!this.staged.has(name)) this.staged.set(name, new Map());
    this.staged.get(name).set(k, null);
  }
  changes() { let n = 0; for (const s of this.staged.values()) n += s.size; return n; }

  /** → { requests, apply() } */
  plan(newCounter) {
    const db = this.db;
    this.put('_Meta', { key: 'writeCounter', value: newCounter });
    const blobs = db.t('_Blobs');
    const blobOwners = blobsByOwner(blobs);
    const requests = [], applies = [];
    const rowsOf = new Map();          // table → [{r, cells, entry|null}]
    const newBlobs = [], dropBlobs = new Set();
    const order = [...this.staged.keys()].filter(n => n !== '_Blobs');
    for (const name of order) {
      const t = db.t(name), list = [];
      const free = [...t.free];
      let next = t.rows.length;
      for (const [k, obj] of this.staged.get(name)) {
        const e = t.byKey.get(k);
        if (e) for (const c of t.cols) if (c.json) for (const b of blobOwners.get(ownerOf(t, k, c.name)) || []) dropBlobs.add(b);
        if (!obj) { if (e) list.push({ r: e.r, cells: t.header.map(() => ({})), k, obj: null, old: e }); continue; }
        const r = e ? e.r : (free.length ? free.shift() : next++);
        const raw = e ? [...e.raw] : [];
        const cells = [];
        const width = Math.max(t.header.length, raw.length);
        for (let i = 0; i < width; i++) {
          const h = t.header[i], c = h ? t.colDef.get(h) : null;
          if (!c || t.colAt.get(h) !== i) { cells.push(cellOf(raw[i])); continue; }   // a column the server does not own: kept as it is
          let v = obj[c.name];
          if (c.json && v !== undefined) {
            v = JSON.stringify(v);
            if (v.length > CHUNK) {
              const id = crypto.randomBytes(8).toString('hex'), parts = Math.ceil(v.length / CHUNK);
              for (let p = 0; p < parts; p++) newBlobs.push({ id: `${id}.${p}`, owner: ownerOf(t, k, c.name), part: p, parts, text: v.slice(p * CHUNK, (p + 1) * CHUNK) });
              v = `${BLOB_MARK}${id}:${parts}`;
            }
          }
          cells.push(cellOf(v));
        }
        list.push({ r, cells, k, obj, old: e || null });
      }
      rowsOf.set(name, list);
    }
    // blob rows: the old parts of rewritten JSON cells are blanked, new parts take free rows
    {
      const list = [], free = [...blobs.free];
      let next = blobs.rows.length;
      const reuse = [];
      for (const k of dropBlobs) { const e = blobs.byKey.get(k); if (e) { list.push({ r: e.r, cells: blobs.header.map(() => ({})), k, obj: null, old: e }); reuse.push(e.r); } }
      for (const b of newBlobs) {
        const r = free.length ? free.shift() : next++;
        const cells = blobs.header.map(h => cellOf(b[h]));
        list.push({ r, cells, k: blobs.keyOf(b), obj: b, old: null });
      }
      if (list.length) rowsOf.set('_Blobs', list);
      blobs.__reuse = reuse;
    }
    for (const [name, list] of rowsOf) {
      const t = db.t(name);
      const maxR = list.reduce((a, x) => Math.max(a, x.r), -1);
      let grid = t.gridRows;
      if (maxR + 2 > grid) { const add = maxR + 2 - grid + 500; requests.push({ appendDimension: { sheetId: t.sheetId, dimension: 'ROWS', length: add } }); grid += add; }
      const width = list.reduce((a, x) => Math.max(a, x.cells.length), 0);
      let gridCols = t.gridCols;
      if (width > gridCols) { requests.push({ appendDimension: { sheetId: t.sheetId, dimension: 'COLUMNS', length: width - gridCols } }); gridCols = width; }
      // consecutive rows go in one request
      const sorted = [...list].sort((a, b) => a.r - b.r);
      for (let i = 0; i < sorted.length;) {
        let j = i; while (j + 1 < sorted.length && sorted[j + 1].r === sorted[j].r + 1) j++;
        const w = Math.max(...sorted.slice(i, j + 1).map(x => x.cells.length));
        requests.push({ updateCells: { range: { sheetId: t.sheetId, startRowIndex: sorted[i].r + 1, endRowIndex: sorted[j].r + 2, startColumnIndex: 0, endColumnIndex: w },
          rows: sorted.slice(i, j + 1).map(x => ({ values: [...x.cells, ...Array(w - x.cells.length).fill({})] })), fields: 'userEnteredValue' } });
        i = j + 1;
      }
      applies.push(() => {
        t.gridRows = grid; t.gridCols = gridCols;
        const freeSet = new Set(t.free);
        for (const x of list) {
          if (x.old) { t.byKey.delete(x.k); t.indexDel(x.k, x.old.obj); }
          if (!x.obj) { t.rows[x.r] = null; freeSet.add(x.r); continue; }
          freeSet.delete(x.r);
          const raw = x.cells.map(c => cellValue(c));
          const e = { r: x.r, raw, obj: { ...x.obj } };
          for (const c of t.cols) if (e.obj[c.name] === undefined || e.obj[c.name] === '' || e.obj[c.name] === null) delete e.obj[c.name];
          t.rows[x.r] = e; t.byKey.set(x.k, e); t.indexAdd(x.k, e.obj);
        }
        for (let r = 0; r < t.rows.length; r++) if (t.rows[r] === undefined) t.rows[r] = null;
        t.free = [...freeSet].sort((a, b) => a - b);
      });
    }
    return { requests, apply: () => applies.forEach(f => f()) };
  }
}

function headerCells(sheetId, startCol, names) {
  return { updateCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: startCol, endColumnIndex: startCol + names.length },
    rows: [{ values: names.map(n => ({ userEnteredValue: { stringValue: n } })) }], fields: 'userEnteredValue' } };
}
const cellValue = c => { const u = c && c.userEnteredValue; if (!u) return ''; if ('stringValue' in u) return u.stringValue.charCodeAt(0) === 39 && /^'[=+\-@\t\r\n']/.test(u.stringValue) ? u.stringValue.slice(1) : u.stringValue; if ('numberValue' in u) return u.numberValue; if ('boolValue' in u) return u.boolValue; return ''; };
const ownerOf = (t, k, col) => `${t.name}:${crypto.createHash('sha1').update(k).digest('hex').slice(0, 20)}:${col}`;
function blobsByOwner(blobs) { const m = new Map(); for (const [k, e] of blobs.byKey) { const o = e.obj.owner; if (!m.has(o)) m.set(o, []); m.get(o).push(k); } return m; }
function blobsByRef(blobs) {
  const groups = new Map();
  for (const e of blobs.byKey.values()) { const id = String(e.obj.id || '').replace(/\.\d+$/, ''); if (!groups.has(id)) groups.set(id, []); groups.get(id).push(e.obj); }
  const out = new Map();
  for (const [id, parts] of groups) {
    parts.sort((a, b) => Number(a.part) - Number(b.part));
    const n = Number(parts[0].parts) || parts.length;
    if (parts.length !== n) continue;
    out.set(`${BLOB_MARK}${id}:${n}`, parts.map(p => String(p.text == null ? '' : p.text)).join(''));
  }
  return out;
}

const META = { name: '_Meta', key: ['key'], columns: ['key', 'value', 'note'] };
const BLOBS = { name: '_Blobs', key: ['id'], columns: ['id', 'owner', 'part', 'parts', 'text'] };

module.exports = { SheetDB, Table, SheetConflict, KEY_SEP, CHUNK, BLOB_MARK, UpstreamError };
