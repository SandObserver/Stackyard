const crypto = require('crypto');
const { loadConfig, saveConfig } = require('./config');
const log = require('./log');

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

async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(`${salt}:${key.toString('hex')}`);
    });
  });
}

async function verifyPassword(password, hash) {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':');
    if (!salt || !key) return resolve(false);
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(crypto.timingSafeEqual(Buffer.from(key, 'hex'), derived));
    });
  });
}

function makeToken(sessionId, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');
  return `${sessionId}.${sig}`;
}

function verifyToken(token, secret) {
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const sessionId = token.slice(0, dot), sig = token.slice(dot + 1);
  if (sig.length !== 64 || !/^[0-9a-f]+$/.test(sig)) return null;
  const expected = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  return sessionId;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = decodeURIComponent(v.join('='));
  }
  return out;
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `ds=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'ds=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
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

function recordFailedAttempt(ip) {
  const now = Date.now();
  const rec = _loginAttempts.get(ip) || { count:0, first:now };
  _loginAttempts.set(ip, { count: rec.count + 1, first: rec.first });
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

function isAuthenticated(req) {
  const cfg = loadConfig();
  if (!cfg.settings?.auth?.enabled) return true;
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
  crypto, getOrCreateSecret, hashPassword, verifyPassword,
  makeToken, verifyToken, parseCookies, setSessionCookie, clearSessionCookie,
  checkRateLimit, recordFailedAttempt, clearAttempts, rateLimit, isAuthenticated, hasValidSession,
  log,
};
