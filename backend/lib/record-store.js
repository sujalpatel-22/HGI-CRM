'use strict';
/**
 * Per-account business data in Firestore, one document per record:
 *
 *   users/{uid}                         { email, name, seq, createdAt, lastSyncAt }
 *   users/{uid}/records/{kind}~{id}     { kind, id, data (JSON text), deleted, rev, seq, modifiedAt, device, hash, updatedAt }
 *   users/{uid}/numbers/{sha1}          { docType, num, docId }      ← one per used document number (no duplicates)
 *   users/{uid}/files/{docId}           { object, bytes, num, docType, hash, uploadedAt }
 *   deletions/{uid}                     { deletedAt }                ← sessions issued earlier stop working
 *   gstin_cache/{GSTIN}                 { data, source, fetchedAt }
 *
 * uid is a hash of the Google account ID; no request can name another account's uid — it always comes from the session.
 * Each push runs in one Firestore transaction: records whose base revision is stale come back as conflicts, and an
 * invoice / note / quotation whose number is already used by a different document comes back as number_taken.
 */
const crypto = require('crypto');

const KINDS = new Set(['company', 'settings', 'customer', 'product', 'invoice']);
const MAX_RECORD = 900 * 1024;           // Firestore documents are limited to 1 MiB
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const hashOf = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
const safeId = id => (/^[A-Za-z0-9_.-]{1,200}$/.test(id) ? id : 'b64.' + Buffer.from(id).toString('base64url'));
const recPath = (uid, kind, id) => `users/${uid}/records/${kind}~${safeId(id)}`;
const numKey = (docType, num) => `${String(docType || 'INV').toUpperCase()}|${String(num || '').trim().replace(/\s+/g, ' ').toLowerCase()}`;
const numPath = (uid, docType, num) => `users/${uid}/numbers/${sha1(numKey(docType, num))}`;
const numberedKind = k => k === 'invoice';

class BadRequest extends Error { constructor(m, code = 'bad_request') { super(m); this.status = 400; this.code = code; } }

class RecordStore {
  constructor(fs, log = () => {}) { this.fs = fs; this.log = log; this.tomb = new Map(); }

  async deletedAt(uid) {
    const c = this.tomb.get(uid);
    if (c && Date.now() - c.at < 5 * 60e3) return c.deletedAt;
    const d = await this.fs.get(`deletions/${uid}`);
    const at = d ? Date.parse(d.deletedAt) || 0 : 0;
    this.tomb.set(uid, { at: Date.now(), deletedAt: at });
    return at;
  }

  async state(uid) {
    const u = await this.fs.get(`users/${uid}`);
    return { seq: u ? Number(u.seq) || 0 : 0, createdAt: u ? u.createdAt : null, lastSyncAt: u ? u.lastSyncAt : null };
  }

  /** records changed after `since` (sequence number), oldest first */
  async pull(uid, since, limit = 300) {
    const docs = await this.fs.queryAfter(`users/${uid}`, 'records', 'seq', Number(since) || 0, limit);
    return {
      records: docs.map(d => ({ kind: d.kind, id: d.id, rev: d.rev, seq: d.seq, deleted: !!d.deleted, data: d.deleted ? null : d.data, modifiedAt: d.modifiedAt, device: d.device })),
      more: docs.length === limit
    };
  }

