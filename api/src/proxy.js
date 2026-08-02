const http  = require('http');
const https = require('https');
const net   = require('net');
const dns   = require('dns').promises;
const { loadConfig } = require('./config');
const { PING_MS, FETCH_MS } = require('./timeouts');
const { IS_DEMO } = require('./demo');
const { parseXml } = require('./parse-xml');
const log = require('./log');
const { parsePrometheus } = require('./parse-prometheus');

/* Addresses that are never a legitimate outbound target.

   Two kinds, treated the same because the consequence is the same: ranges that
   reach something internal (private, loopback, link-local, carrier NAT), and
   ranges that are not routable destinations at all (multicast, reserved,
   broadcast), which are useful mainly for confusing a filter or a network stack.

   Written as CIDRs compared numerically rather than as one regular expression.
   The regular expression this replaces listed the IPv4 ranges twice, once alone
   and once inside its ::ffff: branch, so every addition had to be made in two
   places and got harder to read each time. Ranges were missed as a result. Each
   line below can be checked against its RFC on its own.

   To add a range: add a line. Nothing else needs to change.

   Also documented in docs/security.md, since operators need to know what the
   guard covers before deciding whether they need ALLOW_PRIVATE_IPS. */
/** @type {Array<[string, number, string]>} */
const BLOCKED_IPV4 = [
  ['0.0.0.0',      8,  'this network (RFC 1122)'],
  ['10.0.0.0',     8,  'private (RFC 1918)'],
  ['100.64.0.0',   10, 'carrier-grade NAT (RFC 6598)'],
  ['127.0.0.0',    8,  'loopback (RFC 1122)'],
  ['169.254.0.0',  16, 'link-local, includes cloud metadata (RFC 3927)'],
  ['172.16.0.0',   12, 'private (RFC 1918)'],
  ['192.0.0.0',    24, 'IETF protocol assignments (RFC 6890)'],
  ['192.168.0.0',  16, 'private (RFC 1918)'],
  ['198.18.0.0',   15, 'benchmarking (RFC 2544)'],
  ['224.0.0.0',    4,  'multicast (RFC 5771)'],
  ['240.0.0.0',    4,  'reserved, includes 255.255.255.255 broadcast (RFC 1112)'],
];

/* IPv6 equivalents. A regular expression is still the clearest form here: these
   are prefix matches on the first group, with no arithmetic involved.
     ::1   loopback          ::    unspecified
     fc/fd unique local      fe8-b link-local        ff00::/8 multicast
   ff00::/8 needs all four hex digits: a group written 'ff' is 0x00ff, which is
   not multicast, while 0xff02 can only be written 'ff02'. */
const BLOCKED_IPV6_RE = /^(::1$|::$|f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:|ff[0-9a-f]{2}:)/i;

/** @param {string} addr @returns {number|null} */
function ipv4ToInt(addr) {
  if (!net.isIPv4(addr)) return null;
  const p = addr.split('.');
  return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3];
}

/* Precomputed once. The third column is documentation and is not used here; it
   is what the table in docs/security.md is checked against. */
const _blockedV4 = BLOCKED_IPV4.map(([base, bits]) => ({
  /* A /0 would need a 32-bit shift, which JavaScript treats as a no-op. No entry
     uses one, and the guard keeps it that way. */
  mask: bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0,
  base: ipv4ToInt(base),
}));

/** @param {string} addr @returns {boolean} */
function isBlockedIPv4(addr) {
  const n = ipv4ToInt(addr);
  if (n === null) return false;
  return _blockedV4.some(r => (n & r.mask) >>> 0 === r.base);
}

/* Extract the embedded IPv4 from an IPv4-in-IPv6 address as dotted-decimal, or
   null if there is none. Covers the three forms that wrap an IPv4 target in an
   IPv6 literal, in either hex or dotted tail:
     ::/96           IPv4-compatible (::7f00:1     and  ::127.0.0.1)
     ::ffff:0:0/96   IPv4-mapped     (::ffff:7f00:1 and  ::ffff:127.0.0.1)
     64:ff9b::/96    NAT64 well-known
   The IPv4 range check only understands dotted-decimal, so without this a
   hex-tailed literal like ::7f00:1 (127.0.0.1),
   ::ffff:7f00:1 (127.0.0.1), or 64:ff9b::a9fe:a9fe (169.254.169.254 metadata)
   slips past the range check. */
