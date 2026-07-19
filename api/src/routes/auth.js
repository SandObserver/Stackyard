const crypto = require('crypto');
const { on, json, readBody, checkOrigin, getIp } = require('../router');
const { IS_DEMO, DEMO_READONLY_MSG } = require('../demo');
const { loadConfig, saveConfig } = require('../config');
const log = require('../log');
const { getOrCreateSecret, hashPassword, verifyPassword, makeToken, setSessionCookie, clearSessionCookie, isSecureRequest, registerLoginAttempt, clearAttempts, isAuthenticated, hasValidSession } = require('../auth');

on('GET', '/api/auth/check', (req, res) => {
  const cfg = loadConfig();
  json(res, 200, {
    enabled: !!(cfg.settings?.auth?.enabled),
    authenticated: isAuthenticated(req),
    passwordSet: !!(cfg.settings?.auth?.passwordHash),
    setupPrompted: !!(cfg.settings?.auth?.setupPrompted),
  });
});

on('POST', '/api/auth/login', async(req, res) => {
  const ip = getIp(req);
  try {
    const { password = '' } = JSON.parse(await readBody(req));
    const cfg = loadConfig();
    if (!cfg.settings?.auth?.enabled) return json(res, 200, { ok:true }); /* auth off, always pass */
    const hash = cfg.settings.auth.passwordHash;
    if (!hash) return json(res, 401, { error:'No password set. Enable auth and set a password in Admin → Server.' });
    const limitErr = registerLoginAttempt(ip);
    if (limitErr) { log.audit('login blocked', { ip, reason:'rate_limit' }); return json(res, 429, { error:limitErr }); }
    const ok = await verifyPassword(password, hash);
    if (!ok) { log.audit('login failed', { ip }); return json(res, 401, { error:'Incorrect password.' }); }
    clearAttempts(ip);
    log.audit('login success', { ip });
    const secret = getOrCreateSecret();
    const sessionId = crypto.randomBytes(24).toString('hex');
    setSessionCookie(res, makeToken(sessionId, secret), isSecureRequest(req));
    json(res, 200, { ok:true });
  } catch(e) { json(res, 400, { error:e.message }); }
});

on('POST', '/api/auth/logout', (req, res) => {
  log.audit('logout', { ip: getIp(req) });
  clearSessionCookie(res, isSecureRequest(req));
  json(res, 200, { ok:true });
});

on('POST', '/api/auth/set-password', async(req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG });
  if (!checkOrigin(req, res)) return;
  try {
    const cfg = loadConfig();
    const hasPassword = !!cfg.settings?.auth?.passwordHash;
    if (hasPassword && !hasValidSession(req)) {
      return json(res, 401, { error:'Authentication required to change the existing password.' });
    }
    const { password = '' } = JSON.parse(await readBody(req));
    if (!password || password.length < 8) return json(res, 400, { error:'Password must be at least 8 characters.' });
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
  } catch(e) { json(res, 400, { error:e.message }); }
});

on('POST', '/api/auth/dismiss-setup', (req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG });
  if (!checkOrigin(req, res)) return;
  const cfg = loadConfig();
  cfg.settings = cfg.settings || {};
  cfg.settings.auth = cfg.settings.auth || {};
  cfg.settings.auth.setupPrompted = true;
  saveConfig(cfg);
  json(res, 200, { ok:true });
});

on('POST', '/api/auth/toggle', async(req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG });
  if (!checkOrigin(req, res)) return;
  try {
    const { enabled } = JSON.parse(await readBody(req));
    const cfg = loadConfig();
    cfg.settings = cfg.settings || {};
    cfg.settings.auth = cfg.settings.auth || {};
    cfg.settings.auth.enabled = !!enabled;
    if (enabled && !cfg.settings.auth.secret)
      cfg.settings.auth.secret = crypto.randomBytes(32).toString('hex');
    saveConfig(cfg);
    log.audit('auth toggled', { enabled: !!enabled });
    json(res, 200, { ok:true });
  } catch(e) { json(res, 400, { error:e.message }); }
});

