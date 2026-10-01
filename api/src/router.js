const { isAuthenticated, refreshSession } = require('./auth');
const { configDamage } = require('./config');
const { DAMAGE_CODES, HOST_BLOCKED_CODE } = require('../../ui/js/config-recovery-logic.js');
const { refusedHost } = require('./host-check');
const log = require('./log');
const { tryDecode } = require('./percent-decode');

const PUBLIC_PATHS = new Set(['/health', '/api/auth/login', '/api/auth/check']);

const routes = [];
function on(m, p, h) {
  if (p === '*') {
    routes.push({ m, p, re: null, names: [], h });
    return;
  }
  const names = [];
  const re = new RegExp(
    '^' +
      p.replace(/:([^/]+)|[.*+?^${}()|[\]\\]/g, (token, n) => {
        if (!n) return `\\${token}`;
        names.push(n);
        return '([^/]+)';
      }) +
      '/?$',
  );
  routes.push({ m, p, re, names, h });
}

/* Keep dispatch synchronous for http.createServer. A throwing handler must fail
   its own request, not the process. */
function dispatch(req, res) {
  Promise.resolve()
    .then(() => route(req, res))
    .catch(err => onError(req, res, err));
}

function route(req, res) {
  const u = new URL(req.url, 'http://x');
  const method = req.method.toUpperCase();

  if (u.pathname !== '/health') {
    const damage = configDamage();
    if (damage) {
      const { reason, ...detail } = damage;
      return json(res, 503, {
        error: `config file ${reason}`,
        kind: 'internal',
        code: DAMAGE_CODES[reason],
        detail,
      });
    }
  }

  if (u.pathname !== '/health') {
    const host = refusedHost(req, u.pathname);
    if (host !== null) {
      return json(res, 403, {
        error: 'Forbidden: this address is not allowed while no password is set',
        kind: 'blocked',
        code: HOST_BLOCKED_CODE,
        detail: { host: host.slice(0, 255) },
      });
    }
  }

  if (!PUBLIC_PATHS.has(u.pathname)) {
    if (!isAuthenticated(req)) return json(res, 401, { error: 'Unauthorised', auth: true, kind: 'auth' });
    /* Before the handler. A handler that issues its own cookie must replace this
       one. */
    refreshSession(req, res);
  }

  for (const r of routes) {
    if (r.m !== method && r.m !== '*') continue;
    if (r.p === '*') return r.h(req, res, u);
    const match = u.pathname.match(r.re);
    if (!match) continue;
    req.params = {};
    let bad = null;
    for (let i = 0; i < r.names.length; i++) {
      const decoded = tryDecode(match[i + 1] || '');
      if (decoded === null) {
        bad = r.names[i];
        break;
      }
      req.params[r.names[i]] = decoded;
    }
    if (bad) return json(res, 400, { error: `Malformed value for ${bad} in the URL`, kind: 'invalid' });
    return r.h(req, res, u);
  }
  json(res, 404, { error: 'Not found', kind: 'invalid' });
}

function onError(req, res, err) {
  log.error('request handler failed', { method: req.method, url: req.url, error: err?.message });
  if (res.headersSent) {
    try {
      res.end();
    } catch {}
    return;
  }
  try {
    json(res, 500, { error: 'Internal server error', kind: 'internal' });
  } catch {}
}

function json(res, status, data) {
  const b = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
}

/* Buffered in memory before parsing, so this is a memory limit too. */
const BODY_LIMIT = 2 * 1024 * 1024;
function readBody(req) {
  return new Promise((res, rej) => {
    const c = [];
    let total = 0;
    req.on('data', d => {
      total += d.length;
      if (total > BODY_LIMIT) {
        req.destroy();
        return rej(new Error('Request body too large'));
      }
      c.push(d);
    });
    req.on('end', () => res(Buffer.concat(c).toString('utf8')));
    req.on('error', rej);
  });
}

/** Rejects with `oversize: true` past `max` bytes. Do not destroy the request
    there: the client then gets a reset instead of the answer.
    @param {import('http').IncomingMessage} req @param {number} max
    @returns {Promise<Buffer>} */
function readBodyCapped(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', c => {
      if (total > max) return;
      total += c.length;
      if (total > max) {
        chunks.length = 0;
        return reject(Object.assign(new Error('body over the limit'), { oversize: true }));
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* Trust X-Real-IP only over loopback, where our own nginx is the only thing that
   can set it. Do not parse a header chain: nginx has already resolved the real
   client from TRUSTED_PROXY. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function getIp(req) {
  const peer = req.socket?.remoteAddress || '';
  if (LOOPBACK.has(peer)) {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.trim()) return real.trim();
  }
  return peer || 'unknown';
}
/* Every browser sends Origin on a request that changes something, including a
   same-origin one. A write arriving without it did not come from a page on this
   dashboard, so it is refused. */
function checkOrigin(req, res) {
  const origin = req.headers['origin'];
  if (origin) {
    try {
      if (new URL(origin).host === req.headers['host']) return true;
    } catch {
      /* not a URL, so it names no host and cannot match one */
    }
  }
  json(res, 403, {
    error: origin ? 'Forbidden: origin mismatch' : 'Forbidden: this request needs an Origin header',
    kind: 'invalid',
  });
  return false;
}

module.exports = {
  BODY_LIMIT,
  _routeTable: () => routes.map(r => ({ method: r.m, path: r.p })),
  on,
  dispatch,
  json,
  readBody,
  readBodyCapped,
  checkOrigin,
  getIp,
};