function embeddedIPv4(addr) {
  if (typeof addr !== 'string') return null;
  const s = addr.toLowerCase();
  const m = s.match(/^(?:::ffff:|64:ff9b::|::)([0-9a-f.:]+)$/);
  if (!m) return null;
  const tail = m[1];
  if (tail.includes('.')) return net.isIPv4(tail) ? tail : null;
  const parts = tail.split(':');
  if (parts.length !== 2) return null;
  const hi = parseInt(parts[0], 16), lo = parseInt(parts[1], 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi > 0xffff || lo > 0xffff) return null;
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/* True when an address is private, loopback, link-local, or an IPv4-in-IPv6
   wrapper around one. For ::ffff: and NAT64 wrappers the embedded IPv4 is
   decoded and range-checked, and a tail that cannot be parsed is refused.
   IPv4-compatible ::/96 literals are decoded the same way, then fall through
   to the normal IPv6 range check when no embedded IPv4 is present. */
function isPrivateAddress(addr) {
  if (typeof addr !== 'string' || !addr) return false;
  const s = addr.toLowerCase();
  if (s.startsWith('::ffff:') || s.startsWith('64:ff9b::')) {
    const v4 = embeddedIPv4(s);
    if (v4) return isBlockedIPv4(v4);
    return true; /* wrapper prefix with a tail we can't parse: refuse */
  }
  if (s.startsWith('::')) {
    const v4 = embeddedIPv4(s);
    if (v4) return isBlockedIPv4(v4);
  }
  return isBlockedIPv4(s) || BLOCKED_IPV6_RE.test(s);
}
const FETCH_SIZE_LIMIT = 4 * 1024 * 1024;
/* Setting this true disables SSRF filtering entirely: private, loopback and
   link-local targets are no longer blocked. Most homelab setups need it on
   because the services they link to are on private IPs, but it removes the
   guard, so it is opt-in. */
const ALLOW_PRIVATE_IPS = process.env.ALLOW_PRIVATE_IPS === 'true';

function getHostIp() {
  try { return loadConfig().settings?.server?.hostIp || ''; } catch { return ''; }
}

/* Fallback TLS-skip check for internal callers without per-app config.
   Only bypasses for private IPs, localhost, and Docker service names. */
function shouldSkipTls(hostname, cfg) {
  if (cfg.settings?.server?.skipTlsVerify !== true) return false;
  return !hostname.includes('.') || isPrivateAddress(hostname) || hostname === 'localhost';
}

function rewriteUrl(raw) {
  try {
    const cfg = loadConfig(), hostIp = cfg.settings?.server?.hostIp || '';
    if (!hostIp) return raw;
    const u = new URL(raw);
    const m = (cfg.settings?.server?.portMap || {})[u.port];
    if (u.hostname === hostIp && m) { u.hostname = m.host; u.port = m.port; }
    return u.toString();
  } catch { return raw; }
}

/* Private: reach this through fetchChecked/pingChecked, which guarantee the url
   passed here is the url that gets connected to.

   Resolves the hostname once and applies the private-IP policy to that exact
   resolution. Returns { error } when blocked, or { ip } with the validated
   address when it should be pinned for the subsequent request (closing the
   DNS-rebind TOCTOU gap: the IP that passed the check is the IP we connect to).
   ip is null for dotless Docker names and host-IP matches, which are trusted and
   connect by hostname.

   This guard protects against a compromised or malicious widget making
   requests on the server's behalf, not against a malicious admin: whoever can
   edit the config already has full config-write access, so a dotless hostname
   they type in is trusted rather than resolved. Do not tighten this to stop
   admin-supplied SSRF, and do not rely on it to stop legitimate Docker-network
   widget traffic. */
/* Only http and https are ever fetched.

   The transport below picks the https module for 'https:' and the plain http
   module for everything else, so an unrecognised scheme did not fail, it became
   an HTTP request. Combined with an empty hostname, which Node's http module
   resolves to localhost, that made file:///etc/passwd a request to localhost,
   defeating the localhost block in guardSsrf a few lines above.

   Checked in guardSsrf and again where the connection is opened. The second
   check is not redundant: fetchUnchecked and pingUnchecked skip the guard by
   design, and they carry URLs from saved config, which can arrive by import. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** @param {URL} u @returns {string|null} */
function urlPolicyError(u) {
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    return `Blocked: only http and https URLs are allowed (got ${u.protocol.replace(':', '')}).`;
  }
  if (!u.hostname) return 'Blocked: URL has no host.';
  return null;
}

