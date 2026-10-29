'use strict';
/** Outbound HTTP to Google with timeout, bounded retries on 429/5xx, and errors that never contain tokens. */

class UpstreamError extends Error {
  constructor(message, status, retryable, detail) { super(message); this.status = status; this.retryable = retryable; this.detail = detail; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(method, url, { headers = {}, body, form, timeoutMs = 30000, retries = 3, raw = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(Math.min(8000, 400 * 2 ** attempt) + Math.floor(Math.random() * 250));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const h = { Accept: 'application/json', ...headers };
      let payload;
      if (form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString(); }
      else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      const res = await fetch(url, { method, headers: h, body: payload, signal: ctrl.signal });
      const text = await res.text();
      if (res.ok) {
        if (raw) return { status: res.status, text, headers: res.headers };
        return text ? JSON.parse(text) : {};
      }
      let msg = `HTTP ${res.status}`;
      try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error_description || j.error)) || msg; } catch (e) { /* not JSON */ }
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new UpstreamError(`Google API: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, res.status, retryable);
      if (!retryable) throw lastErr;
    } catch (e) {
      if (e instanceof UpstreamError && !e.retryable) throw e;
      lastErr = e instanceof UpstreamError ? e : new UpstreamError(e.name === 'AbortError' ? 'Google API timed out' : `Google API unreachable (${(e.cause && e.cause.code) || e.message})`, 504, true);
    } finally { clearTimeout(timer); }
  }
  throw lastErr;
}

module.exports = { request, UpstreamError };
