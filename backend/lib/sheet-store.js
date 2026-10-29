'use strict';
/**
 * One Google Spreadsheet per user, inside the company Drive folder (DRIVE_FOLDER_ID).
 *
 *   Read me, Company, Invoices, Items sold, Payments, Customers, Products  — readable view for the owner
 *   _sync     A1 = JSON metadata {version, slot, sha256, bytes, clientRev, updatedAt, device}
 *   _data_a / _data_b — the exact app data (gzip + base64, split over cells of column A)
 *
 * A save is written into the slot that is NOT live, read back and checksum-verified, and only then made live by
 * updating _sync. A failed or interrupted save therefore never damages the copy a restore would use.
 * Each save carries the version it was based on; a save based on an older version is refused (409), so two
 * phones can never silently overwrite each other.
 */
const crypto = require('crypto');
const zlib = require('zlib');
const { request, UpstreamError } = require('./http');
const { tabs, READABLE_TABS } = require('./readable');

const CHUNK = 45000;                       // Sheets limit is 50,000 characters per cell
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const q = name => `'${name.replace(/'/g, "''")}'`;
const dq = v => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

class ConflictError extends Error { constructor(meta) { super('The cloud copy changed on another device'); this.meta = meta; this.status = 409; this.code = 'conflict'; } }
class CorruptError extends Error { constructor(m) { super(m); this.status = 500; this.code = 'cloud_copy_unreadable'; } }

class SheetStore {
  constructor(cfg, access, log = () => {}) {
    this.cfg = cfg; this.access = access; this.log = log;
    this.ids = new Map();          // userKey -> spreadsheetId
    this.sheetIds = new Map();     // spreadsheetId -> { title: sheetId }
    this.tomb = new Map();         // userKey -> { at, deletedAt }
    this.locks = new Map();
  }

  /* --------------------------------------------------------------- plumbing */
  async api(method, url, body) {
    for (let i = 0; i < 2; i++) {
      const token = await this.access.get();
      try { return await request(method, url, { body, headers: { Authorization: `Bearer ${token}` } }); }
      catch (e) { if (e instanceof UpstreamError && e.status === 401 && i === 0) { this.access.invalidate(); continue; } throw e; }
    }
  }
  drive(path, method = 'GET', body) {
    const sep = path.includes('?') ? '&' : '?';
    return this.api(method, `${this.cfg.endpoints.drive}${path}${sep}supportsAllDrives=true`, body);
  }
  sheets(id, path, method = 'GET', body) { return this.api(method, `${this.cfg.endpoints.sheets}/spreadsheets/${encodeURIComponent(id)}${path}`, body); }
  // one operation at a time per user (pushes from two phones are ordered, never interleaved)
  withLock(key, fn) {
    const prev = this.locks.get(key) || Promise.resolve();
    const run = prev.catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    this.locks.set(key, tail);
    tail.then(() => { if (this.locks.get(key) === tail) this.locks.delete(key); });
    return run;
  }
  async listFiles(query) {
    const r = await this.drive(`/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id,name,appProperties,createdTime)')}&includeItemsFromAllDrives=true&corpora=allDrives&pageSize=10`);
    return r.files || [];
  }

