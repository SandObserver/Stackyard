/* Maps the API's `kind` (see docs/api-errors.md) to what the admin UI should do
   about it. Deliberately pure, with no DOM and no imports, so it can be tested
   from api/test. Adding a kind on one side only is caught there. */

export const KIND = Object.freeze({
  NETWORK:  'network',
  TIMEOUT:  'timeout',
  BLOCKED:  'blocked',
  AUTH:     'auth',
  UPSTREAM: 'upstream',
  INVALID:  'invalid',
  INTERNAL: 'internal',
});

/* Colours match the existing inline styles in admin-app-form.js: amber for
   "you can fix this", red for "this failed". */
export const TONE = Object.freeze({ WARN: 'warn', ERROR: 'error' });

/* An unknown or missing kind degrades to INTERNAL, so either side can be newer
   than the other. */
export function readError(e) {
  const kind = e && typeof e.kind === 'string' && Object.values(KIND).includes(e.kind)
    ? e.kind
    : KIND.INTERNAL;
  const detail = e && e.detail && typeof e.detail === 'object' ? e.detail : null;
  return { kind, detail, message: (e && e.message) || '' };
}

/* Returns { tone, message, openAuth, sessionExpired }. sessionExpired means the
   caller's own Stackyard session died, so the page sends them back to the login
   screen rather than offering an API key. */
export function badgeErrorAdvice(e) {
  const { kind, detail, message } = readError(e);

  if (kind === KIND.AUTH) {
    /* Our own session, not the upstream's. The old code matched 'Unauthori'
       here and wrongly told the user to add an upstream API key. */
    return {
      tone: TONE.ERROR,
      message: 'Your session has expired. Sign in again to continue.',
      openAuth: false,
      sessionExpired: true,
    };
  }

  if (kind === KIND.UPSTREAM && (detail?.status === 401 || detail?.status === 403)) {
    return {
      tone: TONE.WARN,
      message: 'Authentication required. Enable the Authentication toggle below and add your API key.',
      openAuth: true,
      sessionExpired: false,
    };
  }

  if (kind === KIND.NETWORK || kind === KIND.TIMEOUT) {
    return {
      tone: TONE.WARN,
      message: "Can't reach this address from Docker. Try using the container name, e.g. http://container-name:8181/api/v2",
      openAuth: false,
      sessionExpired: false,
    };
  }

  /* BLOCKED carries a reason we wrote ourselves, so it is shown verbatim. */
  return {
    tone: TONE.ERROR,
    message: message || 'Request failed.',
    openAuth: false,
    sessionExpired: false,
  };
}

/* The server's "retype the credential" message is an instruction, not a failure
   report, so it is shown without the "Fetch failed:" prefix. */
export function optionsErrorText(e) {
  const { kind, message } = readError(e);
  if (kind === KIND.INVALID && message) return message;
  return 'Fetch failed: ' + (message || 'Request failed.');
}
