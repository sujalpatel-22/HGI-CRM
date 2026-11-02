'use strict';
/**
 * Each business's own e-invoice / e-way bill API login (the "API user" it creates on einvoice1.gst.gov.in and
 * ewaybillgst.gov.in for HGI's GSP). Stored only on the server, in Firestore, encrypted with AES-256-GCM under
 * EDOC_CRED_KEY (Secret Manager). The account uid and GSTIN are bound in as associated data, so an encrypted blob
 * copied to another account or GSTIN does not decrypt. Passwords are never sent back to the app.
 *
 *   users/{uid}/edoc_cred/{GSTIN}  { gstin, env, blob, irpUser, ewbUser (masked), hasIrp, hasEwb, verified, updatedAt }
 */
const crypto = require('crypto');

const mask = u => { u = String(u || ''); return u.length <= 3 ? (u ? u[0] + '••' : '') : u.slice(0, 2) + '•'.repeat(Math.min(6, u.length - 3)) + u.slice(-1); };

class CredentialVault {
  /** @param {Buffer} key 32 bytes */
  constructor(fs, key) {
    if (key && key.length !== 32) throw new Error('EDOC_CRED_KEY must decode to 32 bytes');
    this.fs = fs; this.key = key || null;
  }
  enabled() { return !!this.key; }
  path(uid, gstin) { return `users/${uid}/edoc_cred/${gstin}`; }
  seal(uid, gstin, obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    c.setAAD(Buffer.from(`hgi-edoc|${uid}|${gstin}`));
    const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
    return 'v1.' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  }
  open(uid, gstin, blob) {
    const raw = Buffer.from(String(blob).replace(/^v1\./, ''), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    d.setAAD(Buffer.from(`hgi-edoc|${uid}|${gstin}`));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
  }
  /** full secret login, for server use only */
  async get(uid, gstin) {
    const d = await this.fs.get(this.path(uid, gstin));
    if (!d) return null;
    let secret;
    try { secret = this.open(uid, gstin, d.blob); } catch (e) { return { ...d, broken: true }; }
    return { ...d, secret };
  }
  async put(uid, gstin, env, secret, verified) {
    const doc = { gstin, env, blob: this.seal(uid, gstin, secret), irpUser: mask(secret.irpUser), ewbUser: mask(secret.ewbUser),
      hasIrp: !!(secret.irpUser && secret.irpPass), hasEwb: !!(secret.ewbUser && secret.ewbPass), verified: verified || {}, updatedAt: new Date().toISOString() };
    await this.fs.commit([{ set: this.path(uid, gstin), data: doc }]);
    return CredentialVault.public(doc);
  }
  async remove(uid, gstin) { await this.fs.commit([{ del: this.path(uid, gstin) }]); }
  async list(uid) {
    const paths = await this.fs.listPaths(`users/${uid}/edoc_cred`, 'gstin');
    return (await this.fs.batchGet(paths)).filter(Boolean).map(CredentialVault.public);
  }
  /** what the app may see: masked user names, never passwords */
  static public(d) {
    return { gstin: d.gstin, env: d.env, irpUser: d.irpUser || '', ewbUser: d.ewbUser || '', hasIrp: !!d.hasIrp, hasEwb: !!d.hasEwb, verified: d.verified || {}, updatedAt: d.updatedAt };
  }
}

module.exports = { CredentialVault, mask };
