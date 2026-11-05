'use strict';
/**
 * Small key → document store on the "Store" tab, with the interface the e-invoice records, the encrypted e-invoice API
 * logins, the PDF index and the GSTIN cache were written against (get / batchGet / commit / transaction / listPaths).
 *
 *   path                                  userId       kind        data (JSON)
 *   users/{uid}/edocs/{sha1}              {uid}        edocs       e-invoice / e-way bill record of one document
 *   users/{uid}/edoc_cred/{GSTIN}         {uid}        edoc_cred   AES-256-GCM sealed API login (see credentials.js)
 *   users/{uid}/files/{docId}             {uid}        files       where an invoice PDF is stored
 *   gstin_cache/{GSTIN}                                gstin_cache GST record look-ups (7 days)
 */
const pathRe = /^[A-Za-z0-9_.~-]+(\/[A-Za-z0-9_.~-]+)*$/;
const ownerOf = p => { const m = /^users\/([^/]+)\//.exec(p); return m ? m[1] : ''; };
const kindOf = p => { const parts = p.split('/'); return parts[0] === 'users' ? parts[2] || '' : parts[0]; };
const plain = v => JSON.parse(JSON.stringify(v));      // Dates → ISO text, as stored

class SheetsDocStore {
  /** @param {import('./sheet-db').SheetDB} db */
  constructor(db) { this.db = db; }
  check(p) { if (!pathRe.test(p) || p.length > 400) throw new Error('bad store path ' + p); }
  read(p) { const r = this.db.t('Store').get({ path: p }); return r && r.data && typeof r.data === 'object' ? { path: p, ...r.data } : null; }
  async get(p) { this.check(p); await this.db.fresh(); return this.read(p); }
  async batchGet(paths) { await this.db.fresh(); return paths.map(p => { this.check(p); return this.read(p); }); }
  stage(w, x) {
    if (x.del) { this.check(x.del); w.remove('Store', { path: x.del }); return; }
    this.check(x.set);
    w.put('Store', { path: x.set, userId: ownerOf(x.set), kind: kindOf(x.set), data: plain(x.data), updatedAt: new Date().toISOString() });
  }
  async commit(writes) { if (!writes.length) return; await this.db.tx(async w => { writes.forEach(x => this.stage(w, x)); }); }
  /** fn(tx) → {writes, result}; runs in the spreadsheet's write queue, so nobody writes between its read and its write */
  async transaction(fn) {
    return this.db.tx(async w => {
      const { writes, result } = await fn(w);
      (writes || []).forEach(x => this.stage(w, x));
      return result;
    });
  }
  /** paths directly inside a collection */
  async listPaths(collection) {
    await this.db.fresh();
    const pre = collection.replace(/\/$/, '') + '/';
    const uid = ownerOf(pre);
    const rows = uid ? this.db.t('Store').where('userId', uid) : this.db.t('Store').all();
    return rows.map(r => String(r.path)).filter(p => p.startsWith(pre) && !p.slice(pre.length).includes('/')).sort();
  }
}

module.exports = { SheetsDocStore, ownerOf, kindOf };
