const { isAuthenticated } = require('./auth');

const PUBLIC_PATHS = new Set(['/health', '/api/auth/login', '/api/auth/check']);

const routes = [];
function on(m, p, h) {
  if (p === '*') { routes.push({ m, p, re:null, names:[], h }); return; }
  const names = [];
  const re = new RegExp('^' + p.replace(/:([^/]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '(?:/|$)');
  routes.push({ m, p, re, names, h });
}

function dispatch(req, res) {
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

/* Sets CORS preflight response headers only. Deliberately does NOT set
   Access-Control-Allow-Origin — the app is same-origin (UI and API share one
   Nginx origin), so no cross-origin access is granted. Renamed from setCORS
   to avoid implying that cross-origin requests are permitted. */
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

module.exports = { on, dispatch, json, readBody, setPreflightHeaders };
