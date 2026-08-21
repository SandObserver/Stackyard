const http = require('http');
const https = require('https');
const net = require('net');
const dns = require('dns').promises;
const { loadConfig } = require('./config');
const { PING_MS, FETCH_MS } = require('./timeouts');
const { IS_DEMO } = require('./demo');
const { parseXml } = require('./parse-xml');
const log = require('./log');
const { parsePrometheus } = require('./parse-prometheus');

/* Addresses that are never a legitimate outbound target. A test checks
   docs/security.md against the third column. */
/** @type {Array<[string, number, string]>} */
const BLOCKED_IPV4 = [
  ['0.0.0.0', 8, 'this network (RFC 1122)'],
  ['10.0.0.0', 8, 'private (RFC 1918)'],
  ['100.64.0.0', 10, 'carrier-grade NAT (RFC 6598)'],
  ['127.0.0.0', 8, 'loopback (RFC 1122)'],
  ['169.254.0.0', 16, 'link-local, includes cloud metadata (RFC 3927)'],
  ['172.16.0.0', 12, 'private (RFC 1918)'],
  ['192.0.0.0', 24, 'IETF protocol assignments (RFC 6890)'],
  ['192.168.0.0', 16, 'private (RFC 1918)'],
  ['198.18.0.0', 15, 'benchmarking (RFC 2544)'],
  ['224.0.0.0', 4, 'multicast (RFC 5771)'],
  ['240.0.0.0', 4, 'reserved, includes 255.255.255.255 broadcast (RFC 1112)'],
];

/* ff00::/8 needs all four hex digits. A group written 'ff' is 0x00ff, which is
   not multicast. */
const BLOCKED_IPV6_RE = /^(::1$|::$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:|ff[0-9a-f]{2}:)/i;

/** @param {string} addr @returns {number|null} */
function ipv4ToInt(addr) {
  if (!net.isIPv4(addr)) return null;
  const p = addr.split('.');
  return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3];
}

const _blockedV4 = BLOCKED_IPV4.map(([base, bits]) => ({
  /* A /0 would need a 32-bit shift, which JavaScript treats as a no-op. */
  mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0,
  base: ipv4ToInt(base),
}));

/** @param {string} addr @returns {boolean} */
function isBlockedIPv4(addr) {
  const n = ipv4ToInt(addr);
  if (n === null) return false;
  return _blockedV4.some(r => (n & r.mask) >>> 0 === r.base);
}

/* The range check only understands dotted-decimal. Without this a hex-tailed
   literal such as ::7f00:1 or 64:ff9b::a9fe:a9fe slips past it. */