async function guardSsrf(rawUrl) {
  let u; try { u = new URL(rawUrl); } catch { return { error:'Invalid URL', ip:null }; }
  /* Scheme and host first. An empty hostname would otherwise pass the dotless
     service-name allowance below and then connect to localhost. */
  const policy = urlPolicyError(u);
  if (policy) return { error: policy, ip: null };
  /* URL keeps IPv6 literals bracketed (e.g. [fd00::1]); strip so the address
     itself is what gets range-checked and resolved. */
  const h = u.hostname.replace(/^\[|\]$/g, '');
  /* localhost is dotless and would pass the service-name allowance below, so
     block it here first. */
  if (!ALLOW_PRIVATE_IPS && h === 'localhost') return { error:`Blocked: ${h} is a private address.`, ip:null };
  /* Dotless single-label names are Docker service names, trusted on internal
     networks. IPv6 literals are also dotless but contain colons, so they must
     not take this path: they fall through to the private-range check below. */
  if (!h.includes('.') && !h.includes(':')) return { error:null, ip:null };
  /* The Docker host's own IP is trusted. Callers guard post-rewrite, so a
     mapped host-IP url has already become a dotless container name and returned
     above; this branch is what remains for a host-IP port with no portMap entry,
     which connects to the host directly. It is a trust policy, not a workaround
     for the rewrite. */
  const hostIp = getHostIp();
  if (hostIp && h === hostIp) return { error:null, ip:null };
  if (!ALLOW_PRIVATE_IPS && isPrivateAddress(h)) return { error:`Blocked: ${h} is a private address.`, ip:null };
  let address;
  try { ({ address } = await dns.lookup(h)); }
  catch { return { error:`Blocked: ${h} could not be resolved.`, ip:null }; }
  if (!ALLOW_PRIVATE_IPS && isPrivateAddress(address)) return { error:`Blocked: ${h} resolves to private IP ${address}.`, ip:null };
  /* A literal address cannot be rebound, so there is nothing to pin; connect by
     the original host and avoid re-serialising an IPv6 literal. */
  if (h === address) return { error:null, ip:null };
  return { error:null, ip:address };
}

/* opts.skipTls: explicit per-call override (true/false).
   If omitted, falls back to shouldSkipTls() for internal callers.
   opts.pinIp: connect to this exact IP instead of re-resolving the hostname.
   Used to carry the IP validated by guardSsrf through to the request, so a DNS
   rebind between check and connect cannot redirect us to a private address. The
   Host header and TLS servername stay set to the original hostname.

   Private to this module: it does not rewrite or guard, it just connects. Reach
   it through fetchChecked/fetchUnchecked, which own the full pipeline. */
/* One overall deadline for an outbound request, shared by fetchJSON and pingUrl.

   Node's socket-level `timeout` is an inactivity timer on the socket, and it does
   not reliably bound a stalled DNS lookup, TCP connect or TLS handshake. Without
   a second timer covering the whole attempt, a request against a host that
   accepts the connection and then goes silent runs past its budget: measured at
   4 seconds against a 2 second budget, because the phase timer and the socket
   timer each ran in turn.

   fetchJSON had this. pingUrl did not, so health checks against a hung service
   took twice as long as they should to report it, and those pings run in
   parallel, so the whole health response was held up rather than one tile.

   Written once because two copies of a timing rule is exactly how the two came
   to differ. Returns a settle function: the first caller to settle wins, the
   timer is cleared, and later events are ignored.

   @param {number} ms @param {() => void} onExpire
   @returns {{ settle: (fn: Function, arg?: any) => void, expired: () => boolean }} */
