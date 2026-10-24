const http = require('http');
const https = require('https');
const net = require('net');
const resolver = require('./resolve');
const { loadConfig } = require('./config');
const { PING_MS, FETCH_MS } = require('./timeouts');
const { IS_DEMO } = require('./demo');
const { parseXml } = require('./parse-xml');
const log = require('./log');
const { parsePrometheus } = require('./parse-prometheus');
const websocket = require('./websocket');

/* Addresses that are never a legitimate outbound target. */
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
const BLOCKED_IPV6_RE = /^(::1$|::$|f[cd][0-9a-f]{2}:|fe[89a-f][0-9a-f]:|ff[0-9a-f]{2}:|2002:|64:ff9b:1:)/i;

/* Refused for a Docker service name too. These reach this machine or the cloud
   metadata service, never another container. */
const SELF_IPV4 = new Set(['0.0.0.0', '127.0.0.0', '169.254.0.0']);
const SELF_IPV6_RE = /^(::1$|::$|fe[89ab][0-9a-f]:)/i;

/** @param {string} addr @returns {number|null} */
function ipv4ToInt(addr) {
  if (!net.isIPv4(addr)) return null;
  const p = addr.split('.');
  return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3];
}

/** @param {Array<[string, number, string]>} list */
const toRanges = list =>
  list.map(([base, bits]) => ({
    /* A /0 would need a 32-bit shift, which JavaScript treats as a no-op. */
    mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0,
    base: ipv4ToInt(base),
  }));

const _blockedV4 = toRanges(BLOCKED_IPV4);
const _selfV4 = toRanges(BLOCKED_IPV4.filter(([base]) => SELF_IPV4.has(base)));

/** @param {string} addr @param {Array<{ mask: number, base: number | null }>} ranges */
function inRanges(addr, ranges) {
  const n = ipv4ToInt(addr);
  if (n === null) return false;
  return ranges.some(r => (n & r.mask) >>> 0 === r.base);
}

/** @param {string} addr @returns {boolean} */
const isBlockedIPv4 = addr => inRanges(addr, _blockedV4);

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

function inAddressSet(addr, v4Ranges, v6Re) {
  if (typeof addr !== 'string' || !addr) return false;
  const s = addr.toLowerCase();
  if (s.startsWith('::ffff:') || s.startsWith('64:ff9b::')) {
    const v4 = embeddedIPv4(s);
    if (v4) return inRanges(v4, v4Ranges);
    return true; /* unparseable tail behind a wrapper prefix: refuse */
  }
  if (s.startsWith('::')) {
    const v4 = embeddedIPv4(s);
    if (v4) return inRanges(v4, v4Ranges);
  }
  return inRanges(s, v4Ranges) || v6Re.test(s);
}

/** @param {string} addr @returns {boolean} */
const isPrivateAddress = addr => inAddressSet(addr, _blockedV4, BLOCKED_IPV6_RE);

/** Loopback, unspecified or link-local. @param {string} addr @returns {boolean} */
const isSelfAddress = addr => inAddressSet(addr, _selfV4, SELF_IPV6_RE);
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
const UNRESOLVED = 'unresolved';

/** @param {URL} u @returns {string|null} */
function urlPolicyError(u) {
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    return `Blocked: only http and https URLs are allowed (got ${u.protocol.replace(':', '')}).`;
  }
  if (!u.hostname) return 'Blocked: URL has no host.';
  return null;
}

