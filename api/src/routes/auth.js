const { on, json, readBody, checkOrigin, getIp } = require('../router');
const { IS_DEMO, DEMO_READONLY_MSG } = require('../demo');
const { loadConfig, saveConfig } = require('../config');
const log = require('../log');
const { fail, KIND } = require('../api-error');
const {
  getOrCreateSecret,
  rotateSessionSecret,
  newSessionSecret,
  newSessionId,
  hashPassword,
  verifyPassword,
  makeToken,
  setSessionCookie,
  clearSessionCookie,
  isSecureRequest,
  registerLoginAttempt,
  clearAttempts,
  isAuthenticated,
  hasValidSession,
  authActive,
  needsRehash,
} = require('../auth');

/* Answers before sign-in. Say only what the login screen has to decide. The
   setup fields describe the install and are added only once the caller is
   through. */
on('GET', '/api/auth/check', (req, res) => {
  const cfg = loadConfig();
  const authenticated = isAuthenticated(req);
  const body = {
    /* The effective state, not the stored flag. */
    enabled: authActive(cfg),
    authenticated,
  };
  if (authenticated) {
    body.passwordSet = !!cfg.settings?.auth?.passwordHash;
    body.setupPrompted = !!cfg.settings?.auth?.setupPrompted;
  }
  json(res, 200, body);
});

on('POST', '/api/auth/login', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  const ip = getIp(req);
  try {
    const { password = '' } = JSON.parse(await readBody(req));
    const cfg = loadConfig();
    if (!authActive(cfg)) return json(res, 200, { ok: true });
    const hash = cfg.settings.auth.passwordHash;
    const limitErr = registerLoginAttempt(ip);
    if (limitErr) {
      log.audit('login blocked', { ip, reason: 'rate_limit' });
      return json(res, 429, { error: limitErr, kind: KIND.AUTH });
    }
    const ok = await verifyPassword(password, hash);
    if (!ok) {
      log.audit('login failed', { ip });
      return json(res, 401, { error: 'Incorrect password.', kind: KIND.AUTH });
    }
    clearAttempts(ip);
    log.audit('login success', { ip });
    /* A failure here must not fail the login. The password is correct either
       way and the old hash still verifies. */
    if (needsRehash(hash)) {
      try {
        const fresh = loadConfig();
        if (fresh.settings?.auth?.passwordHash === hash) {
          fresh.settings.auth.passwordHash = await hashPassword(password);
          saveConfig(fresh);
          log.info('password hash upgraded to the current format', {});
        }
      } catch (e) {
        log.warn('could not upgrade the stored password hash', { error: e.message });
      }
    }
    const secret = getOrCreateSecret();
    const sessionId = newSessionId();
    setSessionCookie(res, makeToken(sessionId, secret), isSecureRequest(req));
    json(res, 200, { ok: true });
  } catch (e) {
    fail(res, e, { status: 400 });
  }
});

on('POST', '/api/auth/logout', (req, res) => {
  if (!checkOrigin(req, res)) return;
  log.audit('logout', { ip: getIp(req) });
  clearSessionCookie(res, isSecureRequest(req));
  json(res, 200, { ok: true });
});

on('POST', '/api/auth/set-password', async (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  try {
    const cfg = loadConfig();
    const hasPassword = !!cfg.settings?.auth?.passwordHash;
    if (hasPassword && !hasValidSession(req)) {
      return json(res, 401, { error: 'Authentication required to change the existing password.', kind: KIND.AUTH });
    }
    const { password = '' } = JSON.parse(await readBody(req));
    if (!password || password.length < 8)
      return json(res, 400, { error: 'Password must be at least 8 characters.', kind: KIND.INVALID });
    cfg.settings = cfg.settings || {};
    cfg.settings.auth = cfg.settings.auth || {};
    cfg.settings.auth.passwordHash = await hashPassword(password);
    /* Rotating the secret is what signs other devices out. Assigned here rather
       than calling rotateSessionSecret, which would load and write again. */
    cfg.settings.auth.secret = newSessionSecret();
    cfg.settings.auth.enabled = true;
    cfg.settings.auth.setupPrompted = true;
    saveConfig(cfg);
    log.audit('password changed', {});
    const sessionId = newSessionId();
    setSessionCookie(res, makeToken(sessionId, cfg.settings.auth.secret), isSecureRequest(req));
    json(res, 200, { ok: true });
  } catch (e) {
    fail(res, e, { status: 400 });
  }
});

on('POST', '/api/auth/revoke-sessions', (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  const cfg = loadConfig();
  if (!authActive(cfg)) {
    return json(res, 400, {
      error: 'Authentication is not enabled, so there are no sessions to sign out.',
      kind: KIND.INVALID,
    });
  }
  const secret = rotateSessionSecret();
  log.audit('sessions revoked', { ip: getIp(req) });
  /* The caller's own token was signed with the old secret. Replace it in this
     response, or the person who pressed the button is the one signed out. */
  const sessionId = newSessionId();
  setSessionCookie(res, makeToken(sessionId, secret), isSecureRequest(req));
  json(res, 200, { ok: true });
});

on('POST', '/api/auth/dismiss-setup', (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  const cfg = loadConfig();
  cfg.settings = cfg.settings || {};
  cfg.settings.auth = cfg.settings.auth || {};
  cfg.settings.auth.setupPrompted = true;
  saveConfig(cfg);
  json(res, 200, { ok: true });
});

on('POST', '/api/auth/toggle', async (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  try {
    const { enabled } = JSON.parse(await readBody(req));
    /* Only a real true or false. Turning protection off deletes the password,
       so an unclear body must change nothing rather than read as "off". */
    if (typeof enabled !== 'boolean') {
      return json(res, 400, { error: 'enabled must be true or false', kind: KIND.INVALID });
    }
    const cfg = loadConfig();
    cfg.settings = cfg.settings || {};
    cfg.settings.auth = cfg.settings.auth || {};
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
    if (!enabled) {
      delete cfg.settings.auth.passwordHash;
      delete cfg.settings.auth.secret;
    }
    if (enabled && !cfg.settings.auth.secret) cfg.settings.auth.secret = newSessionSecret();
    saveConfig(cfg);
    log.audit('auth toggled', { enabled: !!enabled });
    if (cleared) log.audit('password cleared', {});
    json(res, 200, { ok: true });
  } catch (e) {
    fail(res, e, { status: 400 });
  }
});
