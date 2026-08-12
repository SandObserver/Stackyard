const crypto = require('crypto');
const { loadConfig, saveConfig } = require('./config');
const { decodeOrRaw } = require('./percent-decode');
const log = require('./log');

/* SECRET_BYTES is the signing key for the session HMAC. SESSION_ID_BYTES is the
   identifier inside the token, which is not a credential on its own. */
const SECRET_BYTES = 32,
  SESSION_ID_BYTES = 24;
const newSessionSecret = () => crypto.randomBytes(SECRET_BYTES).toString('hex');
const newSessionId = () => crypto.randomBytes(SESSION_ID_BYTES).toString('hex');

/* Mutates and returns the block, so a caller can write to it directly. */
function _authBlock(cfg) {
  cfg.settings = cfg.settings || {};
  cfg.settings.auth = cfg.settings.auth || {};
  return cfg.settings.auth;
}

/* Invalidates every outstanding session, including the caller's own, so the
   caller must issue a fresh cookie in the same response. Returns the new
   secret so it can. */
function rotateSessionSecret() {
  const cfg = loadConfig();
  const auth = _authBlock(cfg);
  auth.secret = newSessionSecret();
  saveConfig(cfg);
  return auth.secret;
}

/* Keeps an existing secret: rotating here would sign out every device each time
   the server needed the key. */
function getOrCreateSecret() {
  const cfg = loadConfig();
  if (cfg.settings?.auth?.secret) return cfg.settings.auth.secret;
  const auth = _authBlock(cfg);
  auth.secret = newSessionSecret();
  saveConfig(cfg);
  return auth.secret;
}

/* Password hashing, PHC format: $scrypt$ln=14,r=8,p=5$<b64 salt>$<b64 key>.
   Each hash records the parameters it was made with, which is what makes the
   cost adjustable without locking out every existing password. */

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/* Whole rows only, so the parameters cannot be set to an unbalanced pair. The
   default suits a 512 MB board; memory is what fails outright on small hardware. */
const HASH_PROFILES = Object.freeze({
  '8mib': { ln: 13, r: 8, p: 10 },
  '16mib': { ln: 14, r: 8, p: 5 },
  '32mib': { ln: 15, r: 8, p: 3 },
  '64mib': { ln: 16, r: 8, p: 2 },
  '128mib': { ln: 17, r: 8, p: 1 },
});
const DEFAULT_PROFILE = '16mib';

/* scrypt needs roughly 128 * N * r bytes and node:crypto refuses above maxmem,
   which defaults to 32 MiB. */
const _maxmemFor = ({ ln, r }) => Math.max(33554432, 128 * 2 ** ln * r * 2);

function _activeProfile() {
  const want = String(process.env.PASSWORD_HASH_MEMORY || DEFAULT_PROFILE).toLowerCase();
  const chosen = HASH_PROFILES[want];
  if (chosen) return chosen;
  log.warn('PASSWORD_HASH_MEMORY is not a recognised setting, using the default', {
    value: want,
    allowed: Object.keys(HASH_PROFILES).join(','),
    using: DEFAULT_PROFILE,
  });
  return HASH_PROFILES[DEFAULT_PROFILE];
}

/* PHC uses base64 without padding. */
const _b64 = buf => buf.toString('base64').replace(/=+$/, '');
const _unb64 = str => Buffer.from(str, 'base64');

const _scrypt = (password, salt, params) =>
  new Promise((resolve, reject) => {
    const { ln, r, p } = params;
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, { N: 2 ** ln, r, p, maxmem: _maxmemFor(params) }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });

/** Produce a PHC-format hash using the active profile.
    @param {string} password @returns {Promise<string>} */
