/* Structured API errors.

   Every JSON error body the API sends may carry a `kind` alongside the existing
   human-readable `error` string, and optionally a small `detail` object:

     { error: "connect ECONNREFUSED 172.17.0.2:8181",
       kind:  "network",
       detail: { code: "ECONNREFUSED" } }

   Why: the admin UI used to decide what a failure meant by substring-matching
   the `error` text (`msg.includes('401')`, `ECONNREFUSED`, ...). That is fragile,
   it breaks silently, and it blocks sanitising `error` later, because the text is
   the only signal the frontend has. `kind` is that signal, as data.

   `kind` is a closed set. Adding one is a deliberate contract change; see
   docs/api-errors.md. Callers must treat an unrecognised or missing kind as
   INTERNAL, so an older frontend keeps working against a newer API.

   `detail` rules, deliberately strict so it does not become a junk drawer:
     1. Allowed keys are declared per kind in docs/api-errors.md. Nothing else.
     2. Values are server-derived only: a status code we read, an errno Node gave
        us, a URL we built. Never an upstream response body, an upstream header,
        or a filesystem path. This is what keeps `detail` safe once
        fix/error-message-sanitisation makes `error` generic.
     3. Omit the field entirely rather than sending {}. */

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

/* TLS handshake failures. Reported as `network`: from the user's point of view
   the connection did not come up. The precise code goes in detail.code. */
const TLS_CODES = new Set([
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_NOT_YET_VALID', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT']);

/* An error carrying its own classification. Throw this from a route when the
   route knows more than classify() could infer. */
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

/* An error whose message is meant for the person reading the widget.

   The default is that a thrown message never reaches the browser: errorBody
   substitutes safeMessage(kind), because an arbitrary message may carry a
   hostname, a path or an upstream body. That is right for anything inferred
   from a caught exception and wrong for a sentence the widget author wrote,
   such as "Set a Pi-hole password" or "TrueNAS auth failed, check API key".
   Those are the messages that tell someone how to fix their configuration, and
   losing them to "Something went wrong." is a worse failure than the leak the
   rule exists to prevent.

   So this is the opt-in: throwing it says the message contains nothing but
   words the author chose. Never build one by interpolating an upstream
   response, a URL or an error from a fetch. Interpolating a status code is
   fine, since that is a number the server read.

   Marked with a field rather than by instanceof: a widget's data.js is loaded
   with require() from the widgets directory, and comparing constructors across
   that boundary is the kind of thing that works until someone changes how the
   module is loaded. */
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

/* True for anything carrying a message its author vouched for, however it was
   constructed. */
const hasVouchedMessage = e =>
  !!e && typeof e === 'object' && typeof e.vouchedMessage === 'string' && e.vouchedMessage !== '';

/* Best-effort classification of an arbitrary thrown value.

   Order matters: an explicit `kind` on the error always wins, so a route or a
   deeper module can override the inference without this function having to know
   about it. */
function classify(e) {
  if (e && typeof e.kind === 'string' && KINDS.includes(e.kind)) {
    return e.detail ? { kind: e.kind, detail: e.detail } : { kind: e.kind };
  }

  /* SsrfBlockedError, thrown by the outbound guard in proxy.js. Matched by name
     rather than instanceof: proxy.js keeps the class private, and importing it
     here would make the dependency run the wrong way. */
  if (e && e.name === 'SsrfBlockedError') return { kind: KIND.BLOCKED };

  const code = e && typeof e.code === 'string' ? e.code : null;
  if (code) {
    if (TIMEOUT_CODES.has(code)) return { kind: KIND.TIMEOUT, detail: { code } };
    if (NETWORK_CODES.has(code)) return { kind: KIND.NETWORK, detail: { code } };
    if (TLS_CODES.has(code))     return { kind: KIND.NETWORK, detail: { code } };
    if (code === 'ERR_INVALID_URL') return { kind: KIND.INVALID, detail: { code } };
  }

  /* fetchJSON and pingUrl raise their deadline as a plain Error, so there is no
     code to read. The message is ours, not an upstream's, so matching it here is
     not the substring-matching this whole change exists to remove. */
  if (e instanceof Error && e.message === 'Timed out') return { kind: KIND.TIMEOUT };

  /* JSON.parse on a request body. */
  if (e instanceof SyntaxError) return { kind: KIND.INVALID };

  return { kind: KIND.INTERNAL };
}

/* Build the response body. Kept separate from sending it so routes that already
   have a shaped body (`{ ok:false, ... }`) can merge the fields in. */
/* @param {any} e
   @param {{ kind?: string, detail?: Record<string, unknown>, error?: string }} [overrides] */
/* What the browser is told, chosen by kind rather than taken from the error.

   The message an operating system produces names the thing that failed:

     connect ECONNREFUSED 172.17.0.2:8181
     getaddrinfo ENOTFOUND nas.internal.lan
     ENOENT: no such file or directory, open '/data/apps.json'

   Internal addresses, hostnames and server paths, sent to a browser and rendered
   on screen. These routes need a session, so the audience is normally the
   operator, but a screenshot in a support thread or an extension reading the
   page is enough to carry it further.

   Built from the kind rather than filtered from the original. Removing patterns
   from a message is fail-open: whatever the filter does not recognise gets
   through, and a hostname in an unexpected position is exactly what it would
   miss. Composing a message means nothing from the original is present unless it
   was deliberately put there.

   The precise message is not lost, it moves: every caller logs it. That is where
   an operator should be looking for it, and it is not rendered in a browser.

   `detail` is unaffected. It carries only server-derived values, a status code
   or an errno, never anything that identifies a host; see the rules in
   docs/api-errors.md. */
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
    /* An explicit override is a message the code chose and can vouch for, such
       as "Set a password before turning authentication on." A WidgetError
       carries the same guarantee from further away, written by whoever wrote
       the widget. Anything else comes from the kind, never from e.message. */
    error: overrides.error != null ? overrides.error
         : hasVouchedMessage(e)    ? e.vouchedMessage
         : safeMessage(finalKind),
    kind:  finalKind,
  };
  const d = overrides.detail || detail;
  if (d && Object.keys(d).length) body.detail = d;
  return body;
}

/* Send a classified error. `status` is the fallback; an error carrying its own
   `status` (SsrfBlockedError's 403) keeps it, which preserves the behaviour of
   the `json(res, e.status || 502, ...)` idiom this replaces. */
/* @param {import('http').ServerResponse} res
   @param {any} e
   @param {{ status?: number, kind?: string, detail?: Record<string, unknown>,
             error?: string, extra?: Record<string, unknown> }} [opts] */
function fail(res, e, opts = {}) {
  const { status = 502, kind, detail, error, extra } = opts;
  const code = (e && e.status) || status;
  const body = errorBody(e, { kind, detail, error });

  /* Logged here rather than at each call site. The response no longer carries
     the original message, so this is the only remaining record of what actually
     failed, and leaving it to every caller to remember would guarantee some of
     them did not. */
  if (e && e.message && e.message !== body.error) {
    log.error('request failed', { kind: body.kind, status: code, error: e.message });
  }

  json(res, code, Object.assign({}, extra, body));
}

module.exports = { KIND, KINDS, ApiError, WidgetError, hasVouchedMessage, classify, errorBody, safeMessage, SAFE_MESSAGES, fail };
