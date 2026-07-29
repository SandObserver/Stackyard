/* Turning a structured API error into what the admin UI should do about it.

   The API sends `{ error, kind, detail? }` (see docs/api-errors.md). This module
   owns the mapping from `kind` to advice. It is deliberately pure: no DOM, no
   imports, no i18n. That is what lets it be tested from api/test without a
   browser, which matters because the behaviour it replaces (substring-matching
   `e.message` for '401' / 'ECONNREFUSED') broke silently and had no test at all.

   Adding a kind here without adding it in api/src/api-error.js, or the reverse,
   is caught by api/test/api-error.test.js. */

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

/* Read the classification off a thrown error, defensively.

   An unknown or missing kind degrades to INTERNAL rather than throwing, so an
   older frontend keeps working against a newer API, and a newer frontend keeps
   working against an API that has not been redeployed yet. */
export function readError(e) {
  const kind = e && typeof e.kind === 'string' && Object.values(KIND).includes(e.kind)
    ? e.kind
    : KIND.INTERNAL;
  const detail = e && e.detail && typeof e.detail === 'object' ? e.detail : null;
  return { kind, detail, message: (e && e.message) || '' };
}

/* What the badge "Fetch" button should show and do.

   Returns { tone, message, openAuth, sessionExpired }.
     openAuth        tick the Authentication toggle and open its section
     sessionExpired  the caller's own Stackyard session died; the page should
                     send them back to the login screen, not offer an API key */
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

  /* BLOCKED carries a reason we wrote ourselves ("Blocked: localhost is a
     private address."), so it is worth showing verbatim. Previously it fell
     through to the generic branch because the text contains neither '403' nor
     'Forbidden'. */
  return {
    tone: TONE.ERROR,
    message: message || 'Request failed.',
    openAuth: false,
    sessionExpired: false,
  };
}

/* Status text for a failed config-time "Fetch".

   The server declines to reuse a stored credential when the posted config no
   longer matches the saved one, and says so in the message. That is an
   instruction, not a failure report, so it is shown on its own rather than
   under a "Fetch failed:" prefix. */
export function optionsErrorText(e) {
  const { kind, message } = readError(e);
  if (kind === KIND.INVALID && message) return message;
  return 'Fetch failed: ' + (message || 'Request failed.');
}