function embeddedIPv4(addr) {
  if (typeof addr !== 'string') return null;
  const s = addr.toLowerCase();
  const m = s.match(/^(?:::ffff:|64:ff9b::|::)([0-9a-f.:]+)$/);
  if (!m) return null;
  const tail = m[1];
  if (tail.includes('.')) return net.isIPv4(tail) ? tail : null;
  const parts = tail.split(':');
  if (parts.length !== 2) return null;
  const hi = parseInt(parts[0], 16),
    lo = parseInt(parts[1], 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi > 0xffff || lo > 0xffff) return null;
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateAddress(addr) {
  if (typeof addr !== 'string' || !addr) return false;
  const s = addr.toLowerCase();
  if (s.startsWith('::ffff:') || s.startsWith('64:ff9b::')) {
    const v4 = embeddedIPv4(s);
    if (v4) return isBlockedIPv4(v4);
    return true; /* unparseable tail behind a wrapper prefix: refuse */
  }
  if (s.startsWith('::')) {
    const v4 = embeddedIPv4(s);
    if (v4) return isBlockedIPv4(v4);
  }
  return isBlockedIPv4(s) || BLOCKED_IPV6_RE.test(s);
}
/* Never sniff this from the body alone. A plain-text line like "Version 1.2"
   matches the metric grammar exactly. */
function looksLikeMetrics(ct, body) {
  if (ct.includes('openmetrics') || /(^|;)\s*version=0\.0\.\d/.test(ct)) return true;
  return ct.includes('text/plain') && body.includes('# TYPE');
}

const FETCH_SIZE_LIMIT = 4 * 1024 * 1024;
/* Disables SSRF filtering entirely. */
const ALLOW_PRIVATE_IPS = process.env.ALLOW_PRIVATE_IPS === 'true';

function getHostIp() {
  try {
    return loadConfig().settings?.server?.hostIp || '';
  } catch {
    return '';
  }
}

/* URL keeps IPv6 literals bracketed. The range checks do not recognise that
   form. */
const bareHost = hostname => String(hostname ?? '').replace(/^\[|\]$/g, '');

/* A dotless single-label name is a Docker service name. Expects a bare host, so
   run bareHost first. */
const isDockerServiceName = h => !!h && h !== 'localhost' && !h.includes('.') && !h.includes(':');

function isInternalHost(hostname) {
  const h = bareHost(hostname);
  if (!h) return false;
  return h === 'localhost' || isDockerServiceName(h) || isPrivateAddress(h);
}

function shouldSkipTls(hostname, cfg) {
  if (cfg.settings?.server?.skipTlsVerify !== true) return false;
  return isInternalHost(hostname);
}

/* Skip certificate checking for internal hosts only. On a public address the
   only effect is to accept whoever answers, on paths that carry a stored
   credential.

   @param {string} hostname @param {boolean|null|undefined} requested
   @returns {{ skip: boolean, ignored: boolean }} */
function resolveSkipTls(hostname, requested) {
  let wanted;
  if (requested != null) wanted = requested === true;
  else {
    try {
      wanted = loadConfig().settings?.server?.skipTlsVerify === true;
    } catch {
      wanted = false;
    }
  }
  if (!wanted) return { skip: false, ignored: false };
  const internal = isInternalHost(hostname);
  return { skip: internal, ignored: !internal };
}

/* Wording only. It carries no hostname, path or upstream text, which is what
   makes it safe to show verbatim. See api-error.js. */
const SKIP_TLS_IGNORED_MESSAGE =
  'The certificate could not be verified. Allowing a self-signed certificate only applies to addresses on your own ' +
  'network, so it was not used here.';

const TLS_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function rewriteUrl(raw) {
  try {
    const cfg = loadConfig(),
      hostIp = cfg.settings?.server?.hostIp || '';
    if (!hostIp) return raw;
    const u = new URL(raw);
    const m = (cfg.settings?.server?.portMap || {})[u.port];
    if (u.hostname === hostIp && m) {
      u.hostname = m.host;
      u.port = m.port;
    }
    return u.toString();
  } catch {
    return raw;
  }
}

/* Without this an unrecognised scheme becomes an HTTP request, and an empty
   hostname goes to localhost. Checked again where the connection is opened: the
   unchecked entry points skip the guard. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/* A code, never the address. The block message must not repeat what was
   blocked, so the reason travels as this instead. */
const PRIVATE_ADDRESS = 'private-address';

/** @param {URL} u @returns {string|null} */
function urlPolicyError(u) {
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    return `Blocked: only http and https URLs are allowed (got ${u.protocol.replace(':', '')}).`;
  }
  if (!u.hostname) return 'Blocked: URL has no host.';
  return null;
}

