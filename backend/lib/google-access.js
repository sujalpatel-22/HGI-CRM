'use strict';
/** Access tokens for the Drive + Sheets APIs (company Drive). Cached until shortly before expiry. */
const crypto = require('crypto');
const { request } = require('./http');

const SCOPE = 'https://www.googleapis.com/auth/drive';

class GoogleAccess {
  constructor(cfg) { this.cfg = cfg; this.token = null; this.until = 0; this.pending = null; }
  async get() {
    if (this.token && Date.now() < this.until) return this.token;
    if (!this.pending) this.pending = this.fetch().finally(() => { this.pending = null; });
    return this.pending;
  }
  invalidate() { this.token = null; this.until = 0; }
  async fetch() {
    const { cfg } = this;
    let r;
    if (cfg.driveAuth === 'metadata') {
      r = await request('GET', `${cfg.endpoints.metadata}?scopes=${encodeURIComponent(SCOPE)}`, { headers: { 'Metadata-Flavor': 'Google' }, timeoutMs: 10000 });
    } else if (cfg.driveAuth === 'sa-key') {
      const key = JSON.parse(cfg.saKeyJson);
      const now = Math.floor(Date.now() / 1000);
      const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({ iss: key.client_email, scope: SCOPE, aud: cfg.endpoints.token, iat: now, exp: now + 3600 });
      const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key.private_key).toString('base64url');
      r = await request('POST', cfg.endpoints.token, { form: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig } });
    } else {
      r = await request('POST', cfg.endpoints.token, { form: { grant_type: 'refresh_token', client_id: cfg.owner.clientId, client_secret: cfg.owner.clientSecret, refresh_token: cfg.owner.refreshToken } });
    }
    if (!r.access_token) throw new Error('Google did not return an access token');
    this.token = r.access_token;
    this.until = Date.now() + Math.max(60, (Number(r.expires_in) || 3600) - 300) * 1000;
    return this.token;
  }
}

module.exports = { GoogleAccess, SCOPE };
