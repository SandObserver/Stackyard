const crypto = require('crypto');
const { loadConfig, saveConfig } = require('./config');
const { decodeOrRaw } = require('./percent-decode');
const log = require('./log');

/* Invalidate every outstanding session.

   Rotating the signing secret is what does it: a token's signature is checked
   against this value, so replacing it makes every token that already exists
   unverifiable at once. There is deliberately no second mechanism, such as a
   stored cutoff timestamp, because that would mean two ways for a session to
   die, two places to look when one behaves unexpectedly, and a config read on
   every authenticated request in a path that currently needs none.

   The caller's own session dies too, which is unavoidable and correct. Every
   caller must therefore issue a fresh cookie in the same response, or the person
   who pressed the button is the one logged out. Returns the new secret so they
   can.

   Already used implicitly by a password change, which is why "log out
   everywhere" existed before this only as a side effect of changing your
   password. */
function rotateSessionSecret() {
  const cfg = loadConfig();
  cfg.settings = cfg.settings || {};
  cfg.settings.auth = cfg.settings.auth || {};
  cfg.settings.auth.secret = crypto.randomBytes(32).toString('hex');
  saveConfig(cfg);
  return cfg.settings.auth.secret;
}

function getOrCreateSecret() {
  const cfg = loadConfig();
  if (cfg.settings?.auth?.secret) return cfg.settings.auth.secret;
  const secret = crypto.randomBytes(32).toString('hex');
  cfg.settings = cfg.settings || {};
  cfg.settings.auth = cfg.settings.auth || {};
  cfg.settings.auth.secret = secret;
  saveConfig(cfg);
  return secret;
}

/* Password hashing.

   The stored hash records the algorithm and its parameters, in the modular PHC
   string format that OWASP's Password Storage Cheat Sheet points to:

     $scrypt$ln=14,r=8,p=5$<base64 salt>$<base64 key>

   It used to be `<hex salt>:<hex key>` with the parameters left implicit, which
   meant they could never be changed: raising the cost would derive a different
   key from every stored salt, so every existing password would stop verifying
   and every install would lock out. Recording them is what makes the cost
   adjustable at all, which is the point of a work factor.

   Legacy hashes are still verified, using the parameters they were created with,
   and are rewritten in the new format the next time that password is used. See
   needsRehash.

   Choice of parameters. OWASP prefers Argon2id, which node:crypto does not
   provide and which would mean a dependency the project does not allow, so
   scrypt is the recommendation to follow. Its five listed settings trade RAM for
   parallelism and are described as providing a similar level of defence; their
   work factors are close but not identical, spanning about 1.6x:

     N=2^17 (128 MiB) r=8 p=1
     N=2^16  (64 MiB) r=8 p=2
     N=2^15  (32 MiB) r=8 p=3
     N=2^14  (16 MiB) r=8 p=5   <- default here
     N=2^13   (8 MiB) r=8 p=10

   The default is the 16 MiB row. Stackyard runs on small hardware, and memory is
   the constraint that fails outright rather than merely being slow: 128 MiB per
   login attempt is untenable on a 512 MB board. 16 MiB is what the previous
   parameters already used, so the footprint is unchanged while the work factor
   rises fivefold. It also stays inside node:crypto's default 32 MiB maxmem, so
   nothing has to be raised.

   PASSWORD_HASH_MEMORY selects a different row for anyone on hardware that can
   afford more. Only whole rows, so the pair cannot be set to an unbalanced
   combination, and changing it is safe precisely because each hash records what
   made it. */

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

/* Keyed by memory cost, which is the number an operator actually reasons about. */
const HASH_PROFILES = Object.freeze({
  '8mib':   { ln: 13, r: 8, p: 10 },
  '16mib':  { ln: 14, r: 8, p: 5 },
  '32mib':  { ln: 15, r: 8, p: 3 },
  '64mib':  { ln: 16, r: 8, p: 2 },
  '128mib': { ln: 17, r: 8, p: 1 },
});
const DEFAULT_PROFILE = '16mib';

/* scrypt needs roughly 128 * N * r bytes; node:crypto refuses above maxmem, whose
   default is 32 MiB. Asking for a little over the requirement keeps the larger
   profiles working without disabling the guard. */
const _maxmemFor = ({ ln, r }) => Math.max(33554432, 128 * (2 ** ln) * r * 2);

