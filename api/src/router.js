const { isAuthenticated } = require('./auth');
const log = require('./log');

const PUBLIC_PATHS = new Set(['/health', '/api/auth/login', '/api/auth/check']);

const routes = [];
function on(m, p, h) {
  if (p === '*') { routes.push({ m, p, re:null, names:[], h }); return; }
  const names = [];
  const re = new RegExp('^' + p.replace(/:([^/]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
  routes.push({ m, p, re, names, h });
}

/* Any error a handler throws or rejects with is caught here and turned into a
   500 for that one request, instead of propagating to the server and taking the
   whole process down. dispatch stays synchronous for http.createServer while
   route() is free to run async handlers. */
function dispatch(req, res) {
  Promise.resolve().then(() => route(req, res)).catch(err => onError(req, res, err));
}

function route(req, res) {
  const u      = new URL(req.url, 'http://x');
  const method = req.method.toUpperCase();
  setPreflightHeaders(res);

  if (method !== 'OPTIONS' && !PUBLIC_PATHS.has(u.pathname)) {
    if (!isAuthenticated(req)) return json(res, 401, { error:'Unauthorised', auth:true });
  }

  for (const r of routes) {
    if (r.m !== method && r.m !== '*') continue;
    if (r.p === '*') return r.h(req, res, u);
    const match = u.pathname.match(r.re);
    if (!match) continue;
    req.params = {};
    r.names.forEach((n, i) => { req.params[n] = decodeURIComponent(match[i + 1] || ''); });
    return r.h(req, res, u);
  }
  json(res, 404, { error:'Not found' });
}

function onError(req, res, err) {
  log.error('request handler failed', { method: req.method, url: req.url, error: err?.message });
  if (res.headersSent) { try { res.end(); } catch {} return; }
  try { json(res, 500, { error:'Internal server error' }); } catch {}
}

function setPreflightHeaders(res) {
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}

function json(res, status, data) {
  const b = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(b) });
  res.end(b);
}

const BODY_LIMIT = 4 * 1024 * 1024;
function readBody(req) {
  return new Promise((res, rej) => {
    const c = []; let total = 0;
    req.on('data', d => { total += d.length; if (total > BODY_LIMIT) { req.destroy(); return rej(new Error('Request body too large')); } c.push(d); });
    req.on('end',  () => res(Buffer.concat(c).toString('utf8')));
    req.on('error', rej);
  });
}

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
function getIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',').map(s => s.trim()).filter(Boolean)[0];
  }
  return req.socket?.remoteAddress || 'unknown';
}
function checkOrigin(req, res) {
  const origin = req.headers['origin'];
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const serverHost = req.headers['host'];
    if (originHost === serverHost) return true;
  } catch {}
  json(res, 403, { error:'Forbidden: origin mismatch' });
  return false;
}

module.exports = { on, dispatch, json, readBody, setPreflightHeaders, checkOrigin, getIp };
