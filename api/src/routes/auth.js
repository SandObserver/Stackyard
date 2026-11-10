const { on, json, readBody, checkOrigin, getIp, AUTH_BODY_LIMIT } = require('../router');
const { IS_DEMO, DEMO_READONLY_MSG } = require('../demo');
const { loadConfig, loadConfigForUpdate, saveConfig } = require('../config');
const log = require('../log');
const { fail, KIND } = require('../api-error');
const { normalizeHostList, hostnameOf } = require('../../../ui/js/host-names.js');
const { newPasswordError } = require('../new-password');
const { knownHost, refusedHost, proxiedNameLost } = require('../host-check');
const {
  getOrCreateSecret,
  rotateSessionSecret,
  newSessionSecret,
  newSessionId,
  hashPassword,
  hashQueueFull,
  verifyPassword,
  matchPassword,
  attemptAddress,
  makeToken,
  setSessionCookie,
  clearSessionCookie,
  revokeSession,
  isSecureRequest,
  registerLoginAttempt,
  loginWaitMinutes,
  clearAttempts,
  refundLoginAttempt,
  isAuthenticated,
  hasValidSession,
  stripDisabledCredentials,
  authActive,
  passwordDamaged,
  needsRehash,
  storePassword,
  LOGIN_WINDOW_MS,
} = require('../auth');
const setupCode = require('../setup-code');

const CURRENT_PASSWORD_CODE = 'invalid.current-password';
/* The last hash this process rewrote at login. It holds the same password. */
let lastUpgrade = null;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

/* Answers before sign-in. Say only what the login screen has to decide. The
   setup fields describe the install and are added only once the caller is
   through. */
on('GET', '/api/auth/check', (req, res) => {
  const cfg = loadConfig();
  if (!IS_DEMO && !cfg.settings?.auth?.passwordHash) setupCode.announce('first');
  const authenticated = isAuthenticated(req);
  const body = {
    /* The effective state, not the stored flag. */
    enabled: authActive(cfg),
    authenticated,
  };
  const language = cfg.settings?.language;
  if (typeof language === 'string' && LANGUAGE_TAG.test(language)) body.language = language;
  if (authenticated) {
    body.passwordSet = !!cfg.settings?.auth?.passwordHash;
    body.setupPrompted = !!cfg.settings?.auth?.setupPrompted;
  }
  json(res, 200, body);
});

/* Anyone can post to these routes. A body that is too large or not a JSON
   object gets a 400 with no log line, or strangers can fill the log. */
async function readAuthBody(req, res) {
  let body = null;
  try {
    body = JSON.parse(await readBody(req, AUTH_BODY_LIMIT));
  } catch {}
  if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  json(res, 400, { error: 'The request body must be a JSON object.', kind: KIND.INVALID });
  return null;
}

/** @param {import('http').ServerResponse} res */
function connectionSignal(res) {
  const ac = new AbortController();
  res.once('close', () => ac.abort());
  return ac.signal;
}

function busy(res) {
  return json(res, 503, {
    error: 'Too many passwords are being checked. Try again in a moment.',
    kind: KIND.BLOCKED,
    code: 'blocked.busy',
  });
}

/* Anyone can cause these lines. Without a cap, a flood rotates the record of
   the guessing out of the container log. */
const AUDIT_PER_MINUTE = 30;
let _auditMinute = 0;
let _auditLines = 0;
let _auditUnlogged = 0;
/** @type {Map<string, number>} */
const _blockLogged = new Map();

function flushAudit(now = Date.now()) {
  if (now - _auditMinute < 60_000) return;
  if (_auditUnlogged) log.audit('sign-in events not logged one by one', { count: _auditUnlogged });
  _auditMinute = now;
  _auditLines = 0;
  _auditUnlogged = 0;
}
setInterval(flushAudit, 60_000).unref();

function auditAttempt(message, fields) {
  flushAudit();
  if (_auditLines >= AUDIT_PER_MINUTE) {
    _auditUnlogged++;
    return;
  }
  _auditLines++;
  log.audit(message, fields);
}

function auditBlocked(message, ip, key) {
  const now = Date.now();
  const at = _blockLogged.get(key);
  if (at !== undefined && now - at < LOGIN_WINDOW_MS) {
    flushAudit(now);
    _auditUnlogged++;
    return;
  }
  if (_blockLogged.size >= 10_000) _blockLogged.clear();
  _blockLogged.set(key, now);
  auditAttempt(message, { ip, reason: 'rate_limit' });
}

const hostOf = req => String(req.headers.host || '').slice(0, 255);

