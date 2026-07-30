const crypto = require('crypto');
const { on, json, readBody, checkOrigin, getIp } = require('../router');
const { IS_DEMO, DEMO_READONLY_MSG } = require('../demo');
const { loadConfig, saveConfig } = require('../config');
const log = require('../log');
const { fail, KIND } = require('../api-error');
const { getOrCreateSecret, hashPassword, verifyPassword, makeToken, setSessionCookie, clearSessionCookie, isSecureRequest, registerLoginAttempt, clearAttempts, isAuthenticated, hasValidSession, authActive,
  needsRehash } = require('../auth');

on('GET', '/api/auth/check', (req, res) => {
  const cfg = loadConfig();
  json(res, 200, {
    /* The effective state, not the stored flag. Auth on with no password is
       reported as off because that is how it behaves; showing it as on would put
       a toggle in the admin UI that does not match what the server does. */
    enabled: authActive(cfg),
    authenticated: isAuthenticated(req),
    passwordSet: !!(cfg.settings?.auth?.passwordHash),
    setupPrompted: !!(cfg.settings?.auth?.setupPrompted),
  });
});

on('POST', '/api/auth/login', async(req, res) => {
  if (!checkOrigin(req, res)) return;
  const ip = getIp(req);
  try {
    const { password = '' } = JSON.parse(await readBody(req));
    const cfg = loadConfig();
    if (!authActive(cfg)) return json(res, 200, { ok:true }); /* auth off, always pass */
    const hash = cfg.settings.auth.passwordHash;
    const limitErr = registerLoginAttempt(ip);
    if (limitErr) { log.audit('login blocked', { ip, reason:'rate_limit' }); return json(res, 429, { error:limitErr, kind: KIND.AUTH }); }
    const ok = await verifyPassword(password, hash);
    if (!ok) { log.audit('login failed', { ip }); return json(res, 401, { error:'Incorrect password.', kind: KIND.AUTH }); }
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
    const sessionId = crypto.randomBytes(24).toString('hex');
    setSessionCookie(res, makeToken(sessionId, secret), isSecureRequest(req));
    json(res, 200, { ok:true });
  } catch(e) { fail(res, e, { status:400 }); }
});

on('POST', '/api/auth/logout', (req, res) => {
  if (!checkOrigin(req, res)) return;
  log.audit('logout', { ip: getIp(req) });
  clearSessionCookie(res, isSecureRequest(req));
  json(res, 200, { ok:true });
});

on('POST', '/api/auth/set-password', async(req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  try {
    const cfg = loadConfig();
    const hasPassword = !!cfg.settings?.auth?.passwordHash;
    if (hasPassword && !hasValidSession(req)) {
      return json(res, 401, { error:'Authentication required to change the existing password.', kind: KIND.AUTH });
    }
    const { password = '' } = JSON.parse(await readBody(req));
    if (!password || password.length < 8) return json(res, 400, { error:'Password must be at least 8 characters.', kind: KIND.INVALID });
    cfg.settings = cfg.settings || {};
    cfg.settings.auth = cfg.settings.auth || {};
    cfg.settings.auth.passwordHash = await hashPassword(password);
    cfg.settings.auth.secret = crypto.randomBytes(32).toString('hex');
    cfg.settings.auth.enabled = true;
    cfg.settings.auth.setupPrompted = true;
    saveConfig(cfg);
    log.audit('password changed', {});
    const sessionId = crypto.randomBytes(24).toString('hex');
    setSessionCookie(res, makeToken(sessionId, cfg.settings.auth.secret), isSecureRequest(req));
    json(res, 200, { ok:true });
  } catch(e) { fail(res, e, { status:400 }); }
});

on('POST', '/api/auth/dismiss-setup', (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG, kind: KIND.BLOCKED });
  if (!checkOrigin(req, res)) return;
  const cfg = loadConfig();
  cfg.settings = cfg.settings || {};
  cfg.settings.auth = cfg.settings.auth || {};
  cfg.settings.auth.setupPrompted = true;
  saveConfig(cfg);
  json(res, 200, { ok:true });
});

on('POST', '/api/auth/toggle', async(req, res) => {
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
      return json(res, 400, { error:'Set a password before turning authentication on.', kind: KIND.INVALID });
    }
    cfg.settings.auth.enabled = !!enabled;
    if (enabled && !cfg.settings.auth.secret)
      cfg.settings.auth.secret = crypto.randomBytes(32).toString('hex');
    saveConfig(cfg);
    log.audit('auth toggled', { enabled: !!enabled });
    json(res, 200, { ok:true });
  } catch(e) { fail(res, e, { status:400 }); }
});

