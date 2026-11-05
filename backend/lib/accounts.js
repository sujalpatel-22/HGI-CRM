'use strict';
/**
 * User accounts: sign-up, log-in, log-out, password change, account deletion — stored in the "Users" and "Sessions" tabs.
 *
 * Passwords: never stored. The "passwordHash" column holds  scrypt$1$N=32768,r=8,p=1$<salt>$<hash>  where the scrypt input
 *   is HMAC-SHA256(PASSWORD_PEPPER, password). scrypt is Node's built-in implementation (OpenSSL) — a memory-hard function
 *   recommended by OWASP for password storage — with a 16-byte random salt per user. The pepper is a server secret (Secret
 *   Manager): somebody who can read or edit the spreadsheet can neither test guesses offline nor plant a hash of their own.
 * Sessions: a random 256-bit token given to the app; the "Sessions" tab stores only HMAC-SHA256(SESSION_SECRET, token), with
 *   the expiry and revocation time. Log-out revokes it on the server; a password change revokes the account's other
 *   sessions; a deleted or disabled account's sessions stop working at once.
 * Abuse: failed log-ins are counted per account (10 in a row → locked for 15 minutes) and per user name in memory (also for
 *   names that do not exist, which get the same answer and take the same time), on top of per-IP limits in server.js.
 */
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const LOCK_AFTER = 10, LOCK_MS = 15 * 60e3;
const USERNAME = /^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$/;
const COMMON = new Set(('password password1 password123 12345678 123456789 1234567890 11111111 00000000 87654321 qwertyui qwerty123 qwertyuiop ' +
  'iloveyou admin123 admin@123 welcome1 welcome123 abc12345 abcd1234 1q2w3e4r 1qaz2wsx zaq12wsx letmein1 sunshine princess dragon123 ' +
  'football baseball monkey123 shadow12 master12 superman batman123 trustno1 passw0rd p@ssw0rd p@ssword india123 india@123 bharat123 ' +
  'hariguru hgibilling billing123 invoice123 gst12345 changeme changeme1 asdfghjk asdf1234 zxcvbnm1 computer internet').split(' '));

class AuthError extends Error { constructor(msg, code = 'auth_failed', status = 401) { super(msg); this.code = code; this.status = status; } }
const bad = (msg, code = 'invalid_input') => new AuthError(msg, code, 400);