on('POST', '/api/auth/login', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  const ip = getIp(req);
  try {
    const body = await readAuthBody(req, res);
    if (!body) return;
    const { password = '' } = body;
    const cfg = loadConfig();
    if (!authActive(cfg)) return json(res, 200, { ok: true });
    if (passwordDamaged(cfg)) {
      setupCode.announce('damaged');
      return json(res, 401, {
        error: 'The saved password is damaged. Set a new one with the setup code from the container log.',
        kind: KIND.AUTH,
        code: 'auth.password-damaged',
      });
    }
    const hash = cfg.settings.auth.passwordHash;
    const key = attemptKey(req, cfg);
    const limitErr = registerLoginAttempt(key);
    if (limitErr) {
      auditBlocked('login blocked', ip, key);
      return json(res, 429, rateLimitBody(limitErr, key));
    }
    if (hashQueueFull()) {
      refundLoginAttempt(key);
      return busy(res);
    }
    const signal = connectionSignal(res);
    const match = await matchPassword(typeof password === 'string' ? password : '', hash, { signal }).catch(e => {
      if (e.busy) refundLoginAttempt(key);
      throw e;
    });
    if (!match) {
      auditAttempt('login failed', { ip });
      return json(res, 401, { error: 'Incorrect password.', kind: KIND.AUTH });
    }
    clearAttempts(key);
    let current = hash;
    /* A failure here must not fail the login. The password is correct either
       way and the old hash still verifies. */
    if (match.unnormalized || needsRehash(hash)) {
      try {
        const upgraded = await hashPassword(password, { signal });
        const fresh = loadConfigForUpdate();
        const stored = fresh.settings?.auth?.passwordHash;
        if (stored === hash) {
          fresh.settings.auth.passwordHash = upgraded;
          saveConfig(fresh);
          current = upgraded;
          lastUpgrade = { from: hash, to: upgraded };
          log.info('password hash upgraded to the current format', {});
        } else if (lastUpgrade?.from === hash && stored === lastUpgrade.to) {
          current = stored;
        }
      } catch (e) {
        log.warn('could not upgrade the stored password hash', { error: e.message });
      }
    }
    /* No await from here to the cookie. A password changed while this one was
       checked rotated the secret, and signing with it would let the old
       password in. */
    if (loadConfig().settings?.auth?.passwordHash !== current) {
      auditAttempt('login failed', { ip, reason: 'password_changed' });
      return json(res, 401, { error: 'Incorrect password.', kind: KIND.AUTH });
    }
    log.audit('login success', { ip });
    const secret = getOrCreateSecret();
    const sessionId = newSessionId();
    setSessionCookie(res, makeToken(sessionId, secret), isSecureRequest(req));
    json(res, 200, { ok: true });
  } catch (e) {
    if (e.busy) return busy(res);
    fail(res, e, { status: 400 });
  }
});

on('POST', '/api/auth/logout', (req, res) => {
  if (!checkOrigin(req, res)) return;
  log.audit('logout', { ip: getIp(req) });
  clearSessionCookie(res, isSecureRequest(req));
  try {
    revokeSession(req);
  } catch (e) {
    return fail(res, e, { status: 500, kind: KIND.INTERNAL, error: 'Could not end the session on the server.' });
  }
  json(res, 200, { ok: true });
});

/* Keep unlisted names on a count of their own. A page on another site that
   points its name at this server could otherwise lock the owner out. */
function attemptKey(req, cfg) {
  const ip = attemptAddress(getIp(req));
  return knownHost(req, cfg) ? ip : `${ip} unlisted`;
}

function rateLimitBody(error, key) {
  const minutes = loginWaitMinutes(key);
  const body = { error, kind: KIND.BLOCKED, code: 'blocked.rate-limit' };
  return minutes ? { ...body, detail: { minutes } } : body;
}

/* Keep the lockout count. Without it a session can brute-force the password. */
async function refuseWrongCurrentPassword(req, res, hash, currentPassword) {
  const ip = getIp(req);
  const key = attemptKey(req, loadConfig());
  const limitErr = registerLoginAttempt(key);
  if (limitErr) {
    auditBlocked('password check blocked', ip, key);
    json(res, 429, rateLimitBody(limitErr, key));
    return true;
  }
  if (hashQueueFull()) {
    refundLoginAttempt(key);
    busy(res);
    return true;
  }
  const signal = connectionSignal(res);
  const matches = await verifyPassword(typeof currentPassword === 'string' ? currentPassword : '', hash, {
    signal,
  }).catch(e => {
    if (e.busy) refundLoginAttempt(key);
    throw e;
  });
  if (!matches) {
    auditAttempt('password check failed', { ip });
    json(res, 403, { error: 'Current password is incorrect.', kind: KIND.INVALID, code: CURRENT_PASSWORD_CODE });
    return true;
  }
  clearAttempts(key);
  return false;
}

