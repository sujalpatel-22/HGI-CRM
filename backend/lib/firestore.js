'use strict';
/**
 * Minimal Firestore (native mode) REST client — no SDK, no dependencies.
 * Production: https://firestore.googleapis.com with the Cloud Run service account's token.
 * Tests / local: FIRESTORE_EMULATOR_HOST (the official emulator; "Bearer owner").
 */
const { request, UpstreamError } = require('./http');

/* ---------------------------------------------------------------- value encoding */
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === 'object') return { mapValue: { fields: encFields(v) } };
  throw new Error('cannot encode ' + typeof v);
}
const encFields = o => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)]));
function dec(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  if ('bytesValue' in v) return v.bytesValue;
  return null;
}
const decFields = f => Object.fromEntries(Object.entries(f || {}).map(([k, x]) => [k, dec(x)]));

class Firestore {
  /** @param {{projectId:string, emulatorHost?:string, endpoint?:string, access?:{get():Promise<string>, invalidate():void}}} o */
  constructor(o) {
    this.projectId = o.projectId;
    this.emulator = !!o.emulatorHost;
    const host = o.emulatorHost ? `http://${o.emulatorHost}` : (o.endpoint || 'https://firestore.googleapis.com');
    this.root = `projects/${o.projectId}/databases/(default)/documents`;
    this.base = `${host}/v1/${this.root}`;
    this.host = host;
    this.access = o.access;
  }
  name(path) { return `${this.root}/${path}`; }
  pathOf(name) { return name.slice(this.root.length + 1); }
  async call(method, url, body) {
    for (let i = 0; i < 2; i++) {
      const token = this.emulator ? 'owner' : await this.access.get();
      try { return await request(method, url, { body, headers: { Authorization: `Bearer ${token}` }, retries: 2 }); }
      catch (e) { if (e instanceof UpstreamError && e.status === 401 && i === 0 && !this.emulator) { this.access.invalidate(); continue; } throw e; }
    }
  }
  docFrom(d) { return d ? { path: this.pathOf(d.name), ...decFields(d.fields) } : null; }

  async get(path, tx) {
    const r = await this.batchGet([path], tx);
    return r[0];
  }
  async batchGet(paths, tx) {
    if (!paths.length) return [];
    const res = await this.call('POST', `${this.base}:batchGet`, { documents: paths.map(p => this.name(p)), ...(tx ? { transaction: tx } : {}) });
    const by = new Map();
    for (const x of res) { if (x.found) by.set(this.pathOf(x.found.name), this.docFrom(x.found)); }
    return paths.map(p => by.get(p) || null);
  }
  async begin() { return (await this.call('POST', `${this.base}:beginTransaction`, { options: { readWrite: {} } })).transaction; }
  async rollback(tx) { try { await this.call('POST', `${this.base}:rollback`, { transaction: tx }); } catch (e) { /* ignore */ } }
  /** writes: [{set:path, data}] | [{del:path}] */
  async commit(writes, tx) {
    const w = writes.map(x => x.del ? { delete: this.name(x.del) } : { update: { name: this.name(x.set), fields: encFields(x.data) } });
    return this.call('POST', `${this.base}:commit`, { writes: w, ...(tx ? { transaction: tx } : {}) });
  }
  /** runs fn(tx) and commits its writes; retries when Firestore aborts on contention */
  async transaction(fn) {
    for (let attempt = 0; ; attempt++) {
      const tx = await this.begin();
      let writes, result;
      try { ({ writes, result } = await fn(tx)); }
      catch (e) { await this.rollback(tx); throw e; }
      try { if (writes.length) await this.commit(writes, tx); else await this.rollback(tx); return result; }
      catch (e) {
        const aborted = e instanceof UpstreamError && (e.status === 409 || /ABORTED|contention|transaction/i.test(e.message));
        if (!aborted || attempt >= 4) throw e;
        await new Promise(r => setTimeout(r, 100 * 2 ** attempt + Math.random() * 100));
      }
    }
  }
  /** documents in parentPath/collection with intField > after, ascending, at most limit */
  async queryAfter(parentPath, collection, intField, after, limit) {
    const res = await this.call('POST', `${this.base}/${parentPath}:runQuery`, { structuredQuery: {
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: intField }, op: 'GREATER_THAN', value: { integerValue: String(after) } } },
      orderBy: [{ field: { fieldPath: intField }, direction: 'ASCENDING' }],
      limit } });
    return res.filter(x => x.document).map(x => this.docFrom(x.document));
  }
  /** all document paths in a collection (paged) */
  async listPaths(collectionPath, maskField) {
    const out = []; let token = '';
    do {
      // the mask (one small, existing field) keeps large documents out of the answer
      const r = await this.call('GET', `${this.base}/${collectionPath}?pageSize=300${maskField ? '&mask.fieldPaths=' + encodeURIComponent(maskField) : ''}${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
      for (const d of r.documents || []) out.push(this.pathOf(d.name));
      token = r.nextPageToken || '';
    } while (token);
    return out;
  }
}

module.exports = { Firestore, enc, dec, encFields, decFields };
