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

on('GET', '/api/auth/check', (req, res) => {
  const cfg = loadConfig();
  json(res, 200, {
    /* The effective state, not the stored flag. Auth on with no password is
       reported as off because that is how it behaves; showing it as on would put
       a toggle in the admin UI that does not match what the server does. */
    enabled: authActive(cfg),
    authenticated: isAuthenticated(req),
    passwordSet: !!cfg.settings?.auth?.passwordHash,
    setupPrompted: !!cfg.settings?.auth?.setupPrompted,
  });
});

on('POST', '/api/auth/login', async (req, res) => {
  if (!checkOrigin(req, res)) return;
  const ip = getIp(req);
  try {
    const { password = '' } = JSON.parse(await readBody(req));
    const cfg = loadConfig();
    if (!authActive(cfg)) return json(res, 200, { ok: true }); /* auth off, always pass */
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
    /* A successful login is the only moment the plaintext is known, so it is the
       only chance to move an old hash to the current format and work factor.
       Failure here must not fail the login: the password is correct either way,
       and the old hash still verifies. */
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
    /* Rotating the secret is what signs other devices out; see
       rotateSessionSecret. Assigned here rather than calling it, because this
       handler already holds the config and saves it once below; calling it
       would load and write a second time. */
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

/* Sign out every device, including this one, without changing the password.
   Before this the only way to do it was to change the password, since that
   rotates the same secret as a side effect. */
on('POST', '/api/auth/revoke-sessions', (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  const cfg = loadConfig();
  /* Nothing to revoke when auth is not in force: there are no sessions to
     invalidate, and rotating would only churn the stored secret. */
  if (!authActive(cfg)) {
    return json(res, 400, {
      error: 'Authentication is not enabled, so there are no sessions to sign out.',
      kind: KIND.INVALID,
    });
  }
  const secret = rotateSessionSecret();
  log.audit('sessions revoked', { ip: getIp(req) });
  /* The caller's own token was signed with the old secret and is now invalid, so
     replace it in this response. Without this the person who pressed the button
     is the one signed out. */
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
    const cfg = loadConfig();
    cfg.settings = cfg.settings || {};
    cfg.settings.auth = cfg.settings.auth || {};
    /* Switching auth on with no password stored locks the install: every login
       is refused because there is nothing to check against, and setting a
       password is itself behind the gate. Refuse instead of creating that
       state. */
    if (enabled && !cfg.settings.auth.passwordHash) {
      return json(res, 400, { error: 'Set a password before turning authentication on.', kind: KIND.INVALID });
    }
    cfg.settings.auth.enabled = !!enabled;
    /* Turning protection off discards the password with it. Keeping the hash
       strands the install: setting a new password needs a session, no session
       can be obtained while auth is off, and login is a bypass that issues no
       cookie, so a forgotten password could only be replaced by editing the
       config on disk. The secret goes too, so tokens signed under it cannot be
       honoured if protection is turned back on later. */
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
