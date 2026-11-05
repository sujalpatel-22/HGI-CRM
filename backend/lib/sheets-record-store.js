'use strict';
/**
 * The app's business records in Google Sheets (same protocol as before: pull since a sequence number, push with base
 * revisions → ok / conflict / number_taken). Every row is keyed by (userId, id); userId always comes from the session.
 *
 *   Settings      company profile + synced app settings          (one row per kind)
 *   Customers     buyers / suppliers
 *   Products      item master
 *   Invoices      invoices, credit / debit notes, quotations, proforma invoices, orders, purchase orders
 *   InvoiceItems  one row per document line        (userId, invoiceId, lineNo)
 *   Payments      one row per receipt / payment    (userId, invoiceId, lineNo)
 *   DocNumbers    one row per used document number (userId, "TYPE|number") — a number can be used once per type and account
 *   Users.seq     the account's change counter
 *
 * Each push is one write to the spreadsheet (all records, lines, numbers and the counter together).
 */
const crypto = require('crypto');
const { KIND_TAB, RECORD_TABS, rowsFor, rowsToRecord } = require('./sheets-schema');

const KINDS = new Set(Object.keys(KIND_TAB));
const MAX_RECORD = 900 * 1024;
const hashOf = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
const numKey = (docType, num) => `${String(docType || 'INV').toUpperCase()}|${String(num || '').trim().replace(/\s+/g, ' ').toLowerCase()}`;
const numberedKind = k => k === 'invoice';

class BadRequest extends Error { constructor(m, code = 'bad_request') { super(m); this.status = 400; this.code = code; } }
class NoAccount extends Error { constructor() { super('This account no longer exists. Sign in again.'); this.status = 401; this.code = 'account_deleted'; } }

class SheetsRecordStore {
  /** @param {import('./sheet-db').SheetDB} db */
  constructor(db, docs, log = () => {}) { this.db = db; this.docs = docs; this.log = log; }

  mainKey(uid, kind, id) { return KIND_TAB[kind] === 'Settings' ? { userId: uid, kind, id } : { userId: uid, id }; }
  /** the record as JSON text (or null when deleted) from its rows */
  textOf(tab, row) {
    if (row.deleted === true) return null;
    const kind = tab === 'Settings' ? row.kind : ({ Customers: 'customer', Products: 'product', Invoices: 'invoice' })[tab];
    let items = [], pays = [];
    if (tab === 'Invoices') {
      items = this.db.t('InvoiceItems').where('invoiceId', row.id).filter(r => r.userId === row.userId);
      pays = this.db.t('Payments').where('invoiceId', row.id).filter(r => r.userId === row.userId);
    }
    return JSON.stringify(rowsToRecord(kind, row.id, row, items, pays));
  }
  kindOf(tab, row) { return tab === 'Settings' ? row.kind : ({ Customers: 'customer', Products: 'product', Invoices: 'invoice' })[tab]; }

  async deletedAt() { return 0; }          // a deleted account's sessions are revoked with it (see accounts.js)

  async state(uid) {
    await this.db.fresh();
    const u = this.db.t('Users').get({ userId: uid });
    return { seq: u ? Number(u.seq) || 0 : 0, createdAt: u ? u.createdAt : null, lastSyncAt: u ? u.lastSyncAt || null : null };
  }

  /** records changed after `since`, oldest first */
  async pull(uid, since, limit = 300) {
    await this.db.fresh();
    const rows = [];
    for (const tab of RECORD_TABS) for (const r of this.db.t(tab).where('userId', uid)) if ((Number(r.seq) || 0) > since) rows.push({ tab, r });
    rows.sort((a, b) => a.r.seq - b.r.seq);
    const page = rows.slice(0, limit);
    return {
      records: page.map(({ tab, r }) => ({ kind: this.kindOf(tab, r), id: String(r.id), rev: Number(r.rev) || 0, seq: Number(r.seq) || 0, deleted: r.deleted === true, data: this.textOf(tab, r), modifiedAt: r.modifiedAt || '', device: r.device || '' })),
      more: page.length === limit
    };
  }

