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

function adviceFor(read) {
  const { kind, code, detail } = read;
  const status = detail && typeof detail.status === 'number' ? detail.status : null;
  if (code === 'upstream.status' && status !== null) return { key: statusKey(status), vars: { status } };
  if (BY_CODE[code]) {
    return status !== null ? { key: BY_CODE[code], vars: { status } } : { key: BY_CODE[code] };
  }
  return { key: BY_KIND[kind] || BY_KIND[KIND.INTERNAL] };
}

export function badgeErrorAdvice(e) {
  const read = readError(e);
  const { kind, code, detail } = read;
  const status = detail && typeof detail.status === 'number' ? detail.status : null;

  if (kind === KIND.AUTH) {
    return { tone: TONE.ERROR, key: 'adminError.sessionExpired', openAuth: false, sessionExpired: true };
  }

  if (kind === KIND.UPSTREAM && (status === 401 || status === 403)) {
    return { tone: TONE.WARN, key: 'adminError.authRequired', openAuth: true, sessionExpired: false };
  }

  const warn = kind === KIND.NETWORK || kind === KIND.TIMEOUT || code === 'blocked.private-address';
  return { ...adviceFor(read), tone: warn ? TONE.WARN : TONE.ERROR, openAuth: false, sessionExpired: false };
}

/* Same wording as badgeErrorAdvice: a settings Fetch and a badge test report the
   same failures and must not disagree about either the text or the tone. */
export function optionsErrorAdvice(e) {
  const { tone, key, vars } = badgeErrorAdvice(e);
  return vars ? { tone, key, vars } : { tone, key };
}