async function hashPassword(password) {
  const params = _activeProfile();
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await _scrypt(password, salt, params);
  return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${_b64(salt)}$${_b64(key)}`;
}

/* The pre-PHC format: two hex fields, scrypt with node's defaults. Still
   verified, and rewritten on the next successful login. */
const LEGACY_RE = /^([0-9a-f]+):([0-9a-f]{128})$/i;
const LEGACY_PARAMS = Object.freeze({ ln: 14, r: 8, p: 1 });

const PHC_RE = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/* A corrupted hash must fail the login, not ask for an allocation that takes the
   process down: ln=20 with r=8 is already 1 GiB. */
const LN_MAX = 20;
const R_MAX = 32;
const P_MAX = 64;

/** Parse a stored hash into what is needed to verify it.
    @param {unknown} stored
    @returns {{ params:{ln:number,r:number,p:number}, salt:Buffer, key:Buffer, legacy:boolean }|null} */
function parseHash(stored) {
  const str = typeof stored === 'string' ? stored : '';

  const phc = PHC_RE.exec(str);
  if (phc) {
    const ln = Number(phc[1]);
    const r = Number(phc[2]);
    const p = Number(phc[3]);
    if (ln < 1 || ln > LN_MAX || r < 1 || r > R_MAX || p < 1 || p > P_MAX) return null;
    const salt = _unb64(phc[4]);
    const key = _unb64(phc[5]);
    if (!salt.length || key.length !== SCRYPT_KEYLEN) return null;
    return { params: { ln, r, p }, salt, key, legacy: false };
  }

  const legacy = LEGACY_RE.exec(str);
  if (legacy) {
    /* The salt was fed to scrypt as the hex string itself, not as decoded
       bytes, so it has to be passed the same way to reproduce the key. */
    return {
      params: LEGACY_PARAMS,
      salt: Buffer.from(legacy[1], 'utf8'),
      key: Buffer.from(legacy[2], 'hex'),
      legacy: true,
    };
  }

  return null;
}

/** True when `password` matches the stored hash. Resolves false for any hash this
    function cannot verify; never rejects on a malformed one, and never throws
    asynchronously, because a damaged hash must fail the login rather than take
    the server down.
    @param {string} password @param {unknown} hash @returns {Promise<boolean>} */
async function verifyPassword(password, hash) {
  const parsed = parseHash(hash);
  if (!parsed) {
    /* The effect is a lockout, and the reason is not otherwise visible. */
    if (hash) log.error('stored password hash is malformed, login cannot succeed', { reason: 'bad_hash_format' });
    return false;
  }
  let derived;
  try {
    derived = await _scrypt(password, parsed.salt, parsed.params);
  } catch (e) {
    log.error('password verification failed', { error: e.message });
    return false;
  }
  /* timingSafeEqual throws on a length mismatch, where nothing else would catch
     it. */
  try {
    return crypto.timingSafeEqual(parsed.key, derived);
  } catch {
    return false;
  }
}

/** True when a verified hash should be rewritten: it is in the old format, or it
    was made with weaker parameters than the active profile. Callers rewrite it
    after a successful login, which is the only moment the password is known.
    @param {unknown} hash @returns {boolean} */
function needsRehash(hash) {
  const parsed = parseHash(hash);
  if (!parsed) return false; /* unverifiable; nothing to carry over */
  if (parsed.legacy) return true;
  const want = _activeProfile();
  const work = ({ ln, r, p }) => 2 ** ln * r * p;
  return work(parsed.params) < work(want);
}

/* The signed issued-at inside the token is the real control; the cookie Max-Age
   is only a browser hint kept in sync with it.

   This is an idle window, not a fixed one: a session in use is reissued by
   refreshSession below, so the age here is how long a session survives with
   nobody using it. A token that leaks is therefore usable for hours rather than
   the month it used to be, while somebody working in the dashboard is not
   signed out mid-task. */
const DEFAULT_MAX_AGE_HOURS = 12;
const _maxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS);
const SESSION_MAX_AGE_MS = _maxAgeDays > 0 ? _maxAgeDays * 24 * 60 * 60 * 1000 : DEFAULT_MAX_AGE_HOURS * 60 * 60 * 1000;

/* Reissue once the token is past halfway. Renewing on every request would set a
   cookie on every response for no gain; waiting until it nearly expires would
   leave a tab open across the boundary holding a token it cannot renew. */
const RENEW_AFTER_MS = SESSION_MAX_AGE_MS / 2;

/* `${sessionId}.${issuedAt}.${sig}`, where sig covers the first two. Signing the
   timestamp is what lets verifyToken enforce a max age with no session store. */
function makeToken(sessionId, secret) {
  const iat = Date.now();
  const payload = `${sessionId}.${iat}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/** The session a token stands for, with the moment it was issued, or null when
    it does not verify or has aged out. Callers that only need the identity use
    verifyToken; the issued-at is what refreshSession needs to decide on renewal.
    @param {string} token @param {string} secret
    @returns {{ sessionId: string, iat: number }|null} */
function readToken(token, secret) {
  const dot2 = token.lastIndexOf('.');
  if (dot2 === -1) return null;
  const sig = token.slice(dot2 + 1);
  const rest = token.slice(0, dot2);
  const dot1 = rest.lastIndexOf('.');
  if (dot1 === -1) return null; /* legacy 2-part tokens (no issued-at) are rejected */
  const sessionId = rest.slice(0, dot1),
    iat = rest.slice(dot1 + 1);
  if (sig.length !== 64 || !/^[0-9a-f]+$/.test(sig)) return null;
  if (!/^[0-9]+$/.test(iat)) return null;
  const expected = crypto.createHmac('sha256', secret).update(rest).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  if (Date.now() - Number(iat) > SESSION_MAX_AGE_MS) return null;
  return { sessionId, iat: Number(iat) };
}

function verifyToken(token, secret) {
  return readToken(token, secret)?.sessionId ?? null;
}

/* decodeURIComponent throws on an invalid escape, so a stray '%' in any cookie
   on the domain, not only ours, would fail every authenticated request. */
function parseCookies(req) {
  const header = req.headers.cookie || '';
  /* Null prototype: the keys are cookie names straight off the request. */
  const out = Object.create(null);
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = decodeOrRaw(v.join('='));
  }
  return out;
}

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