class Accounts {
  /** @param {import('./sheet-db').SheetDB} db */
  constructor(db, cfg, log = () => {}) {
    if (!cfg.passwordPepper || Buffer.byteLength(cfg.passwordPepper) < 32) throw new Error('PASSWORD_PEPPER must be at least 32 characters');
    if (!cfg.sessionSecret || Buffer.byteLength(cfg.sessionSecret) < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
    this.db = db; this.log = log;
    this.pepper = Buffer.from(cfg.passwordPepper); this.secret = Buffer.from(cfg.sessionSecret);
    this.days = cfg.sessionDays || 30;
    this.scrypt = cfg.scryptParams || SCRYPT;
    this.tries = new Map();                       // usernameKey → {n, until}
    this.dummy = null;
    this.hashing = 0;
  }

  /* ------------------------------------------------------------ input rules */
  static usernameKey(u) { return String(u || '').trim().toLowerCase(); }
  checkUsername(u) {
    const name = String(u == null ? '' : u).trim();
    const key = name.toLowerCase();
    if (!USERNAME.test(key)) throw bad('Username: 3–30 characters — letters, digits, dot, underscore or hyphen; start and end with a letter or digit.', 'bad_username');
    if (/[._-]{2}/.test(key)) throw bad('Username: no two dots, underscores or hyphens in a row.', 'bad_username');
    return { username: name, key };
  }
  checkPassword(pw, usernameKey) {
    if (typeof pw !== 'string') throw bad('Enter a password.', 'bad_password');
    if (pw.length < 8) throw bad('Password: at least 8 characters.', 'weak_password');
    if (Buffer.byteLength(pw) > 256) throw bad('Password: at most 256 characters.', 'bad_password');
    const low = pw.toLowerCase();
    if (new Set(pw).size < 4) throw bad('Password is too simple — use at least 4 different characters.', 'weak_password');
    if (COMMON.has(low)) throw bad('That password is too common. Choose another one.', 'weak_password');
    if (usernameKey && usernameKey.length >= 3 && low.includes(usernameKey)) throw bad('The password must not contain the username.', 'weak_password');
  }

  /* ------------------------------------------------------------ hashing */
  async hash(pw) {
    const salt = crypto.randomBytes(16);
    const { N, r, p, maxmem } = this.scrypt;
    const key = await this.derive(pw, salt, { N, r, p, maxmem });
    return `scrypt$1$N=${N},r=${r},p=${p}$${salt.toString('base64')}$${key.toString('base64')}`;
  }
  async derive(pw, salt, o) {
    const input = crypto.createHmac('sha256', this.pepper).update(String(pw).normalize('NFC')).digest();
    this.hashing++;
    try { return await scrypt(input, salt, 64, o); } finally { this.hashing--; }
  }
  async verifyHash(pw, stored) {
    const m = /^scrypt\$1\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(String(stored || ''));
    if (!m) return { ok: false };
    const [N, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (N > 1 << 20 || r > 32 || p > 16) return { ok: false };
    const want = Buffer.from(m[5], 'base64');
    const got = await this.derive(pw, Buffer.from(m[4], 'base64'), { N, r, p, maxmem: Math.max(this.scrypt.maxmem, 256 * N * r) });
    const ok = got.length === want.length && crypto.timingSafeEqual(got, want);
    return { ok, outdated: ok && (N !== this.scrypt.N || r !== this.scrypt.r || p !== this.scrypt.p) };
  }
  async dummyHash() { if (!this.dummy) this.dummy = await this.hash(crypto.randomBytes(16).toString('hex')); return this.dummy; }

  /* ------------------------------------------------------------ sessions */
  sid(token) { return crypto.createHmac('sha256', this.secret).update(String(token)).digest('hex'); }
  newSession(w, userId, device) {
    const token = 'hgi1.' + crypto.randomBytes(32).toString('base64url');
    const now = Date.now(), expiresAt = new Date(now + this.days * 86400e3).toISOString();
    w.put('Sessions', { sessionId: this.sid(token), userId, createdAt: new Date(now).toISOString(), expiresAt, device: cleanDevice(device) });
    // tidy: the account's sessions that ended more than 30 days ago
    for (const s of this.db.t('Sessions').where('userId', userId)) {
      const end = Date.parse(s.revokedAt || s.expiresAt || 0) || 0;
      if (end && end < now - 30 * 86400e3) w.remove('Sessions', { sessionId: s.sessionId });
    }
    return { token, expiresAt };
  }
  /** Bearer header → { user, session }; throws AuthError */
  async authenticate(header) {
    const m = /^Bearer\s+(hgi1\.[A-Za-z0-9_-]{43})$/.exec(header || '');
    if (!m) throw new AuthError('Not signed in', 'no_session');
    await this.db.fresh();
    const sid = this.sid(m[1]);
    let s = this.db.t('Sessions').get({ sessionId: sid });
    if (!s && await this.db.reloadForMiss()) s = this.db.t('Sessions').get({ sessionId: sid });
    if (!s) throw new AuthError('Session is not valid — please log in again', 'bad_session');
    if (s.revokedAt) throw new AuthError('You were logged out — please log in again', 'session_revoked');
    if (!(Date.parse(s.expiresAt) > Date.now())) throw new AuthError('Session expired — please log in again', 'session_expired');
    const u = this.db.t('Users').get({ userId: s.userId });
    if (!u) throw new AuthError('Session is not valid — please log in again', 'bad_session');
    if (u.status === 'deleted') throw new AuthError('This account was deleted.', 'account_deleted');
    if (u.status !== 'active') throw new AuthError('This account is disabled. Contact support.', 'account_disabled', 403);
    // sliding expiry: renewed (one write) when less than half of its life is left
    if (Date.parse(s.expiresAt) - Date.now() < this.days * 86400e3 / 2) {
      try {
        await this.db.tx(async w => { const cur = w.get('Sessions', { sessionId: sid }); if (cur && !cur.revokedAt) w.put('Sessions', { ...cur, expiresAt: new Date(Date.now() + this.days * 86400e3).toISOString(), renewedAt: new Date().toISOString() }); });
      } catch (e) { this.log({ warn: true, event: 'session_renew_failed', error: e.message }); }
    }
    return { user: publicUser(u), sessionId: sid };
  }

  /* ------------------------------------------------------------ sign-up / log-in / log-out */
  async signup({ username, password, device }) {
    const { username: name, key } = this.checkUsername(username);
    this.checkPassword(password, key);
    const passwordHash = await this.hash(password);          // slow part outside the write queue
    const userId = crypto.randomBytes(12).toString('hex');
    return this.db.tx(async w => {
      if (this.db.t('Users').where('usernameKey', key).length) throw new AuthError('That username is taken. Choose another one.', 'username_taken', 409);
      const now = new Date().toISOString();
      w.put('Users', { userId, username: name, usernameKey: key, passwordHash, status: 'active', createdAt: now, updatedAt: now, lastLoginAt: now, failedLogins: 0, passwordChangedAt: now, seq: 0 });
      const s = this.newSession(w, userId, device);
      this.log({ event: 'signup', user: userId });
      return { session: s.token, expiresAt: s.expiresAt, user: { key: userId, username: name, createdAt: now } };
    });
  }

  throttled(key) { const t = this.tries.get(key); return t && t.n >= LOCK_AFTER && t.until > Date.now() ? t : null; }
  noteFailure(key) {
    const t = this.tries.get(key) || { n: 0, until: 0 };
    if (t.until < Date.now()) { t.n = 0; }
    t.n++; t.until = Date.now() + LOCK_MS; this.tries.set(key, t);
    if (this.tries.size > 50000) for (const [k, v] of this.tries) if (v.until < Date.now()) this.tries.delete(k);
  }
  async login({ username, password, device }) {
    const key = Accounts.usernameKey(username);
    if (!key || typeof password !== 'string' || !password || Buffer.byteLength(password) > 256 || key.length > 60) throw new AuthError('Enter your username and password.', 'invalid_input', 400);
    if (this.throttled(key)) throw new AuthError('Too many wrong attempts. Wait 15 minutes, then try again.', 'locked', 429);
    await this.db.fresh();
    let u = this.db.t('Users').where('usernameKey', key).find(x => x.status !== 'deleted');
    if (!u && await this.db.reloadForMiss()) u = this.db.t('Users').where('usernameKey', key).find(x => x.status !== 'deleted');
    if (u && Date.parse(u.lockedUntil || 0) > Date.now()) throw new AuthError('Too many wrong attempts. Wait 15 minutes, then try again.', 'locked', 429);
    const v = await this.verifyHash(password, u ? u.passwordHash : await this.dummyHash());
    if (!u || !v.ok) {
      this.noteFailure(key);
      if (u) {
        await this.db.tx(async w => {
          const cur = w.get('Users', { userId: u.userId }); if (!cur) return;
          const n = (Number(cur.failedLogins) || 0) + 1;
          w.put('Users', { ...cur, failedLogins: n, lockedUntil: n >= LOCK_AFTER ? new Date(Date.now() + LOCK_MS).toISOString() : cur.lockedUntil, updatedAt: new Date().toISOString() });
        }).catch(e => this.log({ warn: true, event: 'failed_login_not_recorded', error: e.message }));
        this.log({ event: 'login_failed', user: u.userId });
      }
      throw new AuthError('Username or password is incorrect.', 'bad_credentials', 401);
    }
    if (u.status !== 'active') throw new AuthError('This account is disabled. Contact support.', 'account_disabled', 403);
    this.tries.delete(key);
    const passwordHash = v.outdated ? await this.hash(password) : u.passwordHash;
    return this.db.tx(async w => {
      const cur = w.get('Users', { userId: u.userId });
      if (!cur || cur.status !== 'active') throw new AuthError('This account is disabled. Contact support.', 'account_disabled', 403);
      const now = new Date().toISOString();
      w.put('Users', { ...cur, passwordHash, failedLogins: 0, lockedUntil: undefined, lastLoginAt: now, updatedAt: now });
      const s = this.newSession(w, cur.userId, device);
      this.log({ event: 'login', user: cur.userId });
      return { session: s.token, expiresAt: s.expiresAt, user: { key: cur.userId, username: cur.username, createdAt: cur.createdAt } };
    });
  }
  async logout(sessionId) {
    await this.db.tx(async w => { const s = w.get('Sessions', { sessionId }); if (s && !s.revokedAt) w.put('Sessions', { ...s, revokedAt: new Date().toISOString() }); });
  }
  /** ends every session of the account except `keep` */
  revokeAll(w, userId, keep) {
    const now = new Date().toISOString();
    let n = 0;
    for (const s of this.db.t('Sessions').where('userId', userId)) if (s.sessionId !== keep && !s.revokedAt) { w.put('Sessions', { ...s, revokedAt: now }); n++; }
    return n;
  }
  async logoutAll(userId, keep) { return this.db.tx(async w => this.revokeAll(w, userId, keep)); }

  async checkPasswordOf(userId, password) {
    const u = this.db.t('Users').get({ userId });
    if (!u) throw new AuthError('This account no longer exists.', 'account_deleted');
    const key = u.usernameKey;
    if (this.throttled(key)) throw new AuthError('Too many wrong attempts. Wait 15 minutes, then try again.', 'locked', 429);
    const v = await this.verifyHash(String(password || ''), u.passwordHash);
    if (!v.ok) { this.noteFailure(key); throw new AuthError('The current password is incorrect.', 'bad_credentials', 403); }
    return u;
  }
  async changePassword(userId, sessionId, current, next) {
    const u = await this.checkPasswordOf(userId, current);
    this.checkPassword(next, u.usernameKey);
    if (current === next) throw bad('The new password must be different.', 'same_password');
    const passwordHash = await this.hash(next);
    return this.db.tx(async w => {
      const cur = w.get('Users', { userId });
      const now = new Date().toISOString();
      w.put('Users', { ...cur, passwordHash, passwordChangedAt: now, updatedAt: now, failedLogins: 0, lockedUntil: undefined });
      const ended = this.revokeAll(w, userId, sessionId);
      this.log({ event: 'password_changed', user: userId, sessionsEnded: ended });
      return { ok: true, otherSessionsEnded: ended };
    });
  }
  /** marks the account deleted (its user name becomes free again) and ends all its sessions; business rows: deleteRows(w) */
  async deleteAccount(userId, deleteRows) {
    return this.db.tx(async w => {
      const cur = w.get('Users', { userId });
      if (!cur || cur.status === 'deleted') return { records: 0, deletedAt: cur ? cur.deletedAt : null };
      const now = new Date().toISOString();
      const records = deleteRows ? await deleteRows(w) : 0;
      this.revokeAll(w, userId, null);
      w.put('Users', { userId, username: cur.username, usernameKey: `deleted:${userId}`, status: 'deleted', createdAt: cur.createdAt, updatedAt: now, deletedAt: now, seq: cur.seq });
      this.log({ event: 'account_deleted', user: userId, records });
      return { records, deletedAt: now };
    });
  }
  async findForDeletion(username, password) {
    const key = Accounts.usernameKey(username);
    if (!key || this.throttled(key)) throw new AuthError('Too many wrong attempts. Wait 15 minutes, then try again.', 'locked', 429);
    await this.db.fresh();
    const u = this.db.t('Users').where('usernameKey', key).find(x => x.status !== 'deleted');
    const v = await this.verifyHash(String(password || ''), u ? u.passwordHash : await this.dummyHash());
    if (!u || !v.ok) { this.noteFailure(key); throw new AuthError('Username or password is incorrect.', 'bad_credentials', 401); }
    return u;
  }
}
const cleanDevice = d => String(d || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 80);
const publicUser = u => ({ key: u.userId, username: u.username, createdAt: u.createdAt, status: u.status });

module.exports = { Accounts, AuthError, SCRYPT, LOCK_AFTER };