/** @param {string} host @param {number} ms */
function lookupWithin(host, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms);
    if (timer.unref) timer.unref();
    resolver.resolveHost(host, ms).then(
      r => {
        clearTimeout(timer);
        resolve(r);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function guardSsrf(rawUrl, ms = FETCH_MS) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { error: 'Invalid URL', ip: null };
  }
  const policy = urlPolicyError(u);
  if (policy) return { error: policy, ip: null };
  const h = bareHost(u.hostname);
  if (!ALLOW_PRIVATE_IPS && h === 'localhost')
    return { error: `Blocked: ${h} is a private address.`, ip: null, reason: PRIVATE_ADDRESS };
  const hostIp = getHostIp();
  if (hostIp && h === hostIp) return { error: null, ip: null };
  if (!ALLOW_PRIVATE_IPS && isPrivateAddress(h))
    return { error: `Blocked: ${h} is a private address.`, ip: null, reason: PRIVATE_ADDRESS };
  let address;
  try {
    ({ address } = await lookupWithin(h, ms));
  } catch (e) {
    if (e instanceof Error && e.message === 'Timed out') throw e;
    return { error: `Blocked: ${h} could not be resolved.`, ip: null, reason: UNRESOLVED };
  }
  const refused = isDockerServiceName(h) ? isSelfAddress(address) : isPrivateAddress(address);
  if (!ALLOW_PRIVATE_IPS && refused)
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
        lookup: resolver.lookupWithin(opts.timeout || FETCH_MS),
        rejectUnauthorized: !skipTls,
      },
      res => {
        const sc = res.statusCode ?? 0;
        if (sc >= 300 && sc < 400) {
          req.destroy();
          const e = new Error(`Redirect blocked (${sc}). Use the final URL directly`);
          /* Wording only, and a status this project read. Safe to show. */
          /** @type {any} */ (e).vouchedMessage =
            `The address answered with a redirect (HTTP ${sc}). Enter the address it points to.`;
          /** @type {any} */ (e).kind = 'upstream';
          /** @type {any} */ (e).apiCode = 'upstream.redirect';
          /** @type {any} */ (e).detail = { status: sc };
          return done(reject, e);
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
            return done(reject, Object.assign(new Error('Response too large'), { responseTooLarge: true }));
          }
          bufs.push(c);
        });
        res.on('error', e => done(reject, e));
        res.on('end', () => {
          /* Before any string conversion. utf8 corrupts image bytes. */
          if (opts.binary)
            return done(resolve, {
              status: res.statusCode,
              data: Buffer.concat(bufs),
              contentType: (res.headers['content-type'] || '').toLowerCase(),
            });
          const body = Buffer.concat(bufs).toString('utf8');
          /* Keep headers opt-in. Some widgets return the reply as is, and headers can carry cookies. */
          const reply = data =>
            opts.withHeaders
              ? { status: res.statusCode, data, headers: res.headers }
              : { status: res.statusCode, data };
          if (opts.raw) return done(resolve, reply(body));
          const ct = (res.headers['content-type'] || '').toLowerCase();
          try {
            done(resolve, reply(JSON.parse(body)));
          } catch {
            if (looksLikeMetrics(ct, body)) done(resolve, reply(parsePrometheus(body)));
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
              done(resolve, reply(parsed));
            } else done(resolve, reply(body));
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
      if (skipIgnored && TLS_ERROR_CODES.has(errCode(e) ?? '')) {
        /** @type {{ vouchedMessage?: string }} */ (e).vouchedMessage = SKIP_TLS_IGNORED_MESSAGE;
        /** @type {{ apiCode?: string }} */ (e).apiCode = 'network.tls-ignored';
      }
      done(reject, e);
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

/** @param {string} raw
   @param {{ headers?: Record<string, string>, skipTls?: boolean, pinIp?: string|null,
     maxBytes?: number, timeout?: number, signal?: AbortSignal }} [opts] */
function openWebSocket(raw, opts = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(raw);
    } catch (e) {
      return reject(e);
    }
    const policy = urlPolicyError(u);
    if (policy) return reject(Object.assign(new Error(policy), { kind: 'blocked', status: 403 }));
    const signal = opts.signal;
    if (signal?.aborted) return reject(signal.reason);
    const secure = u.protocol === 'https:';
    const { skip: skipTls, ignored: skipIgnored } = resolveSkipTls(u.hostname, opts.skipTls);
    const key = websocket.handshakeKey();
    /** @type {Record<string, string>} */
    const headers = {
      ...(opts.headers || {}),
      Connection: 'Upgrade',
      Upgrade: 'websocket',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': key,
    };
    const pin = opts.pinIp && opts.pinIp !== u.hostname ? opts.pinIp : null;
    if (pin) headers.Host = u.host;
    let settled = false;
    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn(arg);
    };
    const req = (secure ? https : http).request({
      hostname: pin || u.hostname.replace(/^\[|\]$/g, ''),
      port: u.port || (secure ? 443 : 80),
      path: u.pathname + u.search,
      headers,
      servername: pin ? u.hostname : undefined,
      lookup: resolver.lookupWithin(opts.timeout || FETCH_MS),
      rejectUnauthorized: !skipTls,
      agent: false,
    });
    function onAbort() {
      req.destroy();
      settle(reject, signal?.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('response', res => {
      res.destroy();
      req.destroy();
      const sc = res.statusCode ?? 0;
      settle(
        reject,
        Object.assign(new Error(`WebSocket upgrade refused (HTTP ${sc})`), { kind: 'upstream', status: sc }),
      );
    });
    req.on('upgrade', (res, socket, head) => {
      const accepted =
        String(res.headers.upgrade || '').toLowerCase() === 'websocket' &&
        res.headers['sec-websocket-accept'] === websocket.acceptFor(key);
      if (!accepted || settled) {
        socket.destroy();
        return settle(reject, Object.assign(new Error('The WebSocket handshake failed.'), { kind: 'upstream' }));
      }
      const conn = websocket.wrapSocket(socket, head, { maxBytes: opts.maxBytes });
      signal?.addEventListener('abort', () => conn.destroy(signal.reason), { once: true });
      settle(resolve, conn);
    });
    req.on('error', (/** @type {unknown} */ e) => {
      if (skipIgnored && TLS_ERROR_CODES.has(errCode(e) ?? '')) {
        /** @type {{ vouchedMessage?: string }} */ (e).vouchedMessage = SKIP_TLS_IGNORED_MESSAGE;
        /** @type {{ apiCode?: string }} */ (e).apiCode = 'network.tls-ignored';
      }
      settle(reject, e);
    });
    req.end();
  });
}