function withDeadline(ms, onExpire) {
  let settled = false;
  const timer = setTimeout(() => { if (!settled) onExpire(); }, ms);
  /* Unref'd so a pending request never holds the process open at shutdown. */
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
  if (IS_DEMO) return Promise.resolve({ status: 503, data: null, error: 'Outbound requests are disabled in demo mode' });
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(raw); } catch(e) { return reject(e); }
    const policy = urlPolicyError(u);
    if (policy) return reject(Object.assign(new Error(policy), { kind: 'blocked', status: 403 }));
    /* Assigned below, once `req` exists for the deadline to destroy. */
    let dl = null;
    const done = (fn, arg) => dl.settle(fn, arg);
    const lib  = u.protocol === 'https:' ? https : http;
    const port = u.port || (u.protocol === 'https:' ? 443 : 80);
    const skipTls = opts.skipTls != null ? opts.skipTls : shouldSkipTls(u.hostname, loadConfig());
    const bodyBuf = opts.body ? Buffer.from(opts.body) : null;
    const hdrs = Object.assign({}, opts.headers || {});
    if (bodyBuf) hdrs['Content-Length'] = bodyBuf.length;
    const pin = opts.pinIp && opts.pinIp !== u.hostname ? opts.pinIp : null;
    if (pin) hdrs['Host'] = u.host;
    /* http.request wants a bare IPv6 address, not the bracketed form URL keeps
       (hostname is "[::1]"); brackets here fail to resolve. Host header and SNI
       stay on the original bracketed hostname. */
    const connectHost = pin || u.hostname.replace(/^\[|\]$/g, '');
    const req = lib.request({
      hostname: connectHost, port, path: u.pathname + u.search,
      method: opts.method || 'GET', headers: hdrs,
      servername: pin ? u.hostname : undefined, /* keep SNI + cert validation on the real hostname */
      timeout: opts.timeout || FETCH_MS,
      rejectUnauthorized: !skipTls,
    }, res => {
      const sc = res.statusCode ?? 0;
      if (sc >= 300 && sc < 400) {
        res.resume();
        return done(reject, new Error(`Redirect blocked (${sc}). Use the final URL directly`));
      }
      const bufs = []; let total = 0;
      res.on('data', c => {
        total += c.length;
        if (total > FETCH_SIZE_LIMIT) { req.destroy(); return done(reject, new Error('Response too large')); }
        bufs.push(c);
      });
      res.on('end', () => {
        const body = Buffer.concat(bufs).toString('utf8');
        if (opts.raw) return done(resolve, { status: res.statusCode, data: body });
        const ct   = (res.headers['content-type'] || '').toLowerCase();
        try { done(resolve, { status: res.statusCode, data: JSON.parse(body) }); }
        catch {
          if ((ct.includes('text/plain') || ct.includes('openmetrics')) && body.includes('# TYPE'))
            done(resolve, { status: res.statusCode, data: parsePrometheus(body) });
          else if (ct.includes('xml') || body.trimStart().startsWith('<')) {
            const parsed = parseXml(body);
            /* The response was larger than the parser's caps, so what follows is
               a partial view of it. Logged because the operator is the only one
               who can act on it, by narrowing the feed. */
            if (parsed['#truncated']) {
              /* Origin and path only. A URL may carry an API key in its query
                 string, and userinfo in its authority; URL.origin excludes both. */
              log.warn('XML response was too large to read in full', { url: u.origin + u.pathname, bytes: body.length });
            }
            done(resolve, { status: res.statusCode, data: parsed });
          }
          else done(resolve, { status: res.statusCode, data: body });
        }
      });
    });
    /* Armed here rather than earlier because it destroys `req`, which does not
       exist until now. See withDeadline: it bounds the whole attempt regardless
       of which phase is stalled, so a stuck upstream degrades to a normal error
       rather than outliving the gateway's read timeout and surfacing as a 504. */
    dl = withDeadline(opts.timeout || FETCH_MS, () => {
      req.destroy();
      done(reject, new Error('Timed out'));
    });
    req.on('timeout', () => { req.destroy(); done(reject, new Error('Timed out')); });
    req.on('error', e => done(reject, e));
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

function statusDesc(code) {
  if (code === 0)   return 'No response';
  if (code < 400)   return 'OK';
  if (code === 401) return 'Unauthorised';
  if (code === 403) return 'Forbidden';
  if (code === 404) return 'Not found (but reachable)';
  if (code === 405) return 'Method not allowed';
  if (code === 407) return 'Proxy auth required';
  if (code >= 500)  return 'Server error';
  return `HTTP ${code}`;
}

/* skipTls: explicit per-call override (true/false).
   If omitted, falls back to shouldSkipTls() for internal callers.
   pinIp: connect to this exact IP (from guardSsrf) instead of re-resolving,
   with Host header and TLS servername kept on the original hostname. */
