'use strict';
/**
 * Cryptography used by the NIC e-Invoice (IRP) and e-Way Bill APIs:
 *  - Login payload / password / app key: RSA with the NIC public key (PKCS#1 v1.5 padding).
 *  - Session key (SEK): returned AES-256-ECB encrypted with our random 32-byte AppKey.
 *  - Every request & response payload: AES-256-ECB / PKCS7 with the decrypted SEK.
 *  - e-Way Bill GET responses: data encrypted with a per-response key (rek) that is itself
 *    encrypted with the SEK, plus an HMAC-SHA256 integrity check.
 */
const crypto = require('crypto');
const fs = require('fs');

/** key: PEM / base64 / DER text or Buffer, or a path to such a file (NIC portals hand out .pem / .cer / base64 text) */
function loadPublicKey(key) {
  const raw = Buffer.isBuffer(key) ? key : (/-----BEGIN|^[A-Za-z0-9+/=\s]{200,}$/.test(String(key)) ? Buffer.from(String(key)) : fs.readFileSync(key));
  const text = raw.toString('utf8').trim();
  // 1) PEM public key or PEM certificate
  if (text.includes('-----BEGIN')) {
    if (text.includes('CERTIFICATE')) return new crypto.X509Certificate(raw).publicKey;
    return crypto.createPublicKey(text);
  }
  // 2) Base64 text without PEM armour (NIC portals often hand out keys like this)
  if (/^[A-Za-z0-9+/=\s]+$/.test(text)) {
    const der = Buffer.from(text.replace(/\s+/g, ''), 'base64');
    try { return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }); } catch { /* try cert */ }
    return new crypto.X509Certificate(der).publicKey;
  }
  // 3) Binary DER certificate (.cer)
  try { return new crypto.X509Certificate(raw).publicKey; } catch { /* fallthrough */ }
  return crypto.createPublicKey({ key: raw, format: 'der', type: 'spki' });
}

const rsaEncrypt = (publicKey, buf) =>
  crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString('base64');

function aesEncrypt(key, plain) {
  const c = crypto.createCipheriv('aes-256-ecb', key, null);
  return Buffer.concat([c.update(Buffer.isBuffer(plain) ? plain : Buffer.from(plain)), c.final()]).toString('base64');
}
function aesDecrypt(key, b64) {
  const d = crypto.createDecipheriv('aes-256-ecb', key, null);
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]);
}

/** Decrypted payloads arrive either as JSON or as base64-encoded JSON depending on the API — accept both. */
function parsePayload(buf) {
  const text = buf.toString('utf8').trim();
  try { return JSON.parse(text); } catch { /* maybe base64 */ }
  if (/^[A-Za-z0-9+/=]+$/.test(text)) {
    const inner = Buffer.from(text, 'base64').toString('utf8');
    try { return JSON.parse(inner); } catch { /* not json */ }
  }
  throw new Error('Decrypted response is not JSON');
}

function hmacOk(key, dataBuf, expectedB64) {
  if (!expectedB64) return true;
  const mac = crypto.createHmac('sha256', key).update(dataBuf).digest();
  const exp = Buffer.from(expectedB64, 'base64');
  return exp.length === mac.length && crypto.timingSafeEqual(exp, mac);
}

module.exports = { loadPublicKey, rsaEncrypt, aesEncrypt, aesDecrypt, parsePayload, hmacOk };
