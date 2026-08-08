/* Structured API errors: { error, kind, detail? }. `kind` is a closed set and a
   frontend must treat an unknown or missing one as INTERNAL. `detail` carries
   server-derived values only, never an upstream body, header or filesystem path.
   Both contracts are specified in docs/api-errors.md. */

const { json } = require('./router');
const log = require('./log');

const KIND = Object.freeze({
  NETWORK:  'network',   /* could not reach the target at all */
  TIMEOUT:  'timeout',   /* reached or dialling, but ran out of time */
  BLOCKED:  'blocked',   /* our own outbound guard refused the target */
  AUTH:     'auth',      /* the caller's Stackyard session, not the upstream's */
  UPSTREAM: 'upstream',  /* we reached it and it answered with an error status */
  INVALID:  'invalid',   /* the request or its input was malformed */
  INTERNAL: 'internal',  /* anything we have not classified */
});

const KINDS = Object.freeze(Object.values(KIND));

/* Socket- and DNS-level failures. Node puts these on `err.code`. */
const NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN',
  'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'EPIPE', 'EPROTO', 'EADDRNOTAVAIL',
]);

/* Reported as `network`: the connection did not come up. The precise code goes
   in detail.code. */
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_NOT_YET_VALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT']);

/* For a route that knows more than classify() could infer. */
class ApiError extends Error {
  /* @param {string} message
     @param {{ kind?: string, status?: number, detail?: Record<string, unknown> }} [opts] */
  constructor(message, opts = {}) {
    const { kind = KIND.INTERNAL, status = 500, detail } = opts;
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    if (detail) this.detail = detail;
  }
}

/* An error whose message reaches the browser verbatim, for a sentence the widget
   author wrote such as "Set a Pi-hole password". Throwing it asserts the message
   holds nothing but words the author chose: never interpolate an upstream
   response, a URL, or an error from a fetch into one.

   Marked with a field rather than by instanceof, because a widget's data.js is
   require()d across a boundary where constructor identity is not reliable. */
class WidgetError extends Error {
  /* @param {string} message  shown to the user verbatim
     @param {{ kind?: string, detail?: Record<string, unknown> }} [opts] */
  constructor(message, opts = {}) {
    super(message);
    this.name = 'WidgetError';
    this.vouchedMessage = message;
    this.kind = opts.kind || KIND.UPSTREAM;
    if (opts.detail) this.detail = opts.detail;
  }
}

/* True however the error was constructed. */
const hasVouchedMessage = e =>
  !!e && typeof e === 'object' && typeof e.vouchedMessage === 'string' && e.vouchedMessage !== '';

/* Order matters: an explicit `kind` on the error wins, so a deeper module can
   override the inference. */
function classify(e) {
  if (e && typeof e.kind === 'string' && KINDS.includes(e.kind)) {
    return e.detail ? { kind: e.kind, detail: e.detail } : { kind: e.kind };
  }

  /* Matched by name: importing the class from proxy.js would point the
     dependency the wrong way. */
  if (e && e.name === 'SsrfBlockedError') return { kind: KIND.BLOCKED };

  const code = e && typeof e.code === 'string' ? e.code : null;
  if (code) {
    if (TIMEOUT_CODES.has(code)) return { kind: KIND.TIMEOUT, detail: { code } };
    if (NETWORK_CODES.has(code)) return { kind: KIND.NETWORK, detail: { code } };
    if (TLS_CODES.has(code))     return { kind: KIND.NETWORK, detail: { code } };
    if (code === 'ERR_INVALID_URL') return { kind: KIND.INVALID, detail: { code } };
  }

  /* The deadline is raised as a plain Error with no code. This message is ours,
     not an upstream's. */
  if (e instanceof Error && e.message === 'Timed out') return { kind: KIND.TIMEOUT };

  /* JSON.parse on a request body. */
  if (e instanceof SyntaxError) return { kind: KIND.INVALID };

  return { kind: KIND.INTERNAL };
}

/* Separate from sending, so a route with its own body shape can merge these in. */
/** @param {unknown} e
    @param {{ kind?: string, detail?: Record<string, unknown>, error?: string }} [overrides] */
/* Composed from the kind, never filtered from the original: an OS error message
   names internal addresses and paths, and filtering it is fail-open. The precise
   message is logged instead. */
const SAFE_MESSAGES = Object.freeze({
  [KIND.NETWORK]:  'Could not reach the service.',
  [KIND.TIMEOUT]:  'The service did not respond in time.',
  [KIND.BLOCKED]:  'The request was blocked.',
  [KIND.AUTH]:     'Unauthorised.',
  [KIND.UPSTREAM]: 'The service returned an error.',
  [KIND.INVALID]:  'The request was not valid.',
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
    /* Only a message the code vouched for. Anything else comes from the kind,
       never from e.message. */
    error: overrides.error != null ? overrides.error
         : hasVouchedMessage(e)    ? e.vouchedMessage
         : safeMessage(finalKind),
    kind:  finalKind,
  };
  const d = overrides.detail || detail;
  if (d && Object.keys(d).length) body.detail = d;
  return body;
}

/* `status` is the fallback; an error carrying its own keeps it. */
/** @param {import('http').ServerResponse} res
    @param {unknown} e
    @param {{ status?: number, kind?: string, detail?: Record<string, unknown>,
              error?: string, extra?: Record<string, unknown> }} [opts] */
function fail(res, e, opts = {}) {
  const { status = 502, kind, detail, error, extra } = opts;
  /* Anything can be thrown, so the shape is checked rather than assumed. */
  const thrown = /** @type {{ status?: unknown, message?: unknown }} */ (
    e && typeof e === 'object' ? e : {});
  const code = (typeof thrown.status === 'number' && thrown.status) || status;
  const body = errorBody(e, { kind, detail, error });

  /* The response does not carry the original message, so this is the only record
     of what failed. */
  if (typeof thrown.message === 'string' && thrown.message && thrown.message !== body.error) {
    log.error('request failed', { kind: body.kind, status: code, error: thrown.message });
  }

  json(res, code, Object.assign({}, extra, body));
}

module.exports = { KIND, KINDS, ApiError, WidgetError, hasVouchedMessage, classify, errorBody, safeMessage, SAFE_MESSAGES, fail };