function pingUrl(raw, ms = PING_MS, skipTls, pinIp) {
  if (IS_DEMO) return Promise.resolve({ ok: false, status: 0, error: 'Outbound requests are disabled in demo mode' });
  return new Promise(resolve => {
    let u; try { u = new URL(raw); } catch { return resolve({ ok:false, status:0, error:'Invalid URL' }); }
    const policy = urlPolicyError(u);
    if (policy) return resolve({ ok:false, status:0, error:policy });
    const lib  = u.protocol === 'https:' ? https : http;
    const port = u.port || (u.protocol === 'https:' ? 443 : 80);
    const skip = skipTls != null ? skipTls : shouldSkipTls(u.hostname, loadConfig());
    const pin  = pinIp && pinIp !== u.hostname ? pinIp : null;
    const connectHost = pin || u.hostname.replace(/^\[|\]$/g, '');
    const opts = { hostname:connectHost, port, path:u.pathname||'/', timeout:ms, rejectUnauthorized:!skip };
    if (pin) { opts.headers = { Host: u.host }; opts.servername = u.hostname; }

    /* One deadline for the whole ping, not one per request. A HEAD answered with
       405 is retried as GET, so a per-request timer would let a stalled host
       take the budget twice over. `current` is whichever request is in flight,
       so expiry destroys the right one. */
    let current = null;
    const dl = withDeadline(ms, () => {
      if (current) current.destroy();
      dl.settle(resolve, { ok:false, status:0, error:'Timed out' });
    });

    const send = (method, onResponse) => {
      const req = lib.request({ ...opts, method }, res => {
        res.resume();
        if (dl.expired()) return;
        onResponse(res.statusCode ?? 0);
      });
      current = req;
      req.on('timeout', () => { req.destroy(); dl.settle(resolve, { ok:false, status:0, error:'Timed out' }); });
      req.on('error',   e => dl.settle(resolve, { ok:false, status:0, error:e.message }));
      req.end();
    };

    send('HEAD', sc => {
      /* Some servers refuse HEAD; the retry shares the same overall budget. */
      if (sc === 405) return send('GET', gsc => dl.settle(resolve, { ok:gsc < 500, status:gsc, desc:statusDesc(gsc) }));
      dl.settle(resolve, { ok:sc < 500, status:sc, desc:statusDesc(sc) });
    });
  });
}

/* ── The outbound boundary ──────────────────────────────────────────────────

   These are the only supported ways to make an outbound request. fetchJSON,
   pingUrl and guardSsrf are private to this module (see _internals, which is
   exported for tests only, never for routes).

   Every caller must choose one, and the choice is about where the URL came from:

     fetchChecked   the URL arrived in the HTTP request (a body field, a ?url=
                    param). Untrusted, so it is SSRF-guarded.
     fetchUnchecked the URL came from saved config, or is a hardcoded constant.
                    Not guarded. Whoever writes config already has config-write
                    access, so guarding it protects nothing while breaking the
                    private-IP homelab targets that are the normal case.

   The loud name is deliberate: fetchUnchecked in a new route should make a
   reviewer stop and ask. There is no unclassified fetch to reach for by accident.

   All four own the whole pipeline: rewrite, guard the REWRITTEN url, then
   connect to it. Callers never touch the intermediate URL, so the url that gets
   checked cannot drift away from the url that gets connected to, and a ping
   reports on the same target the matching fetch would use. That drift was
   possible when the rewrite lived inside fetchJSON, i.e. after the guard had
   already passed on a different string. Keep the guard downstream of every URL
   transformation: if a future rewrite step is added, put it above the guard. */

class SsrfBlockedError extends Error {
  /* Carries the status a route should return, so a plain
     `catch(e) { json(res, e.status || 502, ...) }` keeps the 403. */
  constructor(reason) { super(reason); this.name = 'SsrfBlockedError'; this.status = 403; }
}

async function fetchChecked(url, opts = {}) {
  /* Short-circuit before guardSsrf: its dns.lookup would be an outbound request,
     and demo mode promises none. */
  if (IS_DEMO) return fetchJSON(url, opts);
  const target = rewriteUrl(url);
  const guard  = await guardSsrf(target);
  if (guard.error) throw new SsrfBlockedError(guard.error);
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
  const guard  = await guardSsrf(target);
  if (guard.error) throw new SsrfBlockedError(guard.error);
  return pingUrl(target, ms, skipTls, guard.ip);
}

module.exports = {
  fetchChecked, fetchUnchecked, pingChecked, pingUnchecked, SsrfBlockedError, statusDesc,
  urlPolicyError, ALLOWED_PROTOCOLS,
  rewriteUrl, getHostIp, shouldSkipTls,
  isPrivateAddress, isBlockedIPv4, embeddedIPv4, BLOCKED_IPV4,
  _internals: { fetchJSON, pingUrl, guardSsrf },
};
