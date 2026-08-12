/* Maps the API's `kind` to what the admin UI should do about it. Keep it free
   of the DOM and of imports: api/test loads it directly. */

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

/* Matches the two SSRF messages that ALLOW_PRIVATE_IPS would let through.
   Keep it in step with the guard in api/src/proxy.js. */
const PRIVATE_BLOCK_RE = /is a private address\.|resolves to private IP /;

/* An unknown or missing kind degrades to INTERNAL. */
export function readError(e) {
  const kind = e && typeof e.kind === 'string' && Object.values(KIND).includes(e.kind) ? e.kind : KIND.INTERNAL;
  const detail = e && e.detail && typeof e.detail === 'object' ? e.detail : null;
  return { kind, detail, message: (e && e.message) || '' };
}

export function badgeErrorAdvice(e) {
  const { kind, detail, message } = readError(e);

  if (kind === KIND.AUTH) {
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
      message:
        "Can't reach this address from Docker. Try using the container name, e.g. http://container-name:8181/api/v2",
      openAuth: false,
      sessionExpired: false,
    };
  }

  if (kind === KIND.BLOCKED && PRIVATE_BLOCK_RE.test(message)) {
    return {
      tone: TONE.WARN,
      message: `${message} Most homelab services live on private IPs. Set ALLOW_PRIVATE_IPS=true and restart the container.`,
      openAuth: false,
      sessionExpired: false,
    };
  }

  /* BLOCKED carries a reason this project wrote, so it is shown verbatim. */
  return {
    tone: TONE.ERROR,
    message: message || 'Request failed.',
    openAuth: false,
    sessionExpired: false,
  };
}

export function optionsErrorText(e) {
  const { kind, message } = readError(e);
  if (kind === KIND.INVALID && message) return message;
  return 'Fetch failed: ' + (message || 'Request failed.');
}
