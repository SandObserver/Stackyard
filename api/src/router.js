const { isAuthenticated, refreshSession } = require('./auth');
const { configDamage } = require('./config');
const { CONFIG_MAX_BYTES } = require('../../ui/js/limits.js');
const { DAMAGE_CODES, HOST_BLOCKED_CODE } = require('../../ui/js/config-recovery-logic.js');
const { refusedHost } = require('./host-check');
const setupCode = require('./setup-code');
const log = require('./log');
const { tryDecode } = require('./percent-decode');
const { randomBytes } = require('node:crypto');
const { LOOPBACK, proxied } = require('./front-proxy');

const SETUP_PATH = '/api/auth/setup-password';
const PUBLIC_PATHS = new Set(['/health', '/api/auth/login', '/api/auth/check', '/api/csp-report', SETUP_PATH]);

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
/** @type {WeakMap<import('http').ServerResponse, string>} */
const _requestIds = new WeakMap();

/** @param {import('http').ServerResponse} res @returns {string} */
const requestIdOf = res => _requestIds.get(res) || '';

function dispatch(req, res) {
  const id = randomBytes(4).toString('hex');
  _requestIds.set(res, id);
  res.setHeader('X-Request-Id', id);
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

  if (u.pathname !== '/health' && u.pathname !== SETUP_PATH) {
    const host = refusedHost(req);
    if (host !== null) {
      setupCode.announce();
      return json(res, 403, {
        error: 'Forbidden: this address is not allowed while no password is set',
        kind: 'blocked',
        code: HOST_BLOCKED_CODE,
        detail: proxied(req) ? { host: host.slice(0, 255), proxied: true } : { host: host.slice(0, 255) },
      });
    }
  }

  if (!PUBLIC_PATHS.has(u.pathname)) {
    if (!isAuthenticated(req))
      return json(res, 401, { error: 'Unauthorised', auth: true, kind: 'auth', code: 'auth.session' });
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

/* Never log the first stack line. It repeats the message, and a SyntaxError
   message quotes the body it failed on, passwords and keys included. */
function stackFrames(err) {
  return typeof err?.stack === 'string' ? err.stack.split('\n').slice(1, 9).join('\n') : undefined;
}

function onError(req, res, err) {
  log.error('request handler failed', {
    request: requestIdOf(res),
    method: req.method,
    path: String(req.url || '').split('?')[0],
    error: err instanceof SyntaxError ? 'not valid JSON' : err?.message,
    stack: stackFrames(err),
  });
  if (res.headersSent) {
    try {
      res.end();
    } catch {}
    return;
  }
  try {
    const code = typeof err?.apiCode === 'string' ? { code: err.apiCode } : {};
    json(res, err?.apiCode ? err.status || 500 : 500, { error: 'Internal server error', kind: 'internal', ...code });
  } catch {}
}

/** @param {import('http').ServerResponse} res @param {number} status @param {any} data
    @param {Record<string, string>} [headers] */
function json(res, status, data, headers = {}) {
  const id = requestIdOf(res);
  const tagged =
    status >= 400 && id && data && typeof data === 'object' && ('error' in data || 'kind' in data)
      ? { ...data, requestId: id }
      : data;
  const b = JSON.stringify(tagged);
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
}

/** Whether an If-None-Match header names `etag`, compared weakly, or is `*`.
    @param {unknown} header @param {string} etag */
const tagMatches = (header, etag) => {
  const value = String(header || '').trim();
  return value === '*' || value.split(',').some(t => t.trim().replace(/^W\//, '') === etag);
};

/* Buffered in memory before parsing, so this is a memory limit too. */
const BODY_LIMIT = CONFIG_MAX_BYTES;
/* Sign-in routes take bodies before any session check. Raising this lets
   parallel requests exhaust the API's memory. The largest real body is ~20 KB. */
const AUTH_BODY_LIMIT = 32 * 1024;
function readBody(req, max = BODY_LIMIT) {
  return readBodyCapped(req, max).then(b => b.toString('utf8'));
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
const ORIGIN_LOG_MS = 10 * 60 * 1000;
/** @type {Map<string, number>} */
const _originLoggedAt = new Map();

function checkOrigin(req, res) {
  const origin = req.headers['origin'];
  let originHost = '';
  if (origin) {
    try {
      originHost = new URL(origin).host;
      if (originHost === req.headers['host']) return true;
    } catch {
      /* not a URL, so it names no host and cannot match one */
    }
  }
  const reason = origin ? 'mismatch' : 'missing';
  const now = Date.now();
  if (now - (_originLoggedAt.get(reason) ?? -Infinity) >= ORIGIN_LOG_MS) {
    _originLoggedAt.set(reason, now);
    log.warn('write refused: the Origin header does not match the Host header', {
      reason,
      path: req.url.split('?')[0].slice(0, 100),
      origin: originHost.slice(0, 255),
      host: String(req.headers['host'] ?? '').slice(0, 255),
    });
  }
  json(res, 403, {
    error: origin ? 'Forbidden: origin mismatch' : 'Forbidden: this request needs an Origin header',
    kind: 'invalid',
    code: 'invalid.origin',
  });
  return false;
}

module.exports = {
  requestIdOf,
  BODY_LIMIT,
  AUTH_BODY_LIMIT,
  _routeTable: () => routes.map(r => ({ method: r.m, path: r.p })),
  _resetOriginLog: () => _originLoggedAt.clear(),
  on,
  dispatch,
  json,
  tagMatches,
  readBody,
  readBodyCapped,
  checkOrigin,
  getIp,
};