/* A Secure cookie set over plain HTTP, which is the normal case on a LAN, is
   silently dropped by the browser and breaks login with no visible error. */
function isSecureRequest(req) {
  if (req.socket?.encrypted) return true;
  if (TRUST_PROXY) {
    const proto = req.headers['x-forwarded-proto'];
    if (proto && proto.split(',')[0].trim().toLowerCase() === 'https') return true;
  }
  return false;
}

function setSessionCookie(res, token, secure) {
  const flag = secure ? ' Secure;' : '';
  const maxAge = Math.floor(SESSION_MAX_AGE_MS / 1000);
  res.setHeader('Set-Cookie', `ds=${token}; HttpOnly;${flag} SameSite=Strict; Path=/; Max-Age=${maxAge}`);
}

function clearSessionCookie(res, secure) {
  const flag = secure ? ' Secure;' : '';
  res.setHeader('Set-Cookie', `ds=; HttpOnly;${flag} SameSite=Strict; Path=/; Max-Age=0`);
}

/* ── Fixed-window rate limiting ───────────────────────────────────────────────

   One counter, two surfaces. Login attempts and the polling routes differ only
   in what they key on and how they word the wait, so the arithmetic lives here
   once and the surfaces stay separate. */

/* Count this hit against `key`, and say how much of the window is left if it is
   refused.

   Checking and counting are one synchronous step with no await between, or a
   burst of requests all clears the check before any is counted; there is no
   exported way to ask without counting. A refused hit is not counted, so a
   lockout expires on schedule instead of being extended by what it refuses.

   @param {Map<string, {count:number, first:number}>} store
   @param {string} key @param {number} max @param {number} windowMs
   @returns {number|null} ms remaining while refused, null when allowed */
function hit(store, key, max, windowMs) {
  const now = Date.now();
  /* A ceiling below one refuses everything. Worth stating, because the opening
     of a fresh window counts the hit that opened it, so without this a limit of
     zero would let one request through. */
  if (max < 1) return windowMs;
  const rec = store.get(key);
  if (!rec || now - rec.first > windowMs) {
    store.set(key, { count: 1, first: now });
    return null;
  }
  if (rec.count >= max) return windowMs - (now - rec.first);
  rec.count += 1;
  return null;
}