  /** is a document number free for docId? (pre-check before saving; the push enforces it) */
  async numberFree(uid, docType, num, docId) {
    const n = await this.fs.get(numPath(uid, docType, num));
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
      if (!KINDS.has(it.kind)) throw new BadRequest(`Unknown kind ${it.kind}`);
      if (typeof it.id !== 'string' || !it.id || it.id.length > 300) throw new BadRequest('Bad record id');
      const k = it.kind + '~' + it.id;
      if (seen.has(k)) throw new BadRequest('Record listed twice: ' + k);
      seen.add(k);
    }
    return this.fs.transaction(async tx => {
      const userPath = `users/${uid}`;
      // first read: the account, every touched record, and the numbers the new versions want
      const parsed = items.map(it => {
        if (it.deleted) return { it, obj: null };
        if (typeof it.data !== 'string') return { it, bad: 'invalid' };
        if (Buffer.byteLength(it.data) > MAX_RECORD) return { it, bad: 'too_large' };
        let obj; try { obj = JSON.parse(it.data); } catch (e) { return { it, bad: 'invalid' }; }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { it, bad: 'invalid' };
        return { it, obj };
      });
      const recPaths = items.map(it => recPath(uid, it.kind, it.id));
      const [u, ...existing] = await this.fs.batchGet([userPath, ...recPaths], tx);
      // numbers: the wanted one (new data) and the old one (current server data) for numbered kinds
      const wantNum = new Map(), oldNum = new Map();
      parsed.forEach((p, i) => {
        if (!numberedKind(p.it.kind)) return;
        if (p.obj && p.obj.num) wantNum.set(i, numPath(uid, p.obj.docType, p.obj.num));
        const ex = existing[i];
        if (ex && !ex.deleted) { try { const o = JSON.parse(ex.data); if (o.num) oldNum.set(i, numPath(uid, o.docType, o.num)); } catch (e) { /* ignore */ } }
      });
      const numPaths = [...new Set([...wantNum.values(), ...oldNum.values()])];
      const numDocs = new Map((await this.fs.batchGet(numPaths, tx)).map((d, i) => [numPaths[i], d]));

      let seq = u ? Number(u.seq) || 0 : 0;
      const writes = [], results = [], now = new Date().toISOString();
      const claimed = new Map();   // numPath → docId claimed within this batch
      const released = new Set();
      parsed.forEach((p, i) => {
        const { it } = p;
        const ex = existing[i];
        const exRev = ex ? Number(ex.rev) || 0 : 0;
        const base = { kind: it.kind, id: it.id };
        if (p.bad) return results.push({ ...base, status: p.bad });
        const incomingHash = it.deleted ? 'deleted' : hashOf(it.data);
        // the same content is already stored (e.g. the reply to an earlier push was lost)
        if (ex && (ex.deleted ? 'deleted' : ex.hash) === incomingHash) return results.push({ ...base, status: 'ok', rev: exRev, unchanged: true });
        if (exRev !== (Number(it.baseRev) || 0)) {
          return results.push({ ...base, status: 'conflict', rev: exRev, server: ex ? { rev: exRev, deleted: !!ex.deleted, data: ex.deleted ? null : ex.data, modifiedAt: ex.modifiedAt, device: ex.device } : { rev: 0, deleted: true, data: null } });
        }
        if (!ex && it.deleted) return results.push({ ...base, status: 'ok', rev: 0, unchanged: true });
        // document numbers are unique per document type
        const want = wantNum.get(i), old = oldNum.get(i);
        if (want && want !== old) {
          const holder = claimed.has(want) ? { docId: claimed.get(want) } : (released.has(want) ? null : numDocs.get(want));
          if (holder && holder.docId !== it.id) return results.push({ ...base, status: 'number_taken', rev: exRev, takenBy: holder.docId, num: p.obj.num, docType: p.obj.docType || 'INV' });
        }
        if (old && old !== want) { writes.push({ del: old }); released.add(old); claimed.delete(old); }
        if (want && want !== old) { writes.push({ set: want, data: { docType: String(p.obj.docType || 'INV'), num: String(p.obj.num), docId: it.id, claimedAt: now } }); claimed.set(want, it.id); }
        seq += 1;
        const rev = exRev + 1;
        writes.push({ set: recPaths[i], data: { kind: it.kind, id: it.id, data: it.deleted ? '' : it.data, deleted: !!it.deleted, rev, seq, hash: incomingHash,
          modifiedAt: String(it.modifiedAt || now).slice(0, 40), device: String(device || '').slice(0, 80), updatedAt: new Date() } });
        results.push({ ...base, status: 'ok', rev, seq });
      });
      if (writes.length) writes.push({ set: userPath, data: { email: user.email, name: user.name || '', seq, createdAt: (u && u.createdAt) || now, lastSyncAt: now } });
      return { writes, result: { results, seq } };
    });
  }

  /** removes every record, number and file entry of the account (objects in Cloud Storage are removed by the caller) */
  async deleteAll(uid) {
    const paths = [];
    for (const [col, f] of [['records', 'kind'], ['numbers', 'docId'], ['files', 'docId']]) paths.push(...await this.fs.listPaths(`users/${uid}/${col}`, f));
    const deletedAt = new Date().toISOString();
    await this.fs.commit([{ set: `deletions/${uid}`, data: { deletedAt } }]);
    this.tomb.set(uid, { at: Date.now(), deletedAt: Date.parse(deletedAt) });
    for (let i = 0; i < paths.length; i += 400) await this.fs.commit(paths.slice(i, i + 400).map(p => ({ del: p })));
    await this.fs.commit([{ del: `users/${uid}` }]);
    return { records: paths.length, deletedAt };
  }

  async fileEntries(uid) {
    const paths = await this.fs.listPaths(`users/${uid}/files`, 'docId');
    const docs = await this.fs.batchGet(paths);
    return docs.filter(Boolean).map(d => ({ docId: d.docId, num: d.num, docType: d.docType, bytes: d.bytes, hash: d.hash, uploadedAt: d.uploadedAt, object: d.object }));
  }
  async putFileEntry(uid, docId, entry) { await this.fs.commit([{ set: `users/${uid}/files/${safeId(docId)}`, data: { docId, ...entry } }]); }
  async getFileEntry(uid, docId) { return this.fs.get(`users/${uid}/files/${safeId(docId)}`); }
}

module.exports = { RecordStore, BadRequest, numKey, recPath, safeId, hashOf, KINDS };
