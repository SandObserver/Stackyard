/* Maps the API's structured error to what the admin UI should do about it. Keep
   it free of the DOM and of imports: its tests load it directly.

   The API's `code` is the whole input. `error` is prose the server wrote for a
   log; it is never translated and never shown. Advice therefore carries a
   translation key and its variables, never finished text. */

export const KIND = Object.freeze({
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  BLOCKED: 'blocked',
  AUTH: 'auth',
  UPSTREAM: 'upstream',
  INVALID: 'invalid',
  INTERNAL: 'internal',
});

export const TONE = Object.freeze({ WARN: 'warn', ERROR: 'error' });

const BY_CODE = Object.freeze({
  'blocked.private-address': 'adminError.privateAddress',
  'invalid.retype': 'adminError.retype',
  'upstream.redirect': 'adminError.redirect',
  'network.tls-ignored': 'adminError.tlsIgnored',
  'network.tls-untrusted': 'adminError.tlsUntrusted',
  'blocked.read-only': 'adminError.readOnly',
  'blocked.rate-limit': 'toast.tooManyAttempts',
  'invalid.too-large': 'toast.imageTooLarge',
  'invalid.file-type': 'adminError.fileType',
  'invalid.url': 'adminError.invalidUrl',
  'upstream.refused': 'adminError.socketRefused',
  'upstream.not-docker': 'adminError.notSocketProxy',
  'blocked.unresolved': 'adminError.unreachable',
  'invalid.duplicate-id': 'adminError.duplicateId',
  'invalid.missing-children': 'adminError.missingChildren',
  'invalid.unsafe-link': 'adminError.unsafeLink',
  'invalid.dock-full': 'app.dockFull',
  'network.refused': 'adminError.refused',
  'network.not-found': 'adminError.hostNotFound',
  'network.unreachable': 'adminError.hostUnreachable',
  'network.reset': 'adminError.connectionReset',
  'network.not-http': 'adminError.notHttp',
  'network.self-signed': 'adminError.selfSigned',
  'network.tls-expired': 'adminError.tlsExpired',
  'timeout.no-answer': 'adminError.timedOut',
  'blocked.demo': 'adminError.demoOutbound',
});

const BY_KIND = Object.freeze({
  [KIND.NETWORK]: 'adminError.unreachable',
  [KIND.TIMEOUT]: 'adminError.unreachable',
  [KIND.BLOCKED]: 'adminError.genericBlocked',
  [KIND.AUTH]: 'adminError.sessionExpired',
  [KIND.UPSTREAM]: 'adminError.genericUpstream',
  [KIND.INVALID]: 'adminError.genericInvalid',
  [KIND.INTERNAL]: 'adminError.genericInternal',
});

/* Each key is a whole sentence. Composing one from a fragment and a number puts
   word order in the code and breaks every language that does not share it. */
function statusKey(status) {
  if (status === 404) return 'adminError.statusNotFound';
  if (status === 405) return 'adminError.statusMethod';
  if (status === 407) return 'adminError.statusProxyAuth';
  if (status >= 500) return 'adminError.statusServer';
  return 'adminError.statusOther';
}

export function readError(e) {
  const kind = e && typeof e.kind === 'string' && Object.values(KIND).includes(e.kind) ? e.kind : KIND.INTERNAL;
  const detail = e && e.detail && typeof e.detail === 'object' ? e.detail : null;
  const code = e && typeof e.code === 'string' && e.code ? e.code : kind;
  return { kind, code, detail };
}

/* Placeholders only. A value is an id, a status or a limit, never a sentence. */
/** @param {Record<string, unknown> | null} detail @returns {Record<string, unknown> | null} */
function detailVars(detail) {
  if (!detail) return null;
  /** @type {Record<string, unknown>} */
  const vars = {};
  for (const [k, v] of Object.entries(detail)) {
    if (k === 'reason') continue;
    if (typeof v === 'number' || (typeof v === 'string' && v.length <= 200)) vars[k] = v;
  }
  return Object.keys(vars).length ? vars : null;
}

function adviceFor(read) {
  const { kind, code, detail } = read;
  const status = detail && typeof detail.status === 'number' ? detail.status : null;
  if (code === 'upstream.status' && status !== null) return { key: statusKey(status), vars: { status } };
  if (BY_CODE[code]) {
    const vars = detailVars(detail);
    return vars ? { key: BY_CODE[code], vars } : { key: BY_CODE[code] };
  }
  return { key: BY_KIND[kind] || BY_KIND[KIND.INTERNAL] };
}

/** What to show for a failed request to the API's own routes.
    @param {unknown} e @returns {{ key: string, vars?: Record<string, unknown> }} */
export function errorAdvice(e) {
  return adviceFor(readError(e));
}

/* The probe's hint already says why nothing answered and what to change. */
/** @param {unknown} probe @returns {{ key: string, vars?: Record<string, unknown> }} */
export function socketProbeAdvice(probe) {
  const read = readError(probe);
  return read.code === KIND.NETWORK ? { key: 'adminError.noConnection' } : adviceFor(read);
}

export function badgeErrorAdvice(e) {
  const read = readError(e);
  const { kind, code, detail } = read;
  const status = detail && typeof detail.status === 'number' ? detail.status : null;

  if (kind === KIND.AUTH) {
    return { tone: TONE.ERROR, code, key: 'adminError.sessionExpired', openAuth: false, sessionExpired: true };
  }

  if (kind === KIND.UPSTREAM && (status === 401 || status === 403)) {
    return { tone: TONE.WARN, code, key: 'adminError.authRequired', openAuth: true, sessionExpired: false };
  }

  const warn = kind === KIND.NETWORK || kind === KIND.TIMEOUT || code === 'blocked.private-address';
  return { ...adviceFor(read), code, tone: warn ? TONE.WARN : TONE.ERROR, openAuth: false, sessionExpired: false };
}

export function optionsErrorAdvice(e) {
  const { tone, key, vars, code } = badgeErrorAdvice(e);
  return vars ? { tone, code, key, vars } : { tone, code, key };
}

/** @param {unknown} e @returns {string} */
export function loginErrorKey(e) {
  const { kind, code } = readError(e);
  if (code === 'blocked.rate-limit') return 'toast.tooManyAttempts';
  if (kind === KIND.AUTH) return 'login.incorrect';
  return 'adminError.genericInternal';
}

/* A first-run password is refused as auth or as changed when another tab or
   device set one first. */
/** @param {unknown} e @returns {string} */
export function setupErrorKey(e) {
  const { kind, code } = readError(e);
  if (kind === KIND.AUTH || code === 'invalid.password-changed') return 'toast.passwordChangedElsewhere';
  return 'setup.failed';
}
