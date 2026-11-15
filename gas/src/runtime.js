/* HGI Billing — Google Apps Script runtime shims (bundled first into Code.js by tools/build-gas.mjs).
 *
 * The server's storage and account code (backend/lib/*.js) is written for Node. Here it runs unchanged except that the
 * build removes async/await (Apps Script cannot wait for promises inside doPost, and every Google call here is
 * synchronous anyway). This file supplies what those modules require(): Buffer, crypto, util, ./http.
 * crypto is built on Apps Script's Utilities (SHA-1/SHA-256 digests, HMAC-SHA256) and Utilities.getUuid() as the random
 * source (Java's SecureRandom-backed UUID v4: 122 random bits each, mixed through SHA-256).
 */
var __mods = {}, __cache = {};
function __define(name, fn) { __mods[name] = fn; }
function __require(name) {
  var key = name.replace(/^\.\.?\/(lib\/)?/, '').replace(/\.js$/, '');
  if (__cache[key]) return __cache[key].exports;
  if (!__mods[key]) throw new Error('module not bundled: ' + name);
  var module = { exports: {} };
  __cache[key] = module;
  __mods[key](module, module.exports, __require);
  return module.exports;
}

/* ---------------------------------------------------------------- bytes */
var __u8 = function (n) { return new Uint8Array(n); };
function __utf8Encode(s) {
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { var d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } else c = 0xfffd; }
    else if (c >= 0xd800 && c < 0xe000) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function __utf8Decode(b) {
  var s = '', i = 0;
  while (i < b.length) {
    var c = b[i++];
    if (c < 0x80) { s += String.fromCharCode(c); continue; }
    var n = c >= 0xf0 ? 3 : c >= 0xe0 ? 2 : c >= 0xc0 ? 1 : 0, cp = n === 3 ? c & 7 : n === 2 ? c & 15 : c & 31;
    if (!n) { s += '�'; continue; }
    for (var k = 0; k < n && i < b.length; k++) cp = (cp << 6) | (b[i++] & 63);
    if (cp >= 0x10000) { cp -= 0x10000; s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023)); } else s += String.fromCharCode(cp);
  }
  return s;
}
var __B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function __b64Encode(b, url) {
  var s = '', i;
  for (i = 0; i + 2 < b.length; i += 3) { var n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]; s += __B64[n >> 18] + __B64[(n >> 12) & 63] + __B64[(n >> 6) & 63] + __B64[n & 63]; }
  if (b.length - i === 1) { var m = b[i] << 16; s += __B64[m >> 18] + __B64[(m >> 12) & 63] + (url ? '' : '=='); }
  else if (b.length - i === 2) { var o = (b[i] << 16) | (b[i + 1] << 8); s += __B64[o >> 18] + __B64[(o >> 12) & 63] + __B64[(o >> 6) & 63] + (url ? '' : '='); }
  return url ? s.replace(/\+/g, '-').replace(/\//g, '_') : s;
}
function __b64Decode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  var out = [], buf = 0, bits = 0;
  for (var i = 0; i < s.length; i++) { buf = (buf << 6) | __B64.indexOf(s[i]); bits += 6; if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); } }
  return out;
}

