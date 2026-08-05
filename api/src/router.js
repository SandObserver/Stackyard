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

  if (!PUBLIC_PATHS.has(u.pathname)) {
    if (!isAuthenticated(req)) return json(res, 401, { error:'Unauthorised', auth:true, kind:'auth' });
  }

  for (const r of routes) {
    if (r.m !== method && r.m !== '*') continue;
    if (r.p === '*') return r.h(req, res, u);
    const match = u.pathname.match(r.re);
    if (!match) continue;
    req.params = {};
    /* A parameter that will not percent-decode is a bad request, not a server
       fault: decodeURIComponent throws on an invalid escape, so /api/x/% used to
       answer 500. */
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

/* The largest request body the API will read.

   A body is held in memory before it is parsed, so this is a memory limit as
   much as a size limit, and Stackyard is expected to run on hardware with 512 MB
   or less. The value is therefore the smallest one that comfortably fits real
   use, not the largest one that seems harmless.

   Measured against a config of realistic items: an app entry with monitoring, a
   badge and a container is about 540 bytes, so

     20 apps   ~10 KB
     100 apps  ~52 KB
     300 apps  ~155 KB

   300 apps is already an unusual dashboard, so 2 MB is roughly thirteen times
   the largest configuration anyone is likely to have. The headroom is deliberate:
   it covers a bigger setup than measured here, and it covers the measurement
   itself being unrepresentative.

   This was 4 MB, which had no stated reason and was the largest of three limits
   that disagreed with each other. */
const BODY_LIMIT = 2 * 1024 * 1024;
function readBody(req) {
  return new Promise((res, rej) => {
    const c = []; let total = 0;
    req.on('data', d => { total += d.length; if (total > BODY_LIMIT) { req.destroy(); return rej(new Error('Request body too large')); } c.push(d); });
    req.on('end',  () => res(Buffer.concat(c).toString('utf8')));
    req.on('error', rej);
  });
}

/* The client address, used for rate limiting and audit records.

   Read from X-Real-IP, and only when the request arrived over loopback. Our own
   nginx is the only thing that reaches this port in the shipped container, and it
   sets that header unconditionally, so a client-supplied value cannot survive.
   The loopback check is what makes that reasoning safe rather than assumed: a
   request arriving from anywhere else is treated as unproxied and identified by
   its socket address.

   This replaces a TRUST_PROXY flag that read X-Forwarded-For and took the first
   entry. Neither half worked. nginx never set X-Forwarded-For, so with the flag
   off every request looked like 127.0.0.1 and rate limiting was one shared bucket
   for all clients; with it on, a client-supplied header passed straight through
   and the first entry is the one the client chooses, so the limiter could be
   bypassed by rotating it. The flag was most dangerous in exactly the position an
   operator would turn it on for.

   No header chain is parsed here. When Stackyard sits behind another reverse
   proxy, nginx resolves the real client itself from TRUSTED_PROXY (see
   docker-entrypoint.sh), so $remote_addr and therefore X-Real-IP are already
   correct by the time the request arrives. */
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