async function guardSsrf(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { error: 'Invalid URL', ip: null };
  }
  const policy = urlPolicyError(u);
  if (policy) return { error: policy, ip: null };
  const h = bareHost(u.hostname);
  /* Loopback, not a service name. Block it before the allowance below. */
  if (!ALLOW_PRIVATE_IPS && h === 'localhost')
    return { error: `Blocked: ${h} is a private address.`, ip: null, reason: PRIVATE_ADDRESS };
  if (isDockerServiceName(h)) return { error: null, ip: null };
  const hostIp = getHostIp();
  if (hostIp && h === hostIp) return { error: null, ip: null };
  if (!ALLOW_PRIVATE_IPS && isPrivateAddress(h))
    return { error: `Blocked: ${h} is a private address.`, ip: null, reason: PRIVATE_ADDRESS };
  let address;
  try {
    ({ address } = await dns.lookup(h));
  } catch {
    return { error: `Blocked: ${h} could not be resolved.`, ip: null };
  }
  if (!ALLOW_PRIVATE_IPS && isPrivateAddress(address))
    return { error: `Blocked: ${h} resolves to private IP ${address}.`, ip: null, reason: PRIVATE_ADDRESS };
  /* A literal address cannot be rebound. */
  if (h === address) return { error: null, ip: null };
  return { error: null, ip: address };
}

/* One deadline for a whole outbound attempt. Node's socket `timeout` is an
   inactivity timer and does not bound a stalled DNS lookup, connect or TLS
   handshake.

   @param {number} ms @param {() => void} onExpire
   @returns {{ settle: (fn: Function, arg?: any) => void, expired: () => boolean }} */
function withDeadline(ms, onExpire) {
  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) onExpire();
  }, ms);
  /* Unref'd. A pending request must not hold the process open at shutdown. */
  if (timer.unref) timer.unref();
  return {
    settle(fn, arg) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    },
    expired: () => settled,
  };
}

