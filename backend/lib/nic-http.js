'use strict';
/** Minimal outbound JSON HTTP client (Node 18+ fetch) with timeout and safe error reporting. */

class ApiError extends Error {
  /**
   * @param {string} message human readable message
   * @param {object} opts { status, code, errors:[{code,message}], info, retryable }
   */
  constructor(message, opts = {}) {
    super(message);
    this.status = opts.status || 502;
    this.code = opts.code || 'PROVIDER_ERROR';
    this.errors = opts.errors || [];
    this.info = opts.info;
    this.retryable = !!opts.retryable;
  }
}

async function requestJson(method, url, { headers = {}, body, timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res, text;
  try {
    res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    text = await res.text();
  } catch (e) {
    const timeout = e.name === 'AbortError';
    throw new ApiError(timeout ? 'GST system (IRP / e-way bill) did not respond in time' : `Cannot reach the GST system (IRP / e-way bill) (${e.cause?.code || e.message})`,
      { status: 504, code: timeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE', retryable: true });
  } finally { clearTimeout(t); }
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch {
    throw new ApiError(`The GST system (IRP / e-way bill) returned an unreadable answer (HTTP ${res.status})`, { status: 502, code: 'PROVIDER_BAD_RESPONSE', retryable: res.status >= 500 });
  }
  return { httpStatus: res.status, json };
}

module.exports = { ApiError, requestJson };
