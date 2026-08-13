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

/* The reason code the API sends with a block that ALLOW_PRIVATE_IPS would let
   through. The message itself never names the address. */
const PRIVATE_ADDRESS = 'private-address';

const PRIVATE_ADDRESS_ADVICE =
  'Most homelab services live on private IPs. Set ALLOW_PRIVATE_IPS=true and restart the container.';

const blockedForPrivateAddress = ({ kind, detail }) => kind === KIND.BLOCKED && detail?.reason === PRIVATE_ADDRESS;

/* An unknown or missing kind degrades to INTERNAL. */
export function readError(e) {
  const kind = e && typeof e.kind === 'string' && Object.values(KIND).includes(e.kind) ? e.kind : KIND.INTERNAL;
  const detail = e && e.detail && typeof e.detail === 'object' ? e.detail : null;
  return { kind, detail, message: (e && e.message) || '' };
}

export function badgeErrorAdvice(e) {
  const read = readError(e);
  const { kind, detail, message } = read;

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

  if (blockedForPrivateAddress(read)) {
    return {
      tone: TONE.WARN,
      message: `${message} ${PRIVATE_ADDRESS_ADVICE}`,
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

/* Same shape as badgeErrorAdvice: a settings Fetch and a badge test report the
   same failures and must not disagree about the tone. */
export function optionsErrorAdvice(e) {
  const read = readError(e);
  const { kind, message } = read;
  if (blockedForPrivateAddress(read)) {
    return { tone: TONE.WARN, message: `${message} ${PRIVATE_ADDRESS_ADVICE}` };
  }
  if (kind === KIND.INVALID && message) return { tone: TONE.ERROR, message };
  return { tone: TONE.ERROR, message: 'Fetch failed: ' + (message || 'Request failed.') };
}