  async numberFree(uid, docType, num, docId) {
    await this.db.fresh();
    const n = this.db.t('DocNumbers').get({ userId: uid, numKey: numKey(docType, num) });
    return { free: !n || n.docId === docId, takenBy: n && n.docId !== docId ? n.docId : null };
  }

  /**
   * items: [{kind, id, baseRev, deleted, data (JSON text), modifiedAt}]
   * → results: [{kind, id, status: 'ok'|'conflict'|'number_taken'|'too_large'|'invalid', rev, server?}]
   */
  async push(uid, user, items, device) {
    if (!Array.isArray(items) || !items.length) throw new BadRequest('No records');
    if (items.length > 200) throw new BadRequest('At most 200 records per request');
    const seen = new Set();
    for (const it of items) {
      if (!it || typeof it !== 'object') throw new BadRequest('Bad record');
      if (!KINDS.has(it.kind)) throw new BadRequest(`Unknown kind ${it.kind}`);
      if (typeof it.id !== 'string' || !it.id || it.id.length > 300 || /[\u0000-\u001f]/.test(it.id)) throw new BadRequest('Bad record id');
      const k = it.kind + '~' + it.id;
      if (seen.has(k)) throw new BadRequest('Record listed twice: ' + k);
      seen.add(k);
    }
    // parse + split into rows before taking the write queue (CPU work outside the queue)
    const parsed = items.map(it => {
      if (it.deleted) return { it, obj: null };
      if (typeof it.data !== 'string') return { it, bad: 'invalid' };
      if (Buffer.byteLength(it.data) > MAX_RECORD) return { it, bad: 'too_large' };
      let obj; try { obj = JSON.parse(it.data); } catch (e) { return { it, bad: 'invalid' }; }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { it, bad: 'invalid' };
      const enc = rowsFor(it.kind, it.id, obj, it.data);
      if (!enc.lossless) { this.log({ warn: true, event: 'record_not_storable', kind: it.kind }); return { it, bad: 'invalid' }; }
      if (enc.fallback) this.log({ event: 'record_stored_whole', kind: it.kind });
      return { it, obj, rows: enc.rows, hash: hashOf(it.data) };
    });
    const dev = String(device || '').replace(/[\u0000-\u001f]/g, '').slice(0, 80);
    return this.db.tx(async w => {
      const u = w.get('Users', { userId: uid });
      if (!u || u.status !== 'active') throw new NoAccount();
      let seq = Number(u.seq) || 0;
      const results = [], now = new Date().toISOString();
      for (const p of parsed) {
        const { it } = p;
        const base = { kind: it.kind, id: it.id };
        if (p.bad) { results.push({ ...base, status: p.bad }); continue; }
        const tab = KIND_TAB[it.kind], key = this.mainKey(uid, it.kind, it.id);
        const ex = w.get(tab, key);
        const exRev = ex ? Number(ex.rev) || 0 : 0;
        const incomingHash = it.deleted ? 'deleted' : p.hash;
        // the same content is already stored (e.g. the reply to an earlier push was lost)
        if (ex && (ex.deleted === true ? 'deleted' : ex.hash) === incomingHash) { results.push({ ...base, status: 'ok', rev: exRev, unchanged: true }); continue; }
        if (exRev !== (Number(it.baseRev) || 0)) {
          results.push({ ...base, status: 'conflict', rev: exRev, server: ex ? { rev: exRev, deleted: ex.deleted === true, data: this.stagedText(w, tab, ex), modifiedAt: ex.modifiedAt, device: ex.device } : { rev: 0, deleted: true, data: null } });
          continue;
        }
        if (!ex && it.deleted) { results.push({ ...base, status: 'ok', rev: 0, unchanged: true }); continue; }
        // document numbers: unique per document type within the account
        let want = null, old = null;
        if (numberedKind(it.kind)) {
          if (p.obj && p.obj.num) want = numKey(p.obj.docType, p.obj.num);
          if (ex && ex.deleted !== true && ex.num !== undefined) old = numKey(ex.docType, ex.num);
          if (want && want !== old) {
            const holder = w.get('DocNumbers', { userId: uid, numKey: want });
            if (holder && holder.docId !== it.id) { results.push({ ...base, status: 'number_taken', rev: exRev, takenBy: holder.docId, num: p.obj.num, docType: p.obj.docType || 'INV' }); continue; }
          }
          if (old && old !== want) { const h = w.get('DocNumbers', { userId: uid, numKey: old }); if (h && h.docId === it.id) w.remove('DocNumbers', { userId: uid, numKey: old }); }
          if (want && want !== old) w.put('DocNumbers', { userId: uid, numKey: want, docType: String(p.obj.docType || 'INV'), num: String(p.obj.num), docId: it.id, claimedAt: now });
        }
        seq += 1;
        const rev = exRev + 1;
        const sync = { userId: uid, id: it.id, rev, seq, deleted: !!it.deleted, hash: incomingHash, modifiedAt: String(it.modifiedAt || now).slice(0, 40), device: dev, updatedAt: now };
        // lines and receipts: the document's child rows are rewritten (rows beyond the new count are blanked)
        if (tab === 'Invoices') {
          for (const [child, list] of [['InvoiceItems', p.rows ? p.rows.items : []], ['Payments', p.rows ? p.rows.payments : []]]) {
            const have = this.db.t(child).where('invoiceId', it.id).filter(r => r.userId === uid);
            for (const r of list) w.put(child, { userId: uid, invoiceId: it.id, ...r });
            for (const r of have) if (r.lineNo > list.length) w.remove(child, { userId: uid, invoiceId: it.id, lineNo: r.lineNo });
          }
        }
        if (it.deleted) w.put(tab, { ...sync, ...(tab === 'Settings' ? { kind: it.kind } : {}) });
        else w.put(tab, { ...sync, ...p.rows.main, ...(tab === 'Settings' ? { kind: it.kind } : {}) });
        results.push({ ...base, status: 'ok', rev, seq });
      }
      if (seq !== (Number(u.seq) || 0)) w.put('Users', { ...u, seq, lastSyncAt: now });
      return { results, seq };
    });
  }
  /** text of a row as it stands inside a running write (its lines may not be written yet: only for the conflict reply) */
  stagedText(w, tab, row) { return this.textOf(tab, row); }

