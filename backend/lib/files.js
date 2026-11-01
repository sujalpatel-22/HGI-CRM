'use strict';
/** Invoice PDFs in a private Cloud Storage bucket (JSON API, the service account's token). Objects: users/{uid}/pdf/{docId}.pdf */
const { request, UpstreamError } = require('./http');

class FileStore {
  constructor(cfg, access) {
    this.bucket = cfg.filesBucket;
    this.api = cfg.endpoints.storage;                 // https://storage.googleapis.com
    this.access = access;
  }
  enabled() { return !!this.bucket; }
  async auth() { return { Authorization: `Bearer ${await this.access.get()}` }; }
  object(uid, docId) { return `users/${uid}/pdf/${encodeURIComponent(docId).replace(/%/g, '_')}.pdf`; }
  async put(objectName, buf, contentType = 'application/pdf') {
    const url = `${this.api}/upload/storage/v1/b/${encodeURIComponent(this.bucket)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 60000);
    try {
      const r = await fetch(url, { method: 'POST', headers: { ...(await this.auth()), 'Content-Type': contentType }, body: buf, signal: ctrl.signal });
      if (!r.ok) throw new UpstreamError(`Cloud Storage upload failed (HTTP ${r.status})`, r.status, r.status >= 500 || r.status === 429);
      return JSON.parse(await r.text());
    } catch (e) { if (e instanceof UpstreamError) throw e; throw new UpstreamError('Cloud Storage unreachable', 504, true); }
    finally { clearTimeout(t); }
  }
  async get(objectName) {
    const r = await fetch(`${this.api}/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(objectName)}?alt=media`, { headers: await this.auth() });
    if (r.status === 404) return null;
    if (!r.ok) throw new UpstreamError(`Cloud Storage read failed (HTTP ${r.status})`, r.status, r.status >= 500);
    return Buffer.from(await r.arrayBuffer());
  }
  async remove(objectName) {
    try { await request('DELETE', `${this.api}/storage/v1/b/${encodeURIComponent(this.bucket)}/o/${encodeURIComponent(objectName)}`, { headers: await this.auth(), raw: true, retries: 2 }); }
    catch (e) { if (!(e instanceof UpstreamError && e.status === 404)) throw e; }
  }
}

module.exports = { FileStore };