const _loginAttempts = new Map();
const LOGIN_MAX = 5,
  LOGIN_WINDOW_MS = 15 * 60 * 1000;

/* Reported in whole minutes: a fifteen-minute lockout counted down in seconds
   reads as a stopwatch on a screen someone is already locked out of. */
function registerLoginAttempt(ip) {
  const left = hit(_loginAttempts, ip, LOGIN_MAX, LOGIN_WINDOW_MS);
  if (left === null) return null;
  const minutes = Math.ceil(left / 60000);
  return `Too many attempts. Try again in ${minutes} minute${minutes !== 1 ? 's' : ''}.`;
}

function clearAttempts(ip) {
  _loginAttempts.delete(ip);
}

const _rateBuckets = new Map();

/* Keyed by ip and route, so one client hitting a ceiling on one route does not
   affect its own use of another, or anyone else. Reported in seconds: these
   windows are a minute, and there is nothing for the caller to do but retry. */
function rateLimit(ip, key, max, windowMs) {
  const left = hit(_rateBuckets, `${ip}:${key}`, max, windowMs);
  if (left === null) return null;
  return `Rate limit exceeded. Try again in ${Math.ceil(left / 1000)}s.`;
}

/* A window that has passed is rewritten by the next hit on that key, so this
   only clears keys nobody comes back to. */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rateBuckets) if (now - v.first > 3_600_000) _rateBuckets.delete(k);
  for (const [k, v] of _loginAttempts) if (now - v.first > LOGIN_WINDOW_MS) _loginAttempts.delete(k);
}, 600_000).unref();

/* Auth on with no password stored is an unusable state, not a stricter one:
   every login is refused while every route is gated, which locks the install
   out. Treating it as off is not a bypass, since with no hash there is no
   credential to present and no session to forge. */
function authActive(cfg) {
  const auth = cfg?.settings?.auth;
  return !!(auth?.enabled && auth?.passwordHash);
}

function isAuthenticated(req) {
  const cfg = loadConfig();
  if (!authActive(cfg)) return true;
  const token = parseCookies(req).ds;
  if (!token) return false;
  const secret = cfg.settings.auth.secret;
  if (!secret) return false;
  return !!verifyToken(token, secret);
}

/* Extend a session that is still in use, so the shortened idle window does not
   sign out somebody working in the dashboard. The identifier is carried over and
   only the issued-at moves, so this lengthens a session rather than starting one.

   A handler that sets its own cookie runs after this and replaces the header, so
   logging out and rotating the secret both still win. */
function refreshSession(req, res) {
  const cfg = loadConfig();
  if (!authActive(cfg)) return false;
  const secret = cfg.settings.auth.secret;
  if (!secret) return false;
  const token = parseCookies(req).ds;
  if (!token) return false;
  const read = readToken(token, secret);
  if (!read || Date.now() - read.iat < RENEW_AFTER_MS) return false;
  setSessionCookie(res, makeToken(read.sessionId, secret), isSecureRequest(req));
  return true;
}

/* Unlike isAuthenticated, requires a real session even when auth is off. For
   operations such as changing an existing password. */
function hasValidSession(req) {
  const cfg = loadConfig();
  const secret = cfg.settings?.auth?.secret;
  if (!secret) return false;
  const token = parseCookies(req).ds;
  if (!token) return false;
  return !!verifyToken(token, secret);
}

module.exports = {
  getOrCreateSecret,
  rotateSessionSecret,
  newSessionSecret,
  newSessionId,
  hashPassword,
  verifyPassword,
  authActive,
  needsRehash,
  HASH_PROFILES,
  DEFAULT_PROFILE,
  parseHash,
  makeToken,
  verifyToken,
  readToken,
  refreshSession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  isSecureRequest,
  registerLoginAttempt,
  clearAttempts,
  rateLimit,
  isAuthenticated,
  hasValidSession,
  /* Tests exercise limits in sequence in one process. */
  _resetRateLimits: () => _rateBuckets.clear(),
  SESSION_MAX_AGE_MS,
  RENEW_AFTER_MS,
};
