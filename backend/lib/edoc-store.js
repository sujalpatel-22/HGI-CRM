'use strict';
/**
 * Server-side record of every IRN / e-way bill of an account — the source of truth if a phone loses its copy.
 *
 *   users/{uid}/edocs/{sha1(key)}   { key, docId, rec (JSON text), lock: {until, by} | null, updatedAt }
 *     key = "<seller GSTIN>|<INV|CRN|DBN>|<document number>|<financial year>"   (the IRP's own uniqueness rule)
 *
 * One operation per document at a time, across all Cloud Run instances: an operation takes a 2-minute lease in a
 * Firestore transaction (a second phone or a double tap gets "already in progress"), and within one instance calls
 * for the same document wait for each other.
 */
const crypto = require('crypto');
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const LEASE_MS = 120e3;

class Busy extends Error { constructor() { super('This document is already being reported to the GST system from another device. Try again in a minute.'); this.status = 409; this.code = 'EDOC_BUSY'; } }

class EdocStore {
  constructor(fs) { this.fs = fs; this.local = new Map(); }
  path(uid, key) { return `users/${uid}/edocs/${sha1(key)}`; }
  parse(d) { if (!d) return null; try { return JSON.parse(d.rec || '{}'); } catch (e) { return null; } }

  async get(uid, key) { return this.parse(await this.fs.get(this.path(uid, key))); }

  /** fn(rec) → new rec. Stored in a transaction so a concurrent writer is never lost. */
  async update(uid, key, fn) {
    const p = this.path(uid, key);
    return this.fs.transaction(async tx => {
      const d = await this.fs.get(p, tx);
      const cur = this.parse(d) || { key, log: [] };
      const next = fn(cur) || cur;
      next.key = key;
      next.updatedAt = new Date().toISOString();
      return { writes: [{ set: p, data: { key, docId: String(next.docId || ''), rec: JSON.stringify(next), lock: d ? d.lock || null : null, updatedAt: new Date() } }], result: next };
    });
  }
  addLog(uid, key, entry) {
    return this.update(uid, key, r => { r.log = [...(r.log || []), { at: new Date().toISOString(), ...entry }].slice(-100); return r; });
  }

  async lease(uid, key, by) {
    const p = this.path(uid, key), token = crypto.randomBytes(8).toString('hex');
    await this.fs.transaction(async tx => {
      const d = await this.fs.get(p, tx);
      if (d && d.lock && Number(d.lock.until) > Date.now()) throw new Busy();
      const data = d ? { key: d.key, docId: d.docId || '', rec: d.rec || JSON.stringify({ key, log: [] }), updatedAt: new Date() }
        : { key, docId: '', rec: JSON.stringify({ key, log: [] }), updatedAt: new Date() };
      return { writes: [{ set: p, data: { ...data, lock: { until: Date.now() + LEASE_MS, by: String(by || '').slice(0, 40), token } } }], result: null };
    });
    return token;
  }
  async release(uid, key, token) {
    const p = this.path(uid, key);
    try {
      await this.fs.transaction(async tx => {
        const d = await this.fs.get(p, tx);
        if (!d || !d.lock || d.lock.token !== token) return { writes: [], result: null };
        return { writes: [{ set: p, data: { key: d.key, docId: d.docId || '', rec: d.rec, lock: null, updatedAt: new Date() } }], result: null };
      });
    } catch (e) { /* the lease expires by itself */ }
  }
  /** run fn while holding the document's lease */
  async withLock(uid, key, by, fn) {
    const k = uid + '|' + key;
    while (this.local.has(k)) await this.local.get(k).catch(() => {});
    let done;
    const p = new Promise(r => (done = r));
    this.local.set(k, p);
    let token;
    try {
      token = await this.lease(uid, key, by);
      return await fn();
    } finally {
      if (token) await this.release(uid, key, token);
      this.local.delete(k); done();
    }
  }
}

module.exports = { EdocStore, Busy };