function _activeProfile() {
  const want = String(process.env.PASSWORD_HASH_MEMORY || DEFAULT_PROFILE).toLowerCase();
  const chosen = HASH_PROFILES[want];
  if (chosen) return chosen;
  log.warn('PASSWORD_HASH_MEMORY is not a recognised setting, using the default', {
    value: want, allowed: Object.keys(HASH_PROFILES).join(','), using: DEFAULT_PROFILE,
  });
  return HASH_PROFILES[DEFAULT_PROFILE];
}

/* PHC uses base64 without padding. */
const _b64 = buf => buf.toString('base64').replace(/=+$/, '');
const _unb64 = str => Buffer.from(str, 'base64');

const _scrypt = (password, salt, params) => new Promise((resolve, reject) => {
  const { ln, r, p } = params;
  crypto.scrypt(password, salt, SCRYPT_KEYLEN,
    { N: 2 ** ln, r, p, maxmem: _maxmemFor(params) },
    (err, key) => (err ? reject(err) : resolve(key)));
});

/** Produce a PHC-format hash using the active profile.
    @param {string} password @returns {Promise<string>} */
async function hashPassword(password) {
  const params = _activeProfile();
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await _scrypt(password, salt, params);
  return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${_b64(salt)}$${_b64(key)}`;
}

/* The format before this change: two hex fields, scrypt with node's defaults
   (N=2^14, r=8, p=1) and a 64-byte key. */
const LEGACY_RE = /^([0-9a-f]+):([0-9a-f]{128})$/i;
const LEGACY_PARAMS = Object.freeze({ ln: 14, r: 8, p: 1 });

const PHC_RE = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/* Guard rails on parsed parameters, so a hand-edited or corrupted hash cannot
   ask for an allocation that takes the process down instead of failing a login.
   ln=20 with r=8 is already 1 GiB. */
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
    /* Logged because the effect is a lockout: the stored password can no longer
       authenticate anyone, and the reason is not otherwise visible. */
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
  /* The length check in parseHash makes a mismatch unreachable, but this is the
     comparison that used to throw where nothing could catch it. */
  try { return crypto.timingSafeEqual(parsed.key, derived); }
  catch { return false; }
}

/** True when a verified hash should be rewritten: it is in the old format, or it
    was made with weaker parameters than the active profile. Callers rewrite it
    after a successful login, which is the only moment the password is known.
    @param {unknown} hash @returns {boolean} */
function needsRehash(hash) {
  const parsed = parseHash(hash);
  if (!parsed) return false;              /* unverifiable; nothing to carry over */
  if (parsed.legacy) return true;
  const want = _activeProfile();
  const work = ({ ln, r, p }) => (2 ** ln) * r * p;
  return work(parsed.params) < work(want);
}

/* Server-enforced session lifetime. The signed issued-at inside the token is
   the real control; the cookie Max-Age below is only a browser hint and is kept
   in sync with this value. Override with SESSION_MAX_AGE_DAYS. */
const _maxAgeDays = Number(process.env.SESSION_MAX_AGE_DAYS);
const SESSION_MAX_AGE_MS = (_maxAgeDays > 0 ? _maxAgeDays : 30) * 24 * 60 * 60 * 1000;

/* Token layout: `${sessionId}.${issuedAt}.${sig}` where sig signs
   `${sessionId}.${issuedAt}`. issuedAt is ms since epoch. Binding the timestamp
   into the signature makes it tamper-proof, so verifyToken can enforce a max age
   without a server-side session store. */
function makeToken(sessionId, secret) {
  const iat = Date.now();
  const payload = `${sessionId}.${iat}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyToken(token, secret) {
  const dot2 = token.lastIndexOf('.');
  if (dot2 === -1) return null;
  const sig  = token.slice(dot2 + 1);
  const rest = token.slice(0, dot2);
  const dot1 = rest.lastIndexOf('.');
  if (dot1 === -1) return null; /* legacy 2-part tokens (no issued-at) are rejected */
  const sessionId = rest.slice(0, dot1), iat = rest.slice(dot1 + 1);
  if (sig.length !== 64 || !/^[0-9a-f]+$/.test(sig)) return null;
  if (!/^[0-9]+$/.test(iat)) return null;
  const expected = crypto.createHmac('sha256', secret).update(rest).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  if (Date.now() - Number(iat) > SESSION_MAX_AGE_MS) return null;
  return sessionId;
}

/* A cookie value that will not percent-decode is kept as sent rather than
   rejected. decodeURIComponent throws on an invalid escape, so a stray '%' in
   any cookie on the domain, not only ours, used to turn every authenticated
   request into a 500. An unrelated cookie is not this application's business,
   and the session token is hex and dots, so it never needs decoding to be
   recognised. */
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = decodeOrRaw(v.join('='));
  }
  return out;
}

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