on('POST', '/api/auth/set-password', async (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED, code: 'blocked.read-only' });
  if (!checkOrigin(req, res)) return;
  try {
    const before = loadConfig();
    const storedHash = before.settings?.auth?.passwordHash;
    if (storedHash && !hasValidSession(req)) {
      return json(res, 401, { error: 'Authentication required to change the existing password.', kind: KIND.AUTH });
    }
    const body = await readAuthBody(req, res);
    if (!body) return;
    const { password = '', currentPassword, code } = body;
    const refused = newPasswordError(password, hostnameOf(req.headers.host) ?? '');
    if (refused) return json(res, 400, { ...refused, kind: KIND.INVALID });
    /* Keep. Without it, whoever reaches a new install first owns it: anyone on
       the network, or anyone on the internet through a proxy that rewrites
       Host. */
    if (!storedHash && !setupCode.matches(code, 'first')) {
      noteRejectedCode(getIp(req));
      return json(res, 403, { error: 'The setup code is incorrect.', kind: KIND.INVALID, code: 'invalid.setup-code' });
    }
    if (authActive(before) && (await refuseWrongCurrentPassword(req, res, storedHash, currentPassword))) return;
    const passwordHash = await hashPassword(password, { signal: connectionSignal(res) });
    /* Read again after the awaits. Saving the earlier copy drops any config
       write made in between. */
    const cfg = loadConfigForUpdate();
    if (cfg.settings?.auth?.passwordHash !== storedHash) {
      return json(res, 409, {
        error: 'The password changed during this request.',
        kind: KIND.INVALID,
        code: 'invalid.password-changed',
      });
    }
    storePassword(cfg, passwordHash);
    saveConfig(cfg);
    setupCode.retire();
    log.audit(storedHash ? 'password changed' : 'password set with setup code', {
      ip: getIp(req),
      host: hostOf(req),
    });
    const sessionId = newSessionId();
    setSessionCookie(res, makeToken(sessionId, cfg.settings.auth.secret), isSecureRequest(req));
    json(res, 200, { ok: true });
  } catch (e) {
    if (e.busy) return busy(res);
    fail(res, e, { status: 400 });
  }
});

/* Anyone can post here. Logging every rejection lets them fill the disk. */
const REJECT_LOG_MS = 60_000;
let _rejected = 0;
let _rejectLoggedAt = 0;
let _rejectedIp = '';

function flushRejectedCodes(now = Date.now()) {
  if (!_rejected || now - _rejectLoggedAt < REJECT_LOG_MS) return;
  log.audit('setup code rejected', { ip: _rejectedIp, count: _rejected });
  _rejected = 0;
  _rejectLoggedAt = now;
}
setInterval(flushRejectedCodes, REJECT_LOG_MS).unref();

function noteRejectedCode(ip) {
  _rejected++;
  _rejectedIp = ip;
  flushRejectedCodes();
}

on('POST', '/api/auth/setup-password', async (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED, code: 'blocked.read-only' });
  if (!checkOrigin(req, res)) return;
  const ip = getIp(req);
  try {
    const body = await readAuthBody(req, res);
    if (!body) return;
    const { code, password = '' } = body;
    const current = loadConfig();
    const damaged = passwordDamaged(current);
    if (authActive(current) && !damaged)
      return json(res, 409, { error: 'A password is already set.', kind: KIND.INVALID, code: 'invalid.password-set' });
    if (!damaged && refusedHost(req) === null) return json(res, 404, { error: 'Not found', kind: KIND.INVALID });
    const refused = newPasswordError(password, hostnameOf(req.headers.host) ?? '');
    if (refused) return json(res, 400, { ...refused, kind: KIND.INVALID });
    if (!setupCode.matches(code, damaged ? 'damaged' : 'host')) {
      noteRejectedCode(ip);
      return json(res, 403, { error: 'The setup code is incorrect.', kind: KIND.INVALID, code: 'invalid.setup-code' });
    }
    const passwordHash = await hashPassword(password, { signal: connectionSignal(res) });
    const cfg = loadConfigForUpdate();
    if (authActive(cfg) && !passwordDamaged(cfg))
      return json(res, 409, { error: 'A password is already set.', kind: KIND.INVALID, code: 'invalid.password-set' });
    storePassword(cfg, passwordHash);
    saveConfig(cfg);
    setupCode.retire();
    log.audit(damaged ? 'damaged password replaced with setup code' : 'password set with setup code', {
      ip,
      host: hostOf(req),
    });
    setSessionCookie(res, makeToken(newSessionId(), cfg.settings.auth.secret), isSecureRequest(req));
    json(res, 200, { ok: true });
  } catch (e) {
    if (e.busy) return busy(res);
    fail(res, e, { status: 400 });
  }
});