function fetchJSON(raw, opts = {}) {
  if (IS_DEMO)
    return Promise.resolve({ status: 503, data: null, error: 'Outbound requests are disabled in demo mode' });
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(raw);
    } catch (e) {
      return reject(e);
    }
    const policy = urlPolicyError(u);
    if (policy) return reject(Object.assign(new Error(policy), { kind: 'blocked', status: 403 }));
    let dl = null;
    const done = (fn, arg) => dl.settle(fn, arg);
    const lib = u.protocol === 'https:' ? https : http;
    const port = u.port || (u.protocol === 'https:' ? 443 : 80);
    const { skip: skipTls, ignored: skipIgnored } = resolveSkipTls(u.hostname, opts.skipTls);
    const bodyBuf = opts.body ? Buffer.from(opts.body) : null;
    const hdrs = Object.assign({}, opts.headers || {});
    if (bodyBuf) hdrs['Content-Length'] = bodyBuf.length;
    const pin = opts.pinIp && opts.pinIp !== u.hostname ? opts.pinIp : null;
    if (pin) hdrs['Host'] = u.host;
    /* http.request wants a bare IPv6 address. The bracketed form URL keeps fails
       to resolve. Host header and SNI stay on the bracketed hostname. */
    const connectHost = pin || u.hostname.replace(/^\[|\]$/g, '');
    const req = lib.request(
      {
        hostname: connectHost,
        port,
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers: hdrs,
        servername: pin ? u.hostname : undefined /* keep SNI and cert validation on the real hostname */,
        timeout: opts.timeout || FETCH_MS,
        rejectUnauthorized: !skipTls,
      },
      res => {
        const sc = res.statusCode ?? 0;
        if (sc >= 300 && sc < 400) {
          res.resume();
          return done(reject, new Error(`Redirect blocked (${sc}). Use the final URL directly`));
        }
        const bufs = [];
        let total = 0;
        /* A caller that stores what it receives, rather than parsing it, sets
           its own ceiling. */
        const sizeLimit = Number(opts.maxBytes) > 0 ? Number(opts.maxBytes) : FETCH_SIZE_LIMIT;
        res.on('data', c => {
          total += c.length;
          if (total > sizeLimit) {
            req.destroy();
            return done(reject, new Error('Response too large'));
          }
          bufs.push(c);
        });
        res.on('end', () => {
          /* Before any string conversion. utf8 corrupts image bytes. */
          if (opts.binary)
            return done(resolve, {
              status: res.statusCode,
              data: Buffer.concat(bufs),
              contentType: (res.headers['content-type'] || '').toLowerCase(),
            });
          const body = Buffer.concat(bufs).toString('utf8');
          if (opts.raw) return done(resolve, { status: res.statusCode, data: body });
          const ct = (res.headers['content-type'] || '').toLowerCase();
          try {
            done(resolve, { status: res.statusCode, data: JSON.parse(body) });
          } catch {
            if (looksLikeMetrics(ct, body)) done(resolve, { status: res.statusCode, data: parsePrometheus(body) });
            else if (ct.includes('xml') || body.trimStart().startsWith('<')) {
              const parsed = parseXml(body);
              if (parsed['#truncated']) {
                /* Origin and path only. The query can carry an API key and the
                   authority can carry credentials. */
                log.warn('XML response was too large to read in full', {
                  url: u.origin + u.pathname,
                  bytes: body.length,
                });
              }
              done(resolve, { status: res.statusCode, data: parsed });
            } else done(resolve, { status: res.statusCode, data: body });
          }
        });
      },
    );
    /* Armed here, not earlier: it destroys `req`. */
    dl = withDeadline(opts.timeout || FETCH_MS, () => {
      req.destroy();
      done(reject, new Error('Timed out'));
    });
    req.on('timeout', () => {
      req.destroy();
      done(reject, new Error('Timed out'));
    });
    req.on('error', (/** @type {unknown} */ e) => {
      if (skipIgnored && TLS_ERROR_CODES.has(errCode(e) ?? ''))
        /** @type {{ vouchedMessage?: string }} */ (e).vouchedMessage = SKIP_TLS_IGNORED_MESSAGE;
      done(reject, e);
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function statusDesc(code) {
  if (code === 0) return 'No response';
  if (code < 400) return 'OK';
  if (code === 401) return 'Unauthorised';
  if (code === 403) return 'Forbidden';
  if (code === 404) return 'Not found (but reachable)';
  if (code === 405) return 'Method not allowed';
  if (code === 407) return 'Proxy auth required';
  if (code >= 500) return 'Server error';
  return `HTTP ${code}`;
}

/* Built from the error code, never the message. Filtering messages is fail-open
   and leaks internal hostnames. */
const PING_ERRORS = Object.freeze({
  ECONNREFUSED: 'Connection refused.',
  ENOTFOUND: 'Host not found.',
  EAI_AGAIN: 'Host not found.',
  EHOSTUNREACH: 'Host unreachable.',
  ENETUNREACH: 'Network unreachable.',
  ECONNRESET: 'The connection was reset.',
  EPROTO: 'The service did not speak HTTP.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'The certificate is not trusted.',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'The certificate is not trusted.',
  CERT_HAS_EXPIRED: 'The certificate has expired.',
});

/** @param {unknown} e @returns {string|undefined} */
const errCode = e => (e && typeof e === 'object' && 'code' in e && typeof e.code === 'string' ? e.code : undefined);

/** @param {unknown} e @returns {string} */
const errMessage = e => (e instanceof Error ? e.message : String(e));

/** @param {unknown} e @returns {string} */
function pingErrorText(e) {
  return PING_ERRORS[errCode(e) ?? ''] || 'Could not reach the service.';
}

function pingUrl(raw, ms = PING_MS, skipTls, pinIp) {
  if (IS_DEMO) return Promise.resolve({ ok: false, status: 0, error: 'Outbound requests are disabled in demo mode' });
  return new Promise(resolve => {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return resolve({ ok: false, status: 0, error: 'Invalid URL' });
    }
    const policy = urlPolicyError(u);
    if (policy) return resolve({ ok: false, status: 0, error: policy });
    const lib = u.protocol === 'https:' ? https : http;
    const port = u.port || (u.protocol === 'https:' ? 443 : 80);
    const { skip, ignored: skipIgnored } = resolveSkipTls(u.hostname, skipTls);
    const pin = pinIp && pinIp !== u.hostname ? pinIp : null;
    const connectHost = pin || u.hostname.replace(/^\[|\]$/g, '');
    const opts = { hostname: connectHost, port, path: u.pathname || '/', timeout: ms, rejectUnauthorized: !skip };
    if (pin) {
      opts.headers = { Host: u.host };
      opts.servername = u.hostname;
    }

    /* One deadline for the whole ping. The 405 retry below would otherwise let a
       stalled host take the budget twice over. */
    let current = null;
    const dl = withDeadline(ms, () => {
      if (current) current.destroy();
      dl.settle(resolve, { ok: false, status: 0, error: 'Timed out' });
    });

    const send = (method, onResponse) => {
      const req = lib.request({ ...opts, method }, res => {
        res.resume();
        if (dl.expired()) return;
        onResponse(res.statusCode ?? 0);
      });
      current = req;
      req.on('timeout', () => {
        req.destroy();
        dl.settle(resolve, { ok: false, status: 0, error: 'Timed out' });
      });
      /* This result reaches the browser as-is. Keep the code, never the message:
         the message names the address it failed to reach. */
      req.on('error', (/** @type {unknown} */ e) => {
        /* u.origin only. The authority can carry credentials and the path and
           query can carry an API key. */
        log.warn('ping failed', { url: u.origin, error: errMessage(e) });
        const text = skipIgnored && TLS_ERROR_CODES.has(errCode(e) ?? '') ? SKIP_TLS_IGNORED_MESSAGE : pingErrorText(e);
        dl.settle(resolve, { ok: false, status: 0, error: text, code: errCode(e) });
      });
      req.end();
    };

    send('HEAD', sc => {
      if (sc === 405)
        return send('GET', gsc => dl.settle(resolve, { ok: gsc < 500, status: gsc, desc: statusDesc(gsc) }));
      dl.settle(resolve, { ok: sc < 500, status: sc, desc: statusDesc(sc) });
    });
  });
}

/* ── The outbound boundary ──────────────────────────────────────────────────

   The only supported ways out. Checked is for a URL that arrived in an HTTP
   request. Unchecked is for one from saved config, which only an admin can
   write. Put any new rewrite step above the guard, so the URL checked is the URL
   connected to. */

class SsrfBlockedError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'SsrfBlockedError';
    this.status = 403;
    if (reason) this.detail = { reason };
  }
}