/** @template T
   @param {string} raw @param {NonNullable<Parameters<typeof openWebSocket>[1]>} opts
   @param {(session: ReturnType<typeof websocket.rpcSession>) => Promise<T>} fn @returns {Promise<T>} */
async function jsonRpc(raw, opts, fn) {
  if (IS_DEMO) throw Object.assign(new Error('Outbound requests are disabled in demo mode'), { kind: 'blocked' });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error('Timed out')), opts.timeout || FETCH_MS);
  timer.unref();
  let conn = null;
  try {
    conn = await openWebSocket(raw, { ...opts, signal: ac.signal });
    const session = websocket.rpcSession(conn);
    return await Promise.race([fn(session), session.failed]);
  } finally {
    clearTimeout(timer);
    conn?.close();
  }
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

/* API codes. `code` reaches the browser, which translates it. Never send Node's
   syscall name there. */
const PING_CODES = Object.freeze({
  ECONNREFUSED: 'network.refused',
  ENOTFOUND: 'network.not-found',
  EAI_AGAIN: 'network.not-found',
  EHOSTUNREACH: 'network.unreachable',
  ENETUNREACH: 'network.unreachable',
  ECONNRESET: 'network.reset',
  EPROTO: 'network.not-http',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'network.self-signed',
  SELF_SIGNED_CERT_IN_CHAIN: 'network.self-signed',
  CERT_HAS_EXPIRED: 'network.tls-expired',
});

/** @param {unknown} e @param {boolean} skipIgnored @param {string} hostname @returns {string} */
function pingCode(e, skipIgnored, hostname) {
  const code = errCode(e) ?? '';
  if (TLS_ERROR_CODES.has(code)) {
    if (skipIgnored) return 'network.tls-ignored';
    const mapped = PING_CODES[code] || 'network.tls-untrusted';
    return mapped === 'network.self-signed' && !isInternalHost(hostname) ? 'network.self-signed-public' : mapped;
  }
  if (code.startsWith('HPE_')) return 'network.not-http';
  return PING_CODES[code] || 'network';
}

/** @param {string} error */
const pingInvalid = error => ({ ok: false, status: 0, error, kind: 'invalid', code: 'invalid.url' });

const PING_TIMED_OUT = Object.freeze({
  ok: false,
  status: 0,
  error: 'Timed out',
  kind: 'timeout',
  code: 'timeout.no-answer',
});