/* Secure requires HTTPS, which most homelab installs don't have on their LAN
   (e.g. http://192.168.x.x:8700). Setting it unconditionally would make the
   browser silently refuse to store or send the cookie, breaking login with no
   visible error. Treat the request as secure if the socket itself is TLS, or
   if TRUST_PROXY is on and a fronting proxy says it terminated TLS. */
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

const _loginAttempts = new Map();
const LOGIN_MAX = 5, LOGIN_WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const rec = _loginAttempts.get(ip) || { count:0, first:now };
  if (now - rec.first > LOGIN_WINDOW_MS) { _loginAttempts.delete(ip); return null; }
  if (rec.count >= LOGIN_MAX) {
    const remaining = Math.ceil((LOGIN_WINDOW_MS - (now - rec.first)) / 60000);
    return `Too many attempts. Try again in ${remaining} minute${remaining!==1?'s':''}.`;
  }
  return null;
}

/* Atomically check the login limit and count this attempt in one synchronous
   step, with no await in between, so a burst of concurrent logins cannot all
   clear the check before any of them is counted (the check-then-increment race).
   Returns a limit message if already at the cap without counting, otherwise
   records the attempt and returns null. The caller clears the count on success. */
function registerLoginAttempt(ip) {
  const err = checkRateLimit(ip);
  if (err) return err;
  const now = Date.now();
  const rec = _loginAttempts.get(ip) || { count:0, first:now };
  _loginAttempts.set(ip, { count: rec.count + 1, first: rec.first });
  return null;
}

function clearAttempts(ip) { _loginAttempts.delete(ip); }

const _rateBuckets = new Map();
function rateLimit(ip, key, max, windowMs) {
  const bkey = `${ip}:${key}`;
  const now  = Date.now();
  const rec  = _rateBuckets.get(bkey) || { count:0, first:now };
  if (now - rec.first > windowMs) { _rateBuckets.set(bkey, { count:1, first:now }); return null; }
  if (rec.count >= max) {
    const remaining = Math.ceil((windowMs - (now - rec.first)) / 1000);
    return `Rate limit exceeded. Try again in ${remaining}s.`;
  }
  _rateBuckets.set(bkey, { count: rec.count + 1, first: rec.first });
  return null;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rateBuckets)   if (now - v.first > 3_600_000)     _rateBuckets.delete(k);
  for (const [k, v] of _loginAttempts) if (now - v.first > LOGIN_WINDOW_MS) _loginAttempts.delete(k);
}, 600_000).unref();

/* Whether authentication is actually in force.

   Auth switched on with no password stored is not a stricter state, it is an
   unusable one: every login is refused because there is nothing to check
   against, while every other route is gated. That locked the install with no way
   back in over HTTP, since setting a password and switching auth off both sit
   behind the gate. /api/auth/toggle now refuses to create that state, and this
   treats an install already in it as switched off, so the admin is reachable
   and the password can be set. It resolves itself the moment one is: nothing is
   rewritten on disk, the stored flag is simply not honoured on its own.

   This is not a bypass. A password hash is what a session is verified against;
   with none stored there is no credential to present and no session to forge. */
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

/* Like isAuthenticated, but does NOT return true just because auth is disabled.
   Verifies an actual valid session cookie against the signing secret. Used to
   gate sensitive operations (e.g. changing an existing password) that must not
   be possible from an unauthenticated request even when auth is turned off. */
function hasValidSession(req) {
  const cfg = loadConfig();
  const secret = cfg.settings?.auth?.secret;
  if (!secret) return false;
  const token = parseCookies(req).ds;
  if (!token) return false;
  return !!verifyToken(token, secret);
}

module.exports = {
  getOrCreateSecret, rotateSessionSecret, hashPassword, verifyPassword, authActive, needsRehash,
  HASH_PROFILES, DEFAULT_PROFILE, parseHash,
  makeToken, verifyToken, parseCookies, setSessionCookie, clearSessionCookie, isSecureRequest,
  checkRateLimit, registerLoginAttempt, clearAttempts, rateLimit, isAuthenticated, hasValidSession,
  SESSION_MAX_AGE_MS,
};