/** a small Buffer: the parts of Node's Buffer the bundled modules use */
function Buffer(bytes) { this.b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []); this.length = this.b.length; }
Buffer.from = function (x, enc) {
  if (x instanceof Buffer) return new Buffer(x.b.slice());
  if (typeof x === 'string') {
    if (enc === 'base64' || enc === 'base64url') return new Buffer(__b64Decode(x));
    if (enc === 'hex') { var o = []; for (var i = 0; i + 1 < x.length; i += 2) o.push(parseInt(x.substr(i, 2), 16)); return new Buffer(o); }
    return new Buffer(__utf8Encode(x));
  }
  return new Buffer(Array.prototype.map.call(x, function (v) { return v & 255; }));
};
Buffer.byteLength = function (s) { return typeof s === 'string' ? __utf8Encode(s).length : s.length; };
Buffer.concat = function (list) { var a = []; list.forEach(function (x) { Array.prototype.push.apply(a, Array.from(x.b)); }); return new Buffer(a); };
Buffer.isBuffer = function (x) { return x instanceof Buffer; };
Buffer.prototype.toString = function (enc) {
  var b = this.b;
  if (enc === 'hex') { var s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
  if (enc === 'base64') return __b64Encode(b, false);
  if (enc === 'base64url') return __b64Encode(b, true);
  return __utf8Decode(b);
};
Buffer.prototype.slice = function (a, z) { return new Buffer(this.b.slice(a, z)); };
Buffer.prototype.equals = function (o) { if (o.length !== this.length) return false; for (var i = 0; i < this.length; i++) if (o.b[i] !== this.b[i]) return false; return true; };
Buffer.prototype.signed = function () { return Array.prototype.map.call(this.b, function (v) { return v > 127 ? v - 256 : v; }); };
var __toBuf = function (x) { return x instanceof Buffer ? x : Buffer.from(x); };
var __fromSigned = function (arr) { return new Buffer(arr.map(function (v) { return v & 255; })); };

/* ---------------------------------------------------------------- crypto (Utilities) */
var __rndCounter = 0;
var __crypto = {
  randomBytes: function (n) {
    var out = [];
    while (out.length < n) {
      var seed = Utilities.getUuid() + Utilities.getUuid() + ':' + Date.now() + ':' + (__rndCounter++);
      var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Buffer.from(seed).signed());
      for (var i = 0; i < d.length && out.length < n; i++) out.push(d[i] & 255);
    }
    return new Buffer(out);
  },
  createHash: function (alg) {
    var parts = [];
    var h = {
      update: function (x) { parts.push(__toBuf(x)); return h; },
      digest: function (enc) {
        var a = alg === 'sha1' ? Utilities.DigestAlgorithm.SHA_1 : alg === 'sha256' ? Utilities.DigestAlgorithm.SHA_256 : null;
        if (!a) throw new Error('hash not available: ' + alg);
        var out = __fromSigned(Utilities.computeDigest(a, Buffer.concat(parts).signed()));
        return enc ? out.toString(enc) : out;
      }
    };
    return h;
  },
  createHmac: function (alg, key) {
    if (alg !== 'sha256') throw new Error('hmac not available: ' + alg);
    var parts = [], k = __toBuf(key);
    var h = {
      update: function (x) { parts.push(__toBuf(x)); return h; },
      digest: function (enc) { var out = __fromSigned(Utilities.computeHmacSha256Signature(Buffer.concat(parts).signed(), k.signed())); return enc ? out.toString(enc) : out; }
    };
    return h;
  },
  /** PBKDF2-HMAC-SHA256 (RFC 8018), one Utilities HMAC call per iteration */
  pbkdf2Sync: function (password, salt, iterations, keylen, digest) {
    if (digest !== 'sha256') throw new Error('pbkdf2 digest not available: ' + digest);
    var P = __toBuf(password).signed(), S = Array.from(__toBuf(salt).b), out = [];
    for (var block = 1; out.length < keylen; block++) {
      var u = Utilities.computeHmacSha256Signature(S.concat([(block >>> 24) & 255, (block >>> 16) & 255, (block >>> 8) & 255, block & 255]).map(function (v) { return v > 127 ? v - 256 : v; }), P);
      var t = u.map(function (v) { return v & 255; });
      for (var i = 1; i < iterations; i++) {
        u = Utilities.computeHmacSha256Signature(u, P);
        for (var j = 0; j < 32; j++) t[j] ^= (u[j] & 255);
      }
      Array.prototype.push.apply(out, t);
    }
    return new Buffer(out.slice(0, keylen));
  },
  timingSafeEqual: function (a, b) {
    if (a.length !== b.length) throw new Error('Input buffers must have the same byte length');
    var d = 0; for (var i = 0; i < a.length; i++) d |= a.b[i] ^ b.b[i]; return d === 0;
  }
};
__define('crypto', function (module) { module.exports = __crypto; });
__define('util', function (module) { module.exports = { promisify: function () { return function () { throw new Error('not available on Apps Script'); }; } }; });
__define('http', function (module) {
  function UpstreamError(message, status, retryable, detail) { var e = new Error(message); e.name = 'UpstreamError'; e.status = status; e.retryable = retryable; e.detail = detail; Object.setPrototypeOf(e, UpstreamError.prototype); return e; }
  UpstreamError.prototype = Object.create(Error.prototype); UpstreamError.prototype.name = 'UpstreamError';
  module.exports = { UpstreamError: UpstreamError, request: function () { throw new Error('http.request is not used on Apps Script'); } };
});