function pingUrl(raw, ms = PING_MS, skipTls, pinIp) {
  if (IS_DEMO) {
    return Promise.resolve({
      ok: false,
      status: 0,
      error: 'Outbound requests are disabled in demo mode',
      kind: 'blocked',
      code: 'blocked.demo',
    });
  }
  return new Promise(resolve => {
    let u;
    try {
      u = new URL(raw);
    } catch {
      return resolve(pingInvalid('Invalid URL'));
    }
    const policy = urlPolicyError(u);
    if (policy) return resolve(pingInvalid(policy));
    const lib = u.protocol === 'https:' ? https : http;
    const port = u.port || (u.protocol === 'https:' ? 443 : 80);
    const { skip, ignored: skipIgnored } = resolveSkipTls(u.hostname, skipTls);
    const pin = pinIp && pinIp !== u.hostname ? pinIp : null;
    const connectHost = pin || u.hostname.replace(/^\[|\]$/g, '');
    const opts = {
      hostname: connectHost,
      port,
      path: u.pathname || '/',
      timeout: ms,
      lookup: resolver.lookupWithin(ms),
      rejectUnauthorized: !skip,
    };
    if (pin) {
      opts.headers = { Host: u.host };
      opts.servername = u.hostname;
    }

    /* One deadline for the whole ping. The 405 retry below would otherwise let a
       stalled host take the budget twice over. */
    let current = null;
    const dl = withDeadline(ms, () => {
      if (current) current.destroy();
      dl.settle(resolve, { ...PING_TIMED_OUT });
    });

    const send = (method, onResponse) => {
      const req = lib.request({ ...opts, method }, res => {
        req.destroy();
        if (dl.expired()) return;
        onResponse(res.statusCode ?? 0);
      });
      current = req;
      req.on('timeout', () => {
        req.destroy();
        dl.settle(resolve, { ...PING_TIMED_OUT });
      });
      /* This result reaches the browser as-is. Keep the code, never the message:
         the message names the address it failed to reach. */
      req.on('error', (/** @type {unknown} */ e) => {
        /* u.origin only. The authority can carry credentials and the path and
           query can carry an API key. */
        log.warn('ping failed', { url: u.origin, error: errMessage(e) });
        const text = skipIgnored && TLS_ERROR_CODES.has(errCode(e) ?? '') ? SKIP_TLS_IGNORED_MESSAGE : pingErrorText(e);
        dl.settle(resolve, {
          ok: false,
          status: 0,
          error: text,
          kind: 'network',
          code: pingCode(e, skipIgnored, u.hostname),
        });
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
  /* Before guardSsrf. Its DNS lookup is itself an outbound request. */
  if (IS_DEMO) return fetchJSON(url, opts);
  const target = rewriteUrl(url);
  const budget = opts.timeout || FETCH_MS;
  const started = Date.now();
  const guard = await guardSsrf(target, budget);
  if (guard.error) throw new SsrfBlockedError(guard.error, guard.reason);
  return fetchJSON(target, { ...opts, pinIp: guard.ip, timeout: Math.max(1, budget - (Date.now() - started)) });
}

function fetchUnchecked(url, opts = {}) {
  return fetchJSON(rewriteUrl(url), opts);
}

async function jsonRpcChecked(url, opts, fn) {
  if (IS_DEMO) return jsonRpc(url, opts, fn);
  const target = rewriteUrl(url);
  const budget = opts.timeout || FETCH_MS;
  const started = Date.now();
  const guard = await guardSsrf(target, budget);
  if (guard.error) throw new SsrfBlockedError(guard.error, guard.reason);
  return jsonRpc(target, { ...opts, pinIp: guard.ip, timeout: Math.max(1, budget - (Date.now() - started)) }, fn);
}

function jsonRpcUnchecked(url, opts, fn) {
  return jsonRpc(rewriteUrl(url), opts, fn);
}

function pingUnchecked(url, ms, skipTls) {
  return pingUrl(rewriteUrl(url), ms, skipTls);
}

async function pingChecked(url, ms, skipTls) {
  if (IS_DEMO) return pingUrl(url, ms, skipTls);
  const target = rewriteUrl(url);
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return pingInvalid('Invalid URL');
  }
  const policy = urlPolicyError(parsed);
  if (policy) return pingInvalid(policy);
  const budget = ms || PING_MS;
  const started = Date.now();
  let guard;
  try {
    guard = await guardSsrf(target, budget);
  } catch {
    return { ...PING_TIMED_OUT };
  }
  if (guard.error) throw new SsrfBlockedError(guard.error, guard.reason);
  return pingUrl(target, Math.max(1, budget - (Date.now() - started)), skipTls, guard.ip);
}

module.exports = {
  fetchChecked,
  fetchUnchecked,
  jsonRpcChecked,
  jsonRpcUnchecked,
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
  _internals: { fetchJSON, openWebSocket, jsonRpc, pingUrl, guardSsrf, withDeadline, PING_CODES },
};
