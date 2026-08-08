const { isAuthenticated } = require('./auth');
const log = require('./log');
const { tryDecode } = require('./percent-decode');

const PUBLIC_PATHS = new Set(['/health', '/api/auth/login', '/api/auth/check']);

const routes = [];
function on(m, p, h) {
  if (p === '*') { routes.push({ m, p, re:null, names:[], h }); return; }
  const names = [];
  const re = new RegExp('^' + p.replace(/:([^/]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
  routes.push({ m, p, re, names, h });
}

/* A throwing handler must fail its own request, not the process. dispatch stays
   synchronous for http.createServer while route() runs async handlers. */
function dispatch(req, res) {
  Promise.resolve().then(() => route(req, res)).catch(err => onError(req, res, err));
}

function route(req, res) {
  const u      = new URL(req.url, 'http://x');
  const method = req.method.toUpperCase();

  if (!PUBLIC_PATHS.has(u.pathname)) {
    if (!isAuthenticated(req)) return json(res, 401, { error:'Unauthorised', auth:true, kind:'auth' });
  }

  for (const r of routes) {
    if (r.m !== method && r.m !== '*') continue;
    if (r.p === '*') return r.h(req, res, u);
    const match = u.pathname.match(r.re);
    if (!match) continue;
    req.params = {};
    /* decodeURIComponent throws on an invalid escape, which is a bad request,
       not a server fault. */
    let bad = null;
    for (let i = 0; i < r.names.length; i++) {
      const decoded = tryDecode(match[i + 1] || '');
      if (decoded === null) { bad = r.names[i]; break; }
      req.params[r.names[i]] = decoded;
    }
    if (bad) return json(res, 400, { error: `Malformed value for ${bad} in the URL`, kind: 'invalid' });
    return r.h(req, res, u);
  }
  json(res, 404, { error:'Not found', kind:'invalid' });
}

function onError(req, res, err) {
  log.error('request handler failed', { method: req.method, url: req.url, error: err?.message });
  if (res.headersSent) { try { res.end(); } catch {} return; }
  try { json(res, 500, { error:'Internal server error', kind:'internal' }); } catch {}
}

function json(res, status, data) {
  const b = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(b) });
  res.end(b);
}

/* Buffered in memory before parsing, so this is a memory limit as much as a size
   one: a 300-app config is about 155 KB. */
const BODY_LIMIT = 2 * 1024 * 1024;
function readBody(req) {
  return new Promise((res, rej) => {
    const c = []; let total = 0;
    req.on('data', d => { total += d.length; if (total > BODY_LIMIT) { req.destroy(); return rej(new Error('Request body too large')); } c.push(d); });
    req.on('end',  () => res(Buffer.concat(c).toString('utf8')));
    req.on('error', rej);
  });
}

/* The client address, for rate limiting and audit records.

   X-Real-IP is trusted only over loopback, where our own nginx is the only thing
   that can set it; anything else is identified by its socket address. No header
   chain is parsed: nginx has already resolved the real client from TRUSTED_PROXY
   (see docker-entrypoint.sh). */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function getIp(req) {
  const peer = req.socket?.remoteAddress || '';
  if (LOOPBACK.has(peer)) {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.trim()) return real.trim();
  }
  return peer || 'unknown';
}
function checkOrigin(req, res) {
  const origin = req.headers['origin'];
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const serverHost = req.headers['host'];
    if (originHost === serverHost) return true;
  } catch {}
  json(res, 403, { error:'Forbidden: origin mismatch', kind:'invalid' });
  return false;
}

module.exports = {
  BODY_LIMIT, on, dispatch, json, readBody, checkOrigin, getIp };