  /* --------------------------------------------------------------- spreadsheet per user */
  async find(user) {
    if (this.ids.has(user.key)) return this.ids.get(user.key);
    const files = await this.listFiles(`'${dq(this.cfg.driveFolderId)}' in parents and appProperties has { key='hgiUser' and value='${dq(user.key)}' } and mimeType='${SHEET_MIME}' and trashed=false`);
    if (!files.length) return null;
    files.sort((a, b) => String(a.createdTime).localeCompare(String(b.createdTime)));
    if (files.length > 1) this.log({ warn: 'more than one spreadsheet for user — using the oldest', user: user.key, count: files.length });
    this.ids.set(user.key, files[0].id);
    return files[0].id;
  }
  async create(user) {
    const f = await this.drive('/files?fields=id', 'POST', {
      name: `HGI Billing — ${user.email}`, mimeType: SHEET_MIME, parents: [this.cfg.driveFolderId],
      description: `HGI Billing cloud copy for ${user.email}. Written by the HGI sync service — edits here are not copied back to the app.`,
      appProperties: { hgiApp: 'billing', hgiUser: user.key }
    });
    const id = f.id;
    const info = await this.sheets(id, '?fields=sheets.properties');
    const first = info.sheets[0].properties.sheetId;
    const req = [{ updateSheetProperties: { properties: { sheetId: first, title: 'Read me' }, fields: 'title' } }];
    for (const t of [...READABLE_TABS, '_sync', '_data_a', '_data_b']) req.push({ addSheet: { properties: { title: t, hidden: t.startsWith('_'), gridProperties: { rowCount: 1000, columnCount: t.startsWith('_') ? 2 : 26 } } } });
    await this.sheets(id, ':batchUpdate', 'POST', { requests: req });
    await this.sheets(id, '/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data: [{ range: `${q('Read me')}!A1`, values: [
      ['HGI Billing — cloud copy'], [`Account: ${user.email}`], [`Created: ${new Date().toISOString()}`], [''],
      ['The tabs Company, Invoices, Items sold, Payments, Customers and Products show this account\'s data as of the last sync.'],
      ['The app restores from the hidden _data tabs. Changes made in this spreadsheet are NOT copied back to the app.'],
      ['Do not delete or rename the hidden tabs — the account\'s restore copy is stored there.']] }] });
    for (const email of this.cfg.shareWith) {
      try { await this.drive(`/files/${id}/permissions?sendNotificationEmail=false`, 'POST', { type: 'user', role: 'writer', emailAddress: email }); }
      catch (e) { this.log({ warn: 'share failed', user: user.key, error: e.message }); }
    }
    this.ids.set(user.key, id);
    this.log({ event: 'spreadsheet_created', user: user.key });
    return id;
  }
  async tabIds(id) {
    if (this.sheetIds.has(id)) return this.sheetIds.get(id);
    const info = await this.sheets(id, '?fields=sheets.properties');
    const m = {}; for (const s of info.sheets) m[s.properties.title] = { id: s.properties.sheetId, rows: s.properties.gridProperties.rowCount, cols: s.properties.gridProperties.columnCount };
    if (!m._sync || !m._data_a || !m._data_b) throw new CorruptError('The cloud spreadsheet is missing its hidden data tabs');
    this.sheetIds.set(id, m);
    return m;
  }
  async readMeta(id) {
    const r = await this.sheets(id, `/values/${encodeURIComponent(q('_sync') + '!A1')}`);
    const v = r.values && r.values[0] && r.values[0][0];
    if (!v) return { version: 0 };
    try { return JSON.parse(v); } catch (e) { throw new CorruptError('Cloud metadata unreadable'); }
  }

  /* --------------------------------------------------------------- deletion markers */
  async deletedAt(user) {
    const c = this.tomb.get(user.key);
    if (c && Date.now() - c.at < 10 * 60e3) return c.deletedAt;
    const files = await this.listFiles(`'${dq(this.cfg.driveFolderId)}' in parents and appProperties has { key='hgiDeletedUser' and value='${dq(user.key)}' } and trashed=false`);
    const at = files.reduce((m, f) => Math.max(m, Date.parse((f.appProperties || {}).deletedAt) || 0), 0);
    this.tomb.set(user.key, { at: Date.now(), deletedAt: at });
    return at;
  }

  /* --------------------------------------------------------------- public operations */
  meta(user) {
    return this.withLock(user.key, async () => {
      const id = await this.find(user);
      return id ? this.readMeta(id) : { version: 0 };
    });
  }

  read(user) {
    return this.withLock(user.key, async () => {
      const id = await this.find(user);
      if (!id) return { meta: { version: 0 }, data: null };
      const meta = await this.readMeta(id);
      if (!meta.version) return { meta, data: null };
      const buf = await this.readSlot(id, meta.slot, meta.cells);
      if (sha256(buf) !== meta.sha256) throw new CorruptError('Cloud copy failed its checksum');
      return { meta, data: zlib.gunzipSync(buf).toString('utf8') };
    });
  }

  async readSlot(id, slot, cells) {
    const tab = slot === 'b' ? '_data_b' : '_data_a';
    const r = await this.sheets(id, `/values/${encodeURIComponent(`${q(tab)}!A1:A${Math.max(1, cells)}`)}?majorDimension=COLUMNS`);
    const col = (r.values && r.values[0]) || [];
    return Buffer.from(col.join(''), 'base64');
  }

  write(user, json, { baseVersion, clientRev, device }) {
    return this.withLock(user.key, async () => {
      let id = await this.find(user);
      if (!id) id = await this.create(user);
      const meta = await this.readMeta(id);
      const current = Number(meta.version) || 0;
      const jsonSha = sha256(Buffer.from(json, 'utf8'));
      // same data already live (e.g. the phone lost the reply to its previous save): nothing to do
      if (current && meta.jsonSha === jsonSha) return { ...meta, readable: true, unchanged: true };
      if (baseVersion !== '*' && Number(baseVersion) !== current) throw new ConflictError(meta);
      const gz = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
      const b64 = gz.toString('base64');
      const chunks = []; for (let i = 0; i < b64.length; i += CHUNK) chunks.push([b64.slice(i, i + CHUNK)]);
      if (!chunks.length) chunks.push(['']);
      const slot = meta.slot === 'a' ? 'b' : 'a';
      const tab = slot === 'b' ? '_data_b' : '_data_a';
      const ids = await this.tabIds(id);
      if (ids[tab].rows < chunks.length) {
        await this.sheets(id, ':batchUpdate', 'POST', { requests: [{ updateSheetProperties: { properties: { sheetId: ids[tab].id, gridProperties: { rowCount: chunks.length + 50, columnCount: 2 } }, fields: 'gridProperties(rowCount,columnCount)' } }] });
        ids[tab].rows = chunks.length + 50;
      }
      await this.sheets(id, '/values:batchClear', 'POST', { ranges: [`${q(tab)}!A:A`] });
      await this.sheets(id, '/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data: [{ range: `${q(tab)}!A1:A${chunks.length}`, values: chunks }] });
      const back = await this.readSlot(id, slot, chunks.length);
      const hash = sha256(gz);
      if (sha256(back) !== hash) throw new CorruptError('Cloud write could not be verified — nothing was changed');
      const next = { v: 1, version: current + 1, slot, cells: chunks.length, sha256: hash, jsonSha, bytes: Buffer.byteLength(json), clientRev: Number(clientRev) || 0,
        device: String(device || '').slice(0, 80), updatedAt: new Date().toISOString() };
      await this.sheets(id, '/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data: [{ range: `${q('_sync')}!A1:B1`, values: [[JSON.stringify(next), `Last sync ${next.updatedAt} — version ${next.version}`]] }] });
      let readable = true;
      try { await this.writeReadable(id, json); } catch (e) { readable = false; this.log({ warn: 'readable tabs not updated', user: user.key, error: e.message }); }
      return { ...next, readable };
    });
  }

  async writeReadable(id, json) {
    const t = tabs(JSON.parse(json));
    const ids = await this.tabIds(id);
    const resize = [];
    for (const [name, rows] of Object.entries(t)) {
      const info = ids[name]; if (!info) continue;
      const needRows = rows.length + 20, needCols = Math.max(...rows.map(r => r.length));
      if (info.rows < needRows || info.cols < needCols) {
        resize.push({ updateSheetProperties: { properties: { sheetId: info.id, gridProperties: { rowCount: Math.max(info.rows, needRows), columnCount: Math.max(info.cols, needCols) } }, fields: 'gridProperties(rowCount,columnCount)' } });
        info.rows = Math.max(info.rows, needRows); info.cols = Math.max(info.cols, needCols);
      }
    }
    if (resize.length) await this.sheets(id, ':batchUpdate', 'POST', { requests: resize });
    const names = Object.keys(t).filter(k => ids[k]);
    await this.sheets(id, '/values:batchClear', 'POST', { ranges: names.map(q) });
    await this.sheets(id, '/values:batchUpdate', 'POST', { valueInputOption: 'RAW', data: names.map(k => ({ range: `${q(k)}!A1`, values: t[k] })) });
  }

  delete(user) {
    return this.withLock(user.key, async () => {
      const id = await this.find(user);
      // marker first: sessions issued before this moment stop working on every server instance
      const deletedAt = new Date().toISOString();
      await this.drive('/files?fields=id', 'POST', { name: `deleted-account-${user.key}`, mimeType: 'text/plain', parents: [this.cfg.driveFolderId],
        description: 'Marker: this HGI Billing account was deleted. Contains no customer data.', appProperties: { hgiDeletedUser: user.key, deletedAt } });
      this.tomb.set(user.key, { at: Date.now(), deletedAt: Date.parse(deletedAt) });
      let mode = 'none';
      if (id) {
        try { await this.drive(`/files/${encodeURIComponent(id)}`, 'DELETE'); mode = 'deleted'; }
        catch (e) {
          if (!(e instanceof UpstreamError && e.status === 403)) throw e;
          await this.drive(`/files/${encodeURIComponent(id)}`, 'PATCH', { trashed: true }); mode = 'trashed';   // shared-drive role without delete rights
        }
      }
      this.ids.delete(user.key); if (id) this.sheetIds.delete(id);
      this.log({ event: 'account_deleted', user: user.key, mode });
      return { deleted: !!id, mode, deletedAt };
    });
  }
}

module.exports = { SheetStore, ConflictError, CorruptError };