  /** removes every business row of the account (Users row and sessions are handled by the accounts module) */
  async deleteAll(uid, w) {
    let n = 0;
    for (const tab of [...RECORD_TABS, 'InvoiceItems', 'Payments', 'DocNumbers', 'Store']) {
      const t = this.db.t(tab);
      for (const r of t.where('userId', uid)) { w.remove(tab, t.keyOf(r)); n++; }
    }
    return n;
  }

  async fileEntries(uid) {
    const paths = await this.docs.listPaths(`users/${uid}/files`);
    const docs = await this.docs.batchGet(paths);
    return docs.filter(Boolean).map(d => ({ docId: d.docId, num: d.num, docType: d.docType, bytes: d.bytes, hash: d.hash, uploadedAt: d.uploadedAt, object: d.object }));
  }
  async putFileEntry(uid, docId, entry) { await this.docs.commit([{ set: `users/${uid}/files/${safeId(docId)}`, data: { docId, ...entry } }]); }
  async getFileEntry(uid, docId) { return this.docs.get(`users/${uid}/files/${safeId(docId)}`); }
}
const safeId = id => (/^[A-Za-z0-9_.-]{1,200}$/.test(id) ? id : 'b64.' + Buffer.from(id).toString('base64url'));

module.exports = { SheetsRecordStore, BadRequest, NoAccount, numKey, hashOf, KINDS };