async function fetchChecked(url, opts = {}) {
  /* Before guardSsrf. Its dns.lookup is itself an outbound request. */
  if (IS_DEMO) return fetchJSON(url, opts);
  const target = rewriteUrl(url);
  const guard = await guardSsrf(target);
  if (guard.error) throw new SsrfBlockedError(guard.error, guard.reason);
  return fetchJSON(target, { ...opts, pinIp: guard.ip });
}

function fetchUnchecked(url, opts = {}) {
  return fetchJSON(rewriteUrl(url), opts);
}

function pingUnchecked(url, ms, skipTls) {
  return pingUrl(rewriteUrl(url), ms, skipTls);
}

async function pingChecked(url, ms, skipTls) {
  if (IS_DEMO) return pingUrl(url, ms, skipTls);
  const target = rewriteUrl(url);
  const guard = await guardSsrf(target);
  if (guard.error) throw new SsrfBlockedError(guard.error, guard.reason);
  return pingUrl(target, ms, skipTls, guard.ip);
}

module.exports = {
  fetchChecked,
  fetchUnchecked,
  pingChecked,
  pingUnchecked,
  SsrfBlockedError,
  statusDesc,
  pingErrorText,
  errCode,
  urlPolicyError,
  ALLOWED_PROTOCOLS,
  looksLikeMetrics,
  rewriteUrl,
  getHostIp,
  shouldSkipTls,
  resolveSkipTls,
  SKIP_TLS_IGNORED_MESSAGE,
  isInternalHost,
  isDockerServiceName,
  bareHost,
  isPrivateAddress,
  isBlockedIPv4,
  embeddedIPv4,
  BLOCKED_IPV4,
  _internals: { fetchJSON, pingUrl, guardSsrf },
};
