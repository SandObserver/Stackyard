const http  = require('http');
const https = require('https');
const dns   = require('dns').promises;
const { loadConfig } = require('./config');

const PRIVATE_IP_RE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.|0\.|::1$|fc[0-9a-f]{2}:|fe[89ab][0-9a-f]:|::ffff:(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.))/i;
const FETCH_SIZE_LIMIT = 4 * 1024 * 1024;
const ALLOW_PRIVATE_IPS = process.env.ALLOW_PRIVATE_IPS === 'true';

function getHostIp() {
  try { return loadConfig().settings?.server?.hostIp || ''; } catch { return ''; }
}

/* Fallback TLS-skip check for internal callers without per-app config.
   Only bypasses for private IPs, localhost, and Docker service names. */
function shouldSkipTls(hostname, cfg) {
  if (cfg.settings?.server?.skipTlsVerify !== true) return false;
  return !hostname.includes('.') || PRIVATE_IP_RE.test(hostname) || hostname === 'localhost';
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

function parsePrometheus(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const m = t.match(/^([a-zA-Z_:][a-zA-Z0-9_:{}=",./ -]*?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
    if (m) { const v = parseFloat(m[2]); if (!isNaN(v)) out[m[1].trim()] = v; }
  }
  return out;
}

/* Minimal XML parser: extracts root element attributes (coercing numeric strings)
   and counts direct child elements by tag name. Sufficient for Plex-style API responses. */
function parseXml(xml) {
  /* Strip XML declaration and comments before matching root element */
  const stripped = xml.replace(/<\?[^?]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').trim();
  const rootMatch = stripped.match(/^<(\w+)((?:\s+[\w:.-]+=(?:"[^"]*"|'[^']*'))*)\s*\/?>/);
  if (!rootMatch) return {};
  const rootTag = rootMatch[1];
  const root = {};
  for (const m of rootMatch[2].matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    const v = m[2] !== '' && !isNaN(Number(m[2])) ? Number(m[2]) : m[2];
    root[m[1]] = v;
  }
  const childCounts = {};
  for (const m of stripped.matchAll(/<(\w+)[\s/>]/g)) {
    if (m[1] === rootTag) continue;
    childCounts[m[1]] = (childCounts[m[1]] || 0) + 1;
  }
  for (const [tag, count] of Object.entries(childCounts)) root[tag] = count;
  return { [rootTag]: root };
}

/* Resolves the hostname once and applies the private-IP policy to that exact
   resolution. Returns { error } when blocked, or { ip } with the validated
   address when it should be pinned for the subsequent request (closing the
   DNS-rebind TOCTOU gap — the IP that passed the check is the IP we connect to).
   ip is null for dotless Docker names and host-IP matches, which are trusted and
   connect by hostname.

   This guard protects against a compromised or malicious widget making
   requests on the server's behalf, not against a malicious admin: whoever can
   edit the config already has full config-write access, so a dotless hostname
   they type in is trusted rather than resolved. Do not tighten this to stop
   admin-supplied SSRF, and do not rely on it to stop legitimate Docker-network
   widget traffic. */
async function guardSsrf(rawUrl) {
  let u; try { u = new URL(rawUrl); } catch { return { error:'Invalid URL', ip:null }; }
  const h = u.hostname;
  if (!h.includes('.')) return { error:null, ip:null }; /* Docker service names — safe on internal networks */
  const hostIp = getHostIp();
  if (hostIp && h === hostIp) return { error:null, ip:null };
  if (!ALLOW_PRIVATE_IPS && (PRIVATE_IP_RE.test(h) || h === 'localhost')) return { error:`Blocked: ${h} is a private address.`, ip:null };
  let address;
  try { ({ address } = await dns.lookup(h)); }
  catch { return { error:`Blocked: ${h} could not be resolved.`, ip:null }; }
  if (!ALLOW_PRIVATE_IPS && PRIVATE_IP_RE.test(address)) return { error:`Blocked: ${h} resolves to private IP ${address}.`, ip:null };
  return { error:null, ip:address };
}

/* Both variants share one implementation. Kept as separate names for call-site
   clarity (checkSsrf: internal callers, strictCheckSsrf: user-submitted URLs). */
const checkSsrf = guardSsrf;
const strictCheckSsrf = guardSsrf;

/* opts.skipTls — explicit per-call override (true/false).
   If omitted, falls back to shouldSkipTls() for internal callers.
   opts.pinIp — connect to this exact IP instead of re-resolving the hostname.
   Used to carry the IP validated by guardSsrf through to the request, so a DNS
   rebind between check and connect cannot redirect us to a private address. The
   Host header and TLS servername stay set to the original hostname. */
function fetchJSON(raw, opts = {}) {
  return new Promise((resolve, reject) => {
    raw = rewriteUrl(raw); /* remap host IP → container name if portMap is configured */
    let u; try { u = new URL(raw); } catch(e) { return reject(e); }
    const lib  = u.protocol === 'https:' ? https : http;
    const port = u.port || (u.protocol === 'https:' ? 443 : 80);
    const skipTls = opts.skipTls != null ? opts.skipTls : shouldSkipTls(u.hostname, loadConfig());
    const bodyBuf = opts.body ? Buffer.from(opts.body) : null;
    const hdrs = Object.assign({}, opts.headers || {});
    if (bodyBuf) hdrs['Content-Length'] = bodyBuf.length;
    const pin = opts.pinIp && opts.pinIp !== u.hostname ? opts.pinIp : null;
    if (pin) hdrs['Host'] = u.host;
    const req = lib.request({
      hostname: pin || u.hostname, port, path: u.pathname + u.search,
      method: opts.method || 'GET', headers: hdrs,
      servername: pin ? u.hostname : undefined, /* keep SNI + cert validation on the real hostname */
      timeout: opts.timeout || 8000,
      rejectUnauthorized: !skipTls,
      maxRedirects: 0, /* redirects disabled — target could resolve to private IP */
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        return reject(new Error(`Redirect blocked (${res.statusCode}) — use the final URL directly`));
      }
      const bufs = []; let total = 0;
      res.on('data', c => {
        total += c.length;
        if (total > FETCH_SIZE_LIMIT) { req.destroy(); return reject(new Error('Response too large')); }
        bufs.push(c);
      });
      res.on('end', () => {
        const body = Buffer.concat(bufs).toString('utf8');
        const ct   = (res.headers['content-type'] || '').toLowerCase();
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch {
          if ((ct.includes('text/plain') || ct.includes('openmetrics')) && body.includes('# TYPE'))
            resolve({ status: res.statusCode, data: parsePrometheus(body) });
          else if (ct.includes('xml') || body.trimStart().startsWith('<'))
            resolve({ status: res.statusCode, data: parseXml(body) });
          else resolve({ status: res.statusCode, data: body });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Timed out')); });
    req.on('error', reject);
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

/* skipTls — explicit per-call override (true/false).
   If omitted, falls back to shouldSkipTls() for internal callers.
   pinIp — connect to this exact IP (from guardSsrf) instead of re-resolving,
   with Host header and TLS servername kept on the original hostname. */
function pingUrl(raw, ms = 6000, skipTls, pinIp) {
  return new Promise(resolve => {
    let u; try { u = new URL(raw); } catch { return resolve({ ok:false, status:0, error:'Invalid URL' }); }
    const lib  = u.protocol === 'https:' ? https : http;
    const port = u.port || (u.protocol === 'https:' ? 443 : 80);
    const skip = skipTls != null ? skipTls : shouldSkipTls(u.hostname, loadConfig());
    const pin  = pinIp && pinIp !== u.hostname ? pinIp : null;
    const opts = { hostname:pin||u.hostname, port, path:u.pathname||'/', timeout:ms, rejectUnauthorized:!skip };
    if (pin) { opts.headers = { Host: u.host }; opts.servername = u.hostname; }

    function tryGet() {
      const req = lib.request({ ...opts, method:'GET' }, res => {
        res.resume();
        resolve({ ok:res.statusCode < 500, status:res.statusCode, desc:statusDesc(res.statusCode) });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok:false, status:0, error:'Timed out' }); });
      req.on('error',   e => resolve({ ok:false, status:0, error:e.message }));
      req.end();
    }

    const req = lib.request({ ...opts, method:'HEAD' }, res => {
      res.resume();
      if (res.statusCode === 405) return tryGet();
      resolve({ ok:res.statusCode < 500, status:res.statusCode, desc:statusDesc(res.statusCode) });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok:false, status:0, error:'Timed out' }); });
    req.on('error',   e => resolve({ ok:false, status:0, error:e.message }));
    req.end();
  });
}

module.exports = { fetchJSON, pingUrl, guardSsrf, checkSsrf, strictCheckSsrf, rewriteUrl, getHostIp, shouldSkipTls, parsePrometheus, PRIVATE_IP_RE };