on('POST', '/api/auth/revoke-sessions', (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED, code: 'blocked.read-only' });
  if (!checkOrigin(req, res)) return;
  const cfg = loadConfig();
  if (!authActive(cfg)) {
    return json(res, 400, {
      error: 'Authentication is not enabled, so there are no sessions to sign out.',
      kind: KIND.INVALID,
    });
  }
  rotateSessionSecret();
  log.audit('sessions revoked', { ip: getIp(req) });
  clearSessionCookie(res, isSecureRequest(req));
  json(res, 200, { ok: true });
});

on('POST', '/api/auth/dismiss-setup', (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED, code: 'blocked.read-only' });
  if (!checkOrigin(req, res)) return;
  const cfg = loadConfigForUpdate();
  cfg.settings = cfg.settings || {};
  cfg.settings.auth = cfg.settings.auth || {};
  cfg.settings.auth.setupPrompted = true;
  saveConfig(cfg);
  json(res, 200, { ok: true });
});

on('POST', '/api/auth/toggle', async (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED, code: 'blocked.read-only' });
  if (!checkOrigin(req, res)) return;
  try {
    const body = await readAuthBody(req, res);
    if (!body) return;
    const { enabled, currentPassword, allowedHosts } = body;
    /* Only a real true or false. Turning protection off deletes the password,
       so an unclear body must change nothing rather than read as "off". */
    if (typeof enabled !== 'boolean') {
      return json(res, 400, { error: 'enabled must be true or false', kind: KIND.INVALID });
    }
    /* Stored in the same write as the switch. Turning protection off starts the
       address check, and a list saved afterwards no longer reaches this page. */
    const hosts = allowedHosts === undefined ? undefined : normalizeHostList(allowedHosts);
    if (hosts === null)
      return json(res, 400, { error: 'allowedHosts must be a list of host names', kind: KIND.INVALID });
    const before = loadConfig();
    if (!enabled) {
      const lost = proxiedNameLost(req, hosts ?? before.settings?.server?.allowedHosts);
      if (lost)
        return json(res, 400, {
          error: `${lost} is not in Allowed Addresses`,
          kind: KIND.INVALID,
          code: 'invalid.keep-current-address',
          detail: { host: lost },
        });
    }
    if (!enabled && authActive(before)) {
      if (await refuseWrongCurrentPassword(req, res, before.settings.auth.passwordHash, currentPassword)) return;
    }
    const cfg = loadConfigForUpdate();
    cfg.settings = cfg.settings || {};
    cfg.settings.auth = cfg.settings.auth || {};
    /* Keep. The check above waits for the hash. A password changed meanwhile
       must not be deleted on the strength of the old one. */
    if (!enabled && authActive(before) && cfg.settings.auth.passwordHash !== before.settings.auth.passwordHash)
      return json(res, 409, { error: 'The password changed.', kind: KIND.INVALID, code: 'invalid.password-changed' });
    /* Auth on with no password stored locks the install: every login is refused
       and setting a password is itself behind the gate. */
    if (enabled && !cfg.settings.auth.passwordHash) {
      return json(res, 400, { error: 'Set a password before turning authentication on.', kind: KIND.INVALID });
    }
    cfg.settings.auth.enabled = !!enabled;
    /* Turning protection off must discard the password and the secret. Keeping
       the hash strands the install: setting a new password needs a session, and
       no session can be obtained while auth is off. */
    const cleared = !enabled && !!cfg.settings.auth.passwordHash;
    stripDisabledCredentials(cfg.settings.auth);
    if (enabled && !cfg.settings.auth.secret) cfg.settings.auth.secret = newSessionSecret();
    if (hosts) cfg.settings.server = { ...cfg.settings.server, allowedHosts: hosts };
    const hadPassword = cleared || !!cfg.settings.auth.passwordHash;
    saveConfig(cfg);
    if (hadPassword) setupCode.retire();
    const who = { ip: getIp(req), host: hostOf(req) };
    log.audit('auth toggled', { enabled: !!enabled, ...who });
    if (cleared) log.audit('password cleared', who);
    json(res, 200, { ok: true });
  } catch (e) {
    if (e.busy) return busy(res);
    fail(res, e, { status: 400 });
  }
});

process.on('exit', () => {
  flushAudit(Number.MAX_SAFE_INTEGER);
  flushRejectedCodes(Number.MAX_SAFE_INTEGER);
});

module.exports = { flushRejectedCodes };
