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

/* Decode the five predefined XML entities plus numeric character references.
   Anything unrecognised is left untouched rather than dropped. */
function _xmlDecode(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : m; } catch { return m; }
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
  });
}

/* Turn a text value into a number ONLY when the number round-trips to the exact
   original text, so genuinely-numeric fields (counts, totals) become numbers the
   badge picker can find, while IDs with leading zeros ("007"), version-like
   strings ("1.10"), exponent forms ("1e3") and oversized integers stay strings
   rather than being silently corrupted. Surrounding whitespace is trimmed before
   the check, so a padded number still coerces; a blank value stays a string. */
function _xmlCoerce(raw) {
  const t = raw.trim();
  if (t === '') return raw;
  const n = Number(t);
  if (!Number.isFinite(n)) return raw;
  if (String(n) !== t) return raw;
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) return raw;
  return n;
}

/* Recursively turn a parsed element node into its plain-object value, using a
   fixed convention so a widget author (or the badge field picker) always knows
   the shape: attributes and child elements both become keys; a tag that repeats
   becomes an array, a tag that appears once stays a single value; an element
   with only text collapses to that (coerced) text; element text alongside
   attributes/children is kept under "#text". On the rare attribute/child name
   collision the child element wins. */
function _xmlValue(node) {
  const attrKeys = Object.keys(node.attrs);
  const text = _xmlDecode(node.text).trim();

  if (node.children.length === 0) {
    if (attrKeys.length === 0) return text === '' ? '' : _xmlCoerce(text);
    const obj = {};
    for (const k of attrKeys) obj[k] = _xmlCoerce(node.attrs[k]);
    if (text !== '') obj['#text'] = _xmlCoerce(text);
    return obj;
  }

  const obj = {};
  for (const k of attrKeys) obj[k] = _xmlCoerce(node.attrs[k]);
  if (text !== '') obj['#text'] = _xmlCoerce(text);
  for (const c of node.children) {
    const v = _xmlValue(c);
    if (c.tag in obj) { if (Array.isArray(obj[c.tag])) obj[c.tag].push(v); else obj[c.tag] = [obj[c.tag], v]; }
    else obj[c.tag] = v;
  }
  return obj;
}

/* General-purpose XML parser producing a nested object keyed by the root tag,
   e.g. Plex /status/sessions becomes
     { MediaContainer: { size: 1, Metadata: [ { title, duration, Player: { state } } ] } }
   which is the same shape Plex's JSON response has, so the same widget code
   reads either. Handles attributes (both quote styles), nested elements,
   repeated elements, text content, CDATA, entities, comments, the XML
   declaration, processing instructions and DOCTYPE. It is a pragmatic reader
   for well-formed API responses, not a validating parser; node and depth caps
   bound pathological input. */
function parseXml(xml) {
  if (typeof xml !== 'string') return {};
  const MAX_NODES = 5000, MAX_DEPTH = 60;
  const root = { tag: '#doc', attrs: {}, children: [], text: '' };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const len = xml.length;
  let i = 0, nodes = 0;

  while (i < len) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) { top().text += xml.slice(i); break; }
    if (lt > i) top().text += xml.slice(i, lt);

    if (xml.startsWith('<!--', lt))       { const e = xml.indexOf('-->', lt + 4);  i = e === -1 ? len : e + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt))  { const e = xml.indexOf(']]>', lt + 9);  top().text += xml.slice(lt + 9, e === -1 ? len : e); i = e === -1 ? len : e + 3; continue; }
    if (xml.startsWith('<?', lt))         { const e = xml.indexOf('?>', lt + 2);   i = e === -1 ? len : e + 2; continue; }
    if (xml.startsWith('<!', lt))         { const e = xml.indexOf('>', lt + 2);    i = e === -1 ? len : e + 1; continue; }

    const gt = xml.indexOf('>', lt);
    if (gt === -1) break;
    let raw = xml.slice(lt + 1, gt).trim();

    if (raw[0] === '/') {
      const name = raw.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === name) { stack.length = k; break; }
      i = gt + 1; continue;
    }

    const selfClose = raw.endsWith('/');
    if (selfClose) raw = raw.slice(0, -1).trim();
    const sp = raw.search(/\s/);
    const name = sp === -1 ? raw : raw.slice(0, sp);
    const node = { tag: name, attrs: {}, children: [], text: '' };
    if (sp !== -1) {
      for (const m of raw.slice(sp + 1).matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
        node.attrs[m[1]] = _xmlDecode(m[2] !== undefined ? m[2] : m[3]);
    }
    if (++nodes > MAX_NODES) break;
    top().children.push(node);
    if (!selfClose && stack.length < MAX_DEPTH) stack.push(node);
    i = gt + 1;
  }

  const docEl = root.children.find(c => c.tag);
  return docEl ? { [docEl.tag]: _xmlValue(docEl) } : {};
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

module.exports = { fetchJSON, pingUrl, guardSsrf, checkSsrf, strictCheckSsrf, rewriteUrl, getHostIp, shouldSkipTls, parsePrometheus, parseXml, PRIVATE_IP_RE };
