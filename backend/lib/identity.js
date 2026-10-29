'use strict';
/**
 * Identity:
 *  - verifyGoogleIdToken(): checks a "Sign in with Google" ID token (RS256 signature against Google's published keys,
 *    issuer, audience = our OAuth client ID, expiry, verified e-mail).
 *  - Sessions: after Google sign-in the app gets its own HMAC-signed session token (no Google token is stored).
 *    The Google account ID (sub) — never the e-mail, which can change — is the key for the user's data.
 */
const crypto = require('crypto');
const { request } = require('./http');

const b64uJson = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

class AuthError extends Error { constructor(msg, code = 'auth_failed', status = 401) { super(msg); this.code = code; this.status = status; } }

class GoogleVerifier {
  constructor(cfg) { this.cfg = cfg; this.keys = new Map(); this.expires = 0; this.loading = null; }
  async loadKeys(force) {
    if (!force && Date.now() < this.expires && this.keys.size) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const r = await request('GET', this.cfg.endpoints.certs, { raw: true, timeoutMs: 10000 });
      const jwks = JSON.parse(r.text);
      const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
      const keys = new Map();
      for (const k of jwks.keys || []) if (k.kty === 'RSA' && k.kid) keys.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' }));
      this.keys = keys; this.expires = Date.now() + Math.min(Number(m ? m[1] : 3600), 6 * 3600) * 1000;
    })().finally(() => { this.loading = null; });
    return this.loading;
  }
  async verify(idToken) {
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) throw new AuthError('Malformed Google ID token');
    let header, payload;
    try { header = b64uJson(parts[0]); payload = b64uJson(parts[1]); } catch (e) { throw new AuthError('Malformed Google ID token'); }
    if (header.alg !== 'RS256' || !header.kid) throw new AuthError('Unexpected token algorithm');
    await this.loadKeys(false);
    if (!this.keys.has(header.kid)) await this.loadKeys(true);           // Google rotated its keys
    const key = this.keys.get(header.kid);
    if (!key) throw new AuthError('Unknown token signing key');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new AuthError('Invalid token signature');
    const now = Math.floor(Date.now() / 1000);
    if (!ISSUERS.has(payload.iss)) throw new AuthError('Token not issued by Google');
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.some(a => this.cfg.googleClientIds.includes(a))) throw new AuthError('Token is for a different app');
    if (!(payload.exp > now - 60)) throw new AuthError('Google sign-in expired — please sign in again', 'token_expired');
    if (payload.iat && payload.iat > now + 300) throw new AuthError('Token issued in the future');
    if (!payload.sub) throw new AuthError('Token has no account ID');
    if (!payload.email || !(payload.email_verified === true || payload.email_verified === 'true')) throw new AuthError('Google account e-mail is not verified', 'email_unverified', 403);
    return { sub: String(payload.sub), email: String(payload.email).toLowerCase(), name: payload.name || '', picture: payload.picture || '' };
  }
}

// Stable, non-reversible ID for the user's data slot on the phone and in logs (the raw Google ID is not exposed).
const userKey = sub => crypto.createHash('sha256').update('hgi-user:' + sub).digest('hex').slice(0, 24);

class Sessions {
  constructor(cfg) { this.secret = Buffer.from(cfg.sessionSecret); this.days = cfg.sessionDays; }
  sign(obj) {
    const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
  }
  issue(user) {
    const now = Date.now();
    const exp = now + this.days * 86400e3;
    return { token: this.sign({ v: 1, sub: user.sub, email: user.email, name: user.name, iat: now, exp }), expiresAt: new Date(exp).toISOString() };
  }
  verify(header) {
    const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(header || '');
    if (!m) throw new AuthError('Not signed in', 'no_session');
    const expect = crypto.createHmac('sha256', this.secret).update(m[1]).digest();
    const got = Buffer.from(m[2], 'base64url');
    if (got.length !== expect.length || !crypto.timingSafeEqual(got, expect)) throw new AuthError('Session is not valid — please sign in again', 'bad_session');
    let s; try { s = b64uJson(m[1]); } catch (e) { throw new AuthError('Session is not valid', 'bad_session'); }
    if (s.v !== 1 || !s.sub || !(s.exp > Date.now())) throw new AuthError('Session expired — please sign in again', 'session_expired');
    return s;
  }
  // sliding renewal: a session used within its last 60 days is replaced by a fresh one
  maybeRenew(s) { return s.exp - Date.now() < 60 * 86400e3 ? this.issue(s) : null; }
}

module.exports = { GoogleVerifier, Sessions, AuthError, userKey };
