/* Structured API errors: { error, kind, detail? }. `kind` is a closed set.
   `detail` carries server-derived values only, never an upstream body, header or
   filesystem path. See docs/api-errors.md. */

const { json } = require('./router');
const log = require('./log');

const KIND = Object.freeze({
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  BLOCKED: 'blocked',
  AUTH: 'auth',
  UPSTREAM: 'upstream',
  INVALID: 'invalid',
  INTERNAL: 'internal',
});

const KINDS = Object.freeze(Object.values(KIND));

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'EPIPE',
  'EPROTO',
  'EADDRNOTAVAIL',
]);

const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_NOT_YET_VALID',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT']);

class ApiError extends Error {
  constructor(message, opts = {}) {
    const { kind = KIND.INTERNAL, status = 500, detail } = opts;
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    if (detail) this.detail = detail;
  }
}

/* The message reaches the browser verbatim. Never interpolate an upstream
   response, a URL or a fetch error into one. Detected by the vouchedMessage
   field, not by instanceof: a widget's data.js is required across a boundary
   where constructor identity is not reliable. */
class WidgetError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = 'WidgetError';
    this.vouchedMessage = message;
    this.kind = opts.kind || KIND.UPSTREAM;
    if (opts.detail) this.detail = opts.detail;
  }
}

const hasVouchedMessage = e =>
  !!e && typeof e === 'object' && typeof e.vouchedMessage === 'string' && e.vouchedMessage !== '';

function classify(e) {
  if (e && typeof e.kind === 'string' && KINDS.includes(e.kind)) {
    return e.detail ? { kind: e.kind, detail: e.detail } : { kind: e.kind };
  }

  /* Matched by name. Importing proxy.js here makes a require cycle. The detail
     is a reason code. It must never carry the address that was blocked. */
  if (e && e.name === 'SsrfBlockedError')
    return e.detail ? { kind: KIND.BLOCKED, detail: e.detail } : { kind: KIND.BLOCKED };

  const code = e && typeof e.code === 'string' ? e.code : null;
  if (code) {
    if (TIMEOUT_CODES.has(code)) return { kind: KIND.TIMEOUT, detail: { code } };
    if (NETWORK_CODES.has(code)) return { kind: KIND.NETWORK, detail: { code } };
    if (TLS_CODES.has(code)) return { kind: KIND.NETWORK, detail: { code } };
    if (code === 'ERR_INVALID_URL') return { kind: KIND.INVALID, detail: { code } };
  }

  if (e instanceof Error && e.message === 'Timed out') return { kind: KIND.TIMEOUT };

  if (e instanceof SyntaxError) return { kind: KIND.INVALID };

  return { kind: KIND.INTERNAL };
}

/* Compose the message from the kind. Never filter the original: an OS error
   message names internal addresses and paths, and filtering it is fail-open. */
const SAFE_MESSAGES = Object.freeze({
  [KIND.NETWORK]: 'Could not reach the service.',
  [KIND.TIMEOUT]: 'The service did not respond in time.',
  [KIND.BLOCKED]: 'The request was blocked.',
  [KIND.AUTH]: 'Unauthorised.',
  [KIND.UPSTREAM]: 'The service returned an error.',
  [KIND.INVALID]: 'The request was not valid.',
  [KIND.INTERNAL]: 'Something went wrong.',
});

/** @param {string} kind @returns {string} */
function safeMessage(kind) {
  return SAFE_MESSAGES[kind] || SAFE_MESSAGES[KIND.INTERNAL];
}

function errorBody(e, overrides = {}) {
  const { kind, detail } = classify(e);
  const finalKind = overrides.kind || kind;
  const body = {
    /* Only a message the code vouched for. Never e.message. */
    error: overrides.error != null ? overrides.error : hasVouchedMessage(e) ? e.vouchedMessage : safeMessage(finalKind),
    kind: finalKind,
  };
  const d = overrides.detail || detail;
  if (d && Object.keys(d).length) body.detail = d;
  return body;
}

/** @param {import('http').ServerResponse} res
    @param {unknown} e
    @param {{ status?: number, kind?: string, detail?: Record<string, unknown>,
              error?: string, extra?: Record<string, unknown> }} [opts] */
function fail(res, e, opts = {}) {
  const { status = 502, kind, detail, error, extra } = opts;
  const thrown = /** @type {{ status?: unknown, message?: unknown }} */ (e && typeof e === 'object' ? e : {});
  const code = (typeof thrown.status === 'number' && thrown.status) || status;
  const body = errorBody(e, { kind, detail, error });

  if (typeof thrown.message === 'string' && thrown.message && thrown.message !== body.error) {
    log.error('request failed', { kind: body.kind, status: code, error: thrown.message });
  }

  json(res, code, Object.assign({}, extra, body));
}

module.exports = {
  KIND,
  KINDS,
  ApiError,
  WidgetError,
  hasVouchedMessage,
  classify,
  errorBody,
  safeMessage,
  SAFE_MESSAGES,
  fail,
};
