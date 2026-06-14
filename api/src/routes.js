const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const { on, json, readBody, setPreflightHeaders } = require('./router');
const { loadConfig, saveConfig, ICONS_PATH } = require('./config');
const { fetchJSON, pingUrl, checkSsrf, strictCheckSsrf, rewriteUrl } = require('./proxy');
const { cpuPercent, ramPercent, cpuTemp, diskStats } = require('./metrics');
const log = require('./log');
const {
  crypto, getOrCreateSecret, hashPassword, verifyPassword,
  makeToken, setSessionCookie, clearSessionCookie,
  checkRateLimit, recordFailedAttempt, clearAttempts, rateLimit,
} = require('./auth');

const SOCKET_PROXY_URL_DEFAULT = process.env.SOCKET_PROXY_URL || '';

/* CSRF guard: reject requests whose Origin doesn't match the server host.
   Requests with no Origin header (same-origin navigations, curl, etc.) pass. */
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

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

function getIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',').map(s => s.trim()).filter(Boolean)[0];
  }
  return req.socket?.remoteAddress || 'unknown';
}

async function fetchContainerHealth() {
  const cfg = loadConfig();
  const socketUrl = cfg.settings?.server?.socketProxyUrl || SOCKET_PROXY_URL_DEFAULT;
  if (!socketUrl) return {};
  try {
    const r = await fetchJSON(`${socketUrl}/containers/json?all=true`);
    if (!Array.isArray(r.data)) return {};
    const out = {};
    for (const c of r.data) {
      for (const name of (c.Names||[])) {
        const clean = name.replace(/^\//,'');
        const norm  = clean.toLowerCase().replace(/[\s_]+/g,'-');
        const entry = { state:c.State, status:c.Status||'', unhealthy:c.State!=='running'||(c.Status||'').toLowerCase().includes('unhealthy') };
        out[clean] = entry; out[norm] = entry;
      }
    }
    return out;
  } catch(e) { log.error('container health fetch failed', { error:e.message }); return {}; }
}

function collectNumbers(obj, path='', out=[], _depth=0, _state={n:0}) {
  const MAX_DEPTH = 6, MAX_NODES = 256;
  if (_state.n++ > MAX_NODES || _depth > MAX_DEPTH || obj == null) return out;
  if (typeof obj === 'number') { out.push({ path:path||'(root)', value:obj }); return out; }
  if (Array.isArray(obj)) {
    /* Always surface the array count */
    const countPath = path ? `${path}.$count` : '$count';
    out.push({ path:countPath, value:obj.length, label:`${path||'root'} — count` });
    /* Surface boolean-field filter counts (e.g. filter(updateAvailable==true).count) */
    const sample = obj.find(i => i && typeof i === 'object' && !Array.isArray(i));
    if (sample) {
      const seen = {};
      for (const [field, val] of Object.entries(sample)) {
        if (_state.n > MAX_NODES) break;
        if (typeof val === 'boolean') {
          for (const bval of [true, false]) {
            const n = obj.filter(i => i && i[field] === bval).length;
            if (n > 0) {
              const p = `${path?path+'.':''}filter(${field}==${bval}).count`;
              if (!seen[p]) { seen[p] = 1; out.push({ path:p, value:n, label:`${field} == ${bval}` }); }
            }
          }
        }
      }
    }
    /* Recurse into first few items to surface nested values */
    obj.slice(0, 3).forEach((v, i) => collectNumbers(v, path ? `${path}[${i}]` : `[${i}]`, out, _depth+1, _state));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (_state.n > MAX_NODES) break;
      collectNumbers(v, path ? `${path}.${k}` : k, out, _depth+1, _state);
    }
  }
  return out;
}

function extractPath(obj, dotPath) {
  /* Segment parser: splits on dots but treats content inside parens as one segment.
     Needed because filter(...) segments contain dots inside the parens. */
  const segments = [];
  let buf = '', depth = 0;
  for (const ch of dotPath) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === '.' && depth === 0) { if (buf) segments.push(buf); buf = ''; }
    else buf += ch;
  }
  if (buf) segments.push(buf);

  const filterRe = /^filter\((\w+)==(true|false|[^)]+)\)$/;
  let cur = obj;
  for (const seg of segments) {
    if (cur == null) return undefined;
    /* Array total count */
    if (seg === '$count' || seg === 'count') return Array.isArray(cur) ? cur.length : undefined;
    /* Boolean/string filter + count: filter(field==value).count — handled as two segments */
    const fM = seg.match(filterRe);
    if (fM) {
      const [, field, rawVal] = fM;
      const val = rawVal === 'true' ? true : rawVal === 'false' ? false : rawVal;
      cur = Array.isArray(cur) ? cur.filter(item => item && item[field] === val) : undefined;
      continue;
    }
    /* Bare array index: [0] */
    const bare = seg.match(/^\[(\d+)\]$/);
    if (bare) { cur = Array.isArray(cur) ? cur[+bare[1]] : undefined; continue; }
    /* Named array index: key[0] */
    const named = seg.match(/^(\w+)\[(\d+)\]$/);
    if (named) { cur = Array.isArray(cur[named[1]]) ? cur[named[1]][+named[2]] : undefined; continue; }
    /* Plain key */
    cur = cur[seg];
  }
  return cur;
}

function computeBadgeValue(data, badge) {
  if (!badge?.extract) return 0;
  const paths = Array.isArray(badge.extract)
    ? badge.extract.map(e => typeof e === 'string' ? e : e.path)
    : [typeof badge.extract === 'string' ? badge.extract : badge.extract.path];
  return paths.reduce((s,p) => { const v=extractPath(data,p); return s+(typeof v==='number'?v:0); }, 0);
}

// ── Auth routes ──

on('GET', '/api/auth/check', (req, res) => {
  const cfg = loadConfig();
  json(res, 200, {
    enabled: !!(cfg.settings?.auth?.enabled),
    authenticated: require('./auth').isAuthenticated(req),
    passwordSet: !!(cfg.settings?.auth?.passwordHash),
  });
});

on('POST', '/api/auth/login', async(req, res) => {
  const ip = getIp(req);
  try {
    const { password = '' } = JSON.parse(await readBody(req));
    const cfg = loadConfig();
    if (!cfg.settings?.auth?.enabled) return json(res, 200, { ok:true }); /* auth off — always pass */
    const limitErr = checkRateLimit(ip);
    if (limitErr) { log.audit('login blocked', { ip, reason:'rate_limit' }); return json(res, 429, { error:limitErr }); }
    const hash = cfg.settings.auth.passwordHash;
    if (!hash) return json(res, 401, { error:'No password set. Enable auth and set a password in Admin → Server.' });
    const ok = await verifyPassword(password, hash);
    if (!ok) { recordFailedAttempt(ip); log.audit('login failed', { ip }); return json(res, 401, { error:'Incorrect password.' }); }
    clearAttempts(ip);
    log.audit('login success', { ip });
    const secret = getOrCreateSecret();
    const sessionId = crypto.randomBytes(24).toString('hex');
    setSessionCookie(res, makeToken(sessionId, secret));
    json(res, 200, { ok:true });
  } catch(e) { json(res, 400, { error:e.message }); }
});

on('POST', '/api/auth/logout', (req, res) => {
  log.audit('logout', { ip: getIp(req) });
  clearSessionCookie(res);
  json(res, 200, { ok:true });
});

on('POST', '/api/auth/set-password', async(req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const cfg = loadConfig();
    const hasPassword = !!cfg.settings?.auth?.passwordHash;
    /* If a password is already set, changing it requires an authenticated session.
       Without this, anyone on the LAN could overwrite the password while auth is
       disabled (isAuthenticated returns true when auth is off) and lock out the owner.
       First-time setup (no password yet) is allowed without a session. */
    if (hasPassword && !require('./auth').hasValidSession(req)) {
      return json(res, 401, { error:'Authentication required to change the existing password.' });
    }
    const { password = '' } = JSON.parse(await readBody(req));
    if (!password || password.length < 8) return json(res, 400, { error:'Password must be at least 8 characters.' });
    cfg.settings = cfg.settings || {};
    cfg.settings.auth = cfg.settings.auth || {};
    cfg.settings.auth.passwordHash = await hashPassword(password);
    if (!cfg.settings.auth.secret) cfg.settings.auth.secret = crypto.randomBytes(32).toString('hex');
    saveConfig(cfg);
    log.audit('password changed', {});
    json(res, 200, { ok:true });
  } catch(e) { json(res, 400, { error:e.message }); }
});

on('POST', '/api/auth/toggle', async(req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const { enabled } = JSON.parse(await readBody(req));
    const cfg = loadConfig();
    cfg.settings = cfg.settings || {};
    cfg.settings.auth = cfg.settings.auth || {};
    cfg.settings.auth.enabled = !!enabled;
    if (enabled && !cfg.settings.auth.secret)
      cfg.settings.auth.secret = crypto.randomBytes(32).toString('hex');
    saveConfig(cfg);
    log.audit('auth toggled', { enabled: !!enabled });
    json(res, 200, { ok:true });
  } catch(e) { json(res, 400, { error:e.message }); }
});

// ── Config routes ──

/* Deep-copy a config object and strip all sensitive credentials, replacing each
   with a boolean *Set indicator. Shared by GET /api/config and /api/config/export
   so secrets never leave the server in plaintext through either path. */
function scrubSecrets(cfg) {
  const safe = JSON.parse(JSON.stringify(cfg));
  if (safe.settings?.background?.apiKey) delete safe.settings.background.apiKey;
  if (Array.isArray(safe.items)) {
    safe.items.forEach(item => {
      if (item.type === 'widget' && item.widgetConfig) {
        if ('adguardPass' in item.widgetConfig) {
          item.widgetConfig.adguardPassSet = true;
          delete item.widgetConfig.adguardPass;
        }
        if (item.widgetType === 'stats' && item.widgetConfig.network &&
            'myspeedPass' in item.widgetConfig.network) {
          item.widgetConfig.network.myspeedPassSet = true;
          delete item.widgetConfig.network.myspeedPass;
        }
        if (item.widgetType === 'duplicati' && Array.isArray(item.widgetConfig?.slots)) {
          item.widgetConfig.slots = item.widgetConfig.slots.map(s => {
            const out = {...s};
            if ('dupPass'   in out) { out.dupPassSet=true;   delete out.dupPass; }
            if ('kopiaPass' in out) { out.kopiaPassSet=true; delete out.kopiaPass; }
            return out;
          });
        }
        if (item.widgetType === 'connections' && item.widgetConfig.vpn) {
          const v = item.widgetConfig.vpn;
          if ('apiKey' in v) { v.apiKeySet = true; delete v.apiKey; }
          if ('token'  in v) { v.tokenSet  = true; delete v.token; }
        }
        if (item.widgetType === 'connections' && Array.isArray(item.widgetConfig.services)) {
          item.widgetConfig.services = item.widgetConfig.services.map(s => {
            const out = {...s};
            MAP_SVC_SECRETS.forEach(k => { if (k in out) { out[k+'Set'] = true; delete out[k]; } });
            return out;
          });
        }
      }
    });
  }
  if (safe.settings?.githubToken) {
    safe.settings.githubTokenSet = true;
    delete safe.settings.githubToken;
  }
  /* Strip the auth secret and password hash — never expose these through any read path */
  if (safe.settings?.auth) {
    delete safe.settings.auth.secret;
    delete safe.settings.auth.passwordHash;
  }
  return safe;
}

on('GET', '/api/config', (_, res) => {
  json(res, 200, scrubSecrets(loadConfig()));
});

on('GET', '/api/settings/unsplash-key', (_, res) => {
  json(res, 200, { configured:!!(loadConfig().settings?.background?.apiKey) });
});

on('POST', '/api/settings/unsplash-key', async(req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const { apiKey='' } = JSON.parse(await readBody(req));
    const cfg = loadConfig();
    cfg.settings = cfg.settings || {}; cfg.settings.background = cfg.settings.background || {};
    if (apiKey.trim()) cfg.settings.background.apiKey = apiKey.trim();
    else delete cfg.settings.background.apiKey;
    saveConfig(cfg); json(res, 200, { ok:true });
  } catch(e) { json(res, 400, { error:e.message }); }
});

on('POST', '/api/config', async(req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const data = JSON.parse(await readBody(req));
    if (!Array.isArray(data.items)) return json(res, 400, { error:'items must be an array' });
    const bad = data.items.find(i => !i || typeof i.id !== 'string' || !i.id || typeof i.type !== 'string' || !i.type);
    if (bad) return json(res, 400, { error:'every item needs a non-empty id and type' });
    // Strip unknown top-level settings keys
    const KNOWN_SETTINGS = new Set(['background', 'stats', 'server', 'auth', 'theme', 'layout', 'search', 'greeting']);
    if (data.settings && typeof data.settings === 'object') {
      for (const key of Object.keys(data.settings)) {
        if (!KNOWN_SETTINGS.has(key)) delete data.settings[key];
      }
    }
    const existing = loadConfig();
    if (existing.settings?.background?.apiKey && !data.settings?.background?.apiKey) {
      data.settings = data.settings || {};
      data.settings.background = data.settings.background || {};
      data.settings.background.apiKey = existing.settings.background.apiKey;
    }
    if (existing.settings?.auth) {
      data.settings = data.settings || {};
      data.settings.auth = data.settings.auth || existing.settings.auth;
    }
    /* Preserve adguardPass for any widget where the browser omitted it
       (password is stripped from GET /api/config and never round-tripped) */
    if (Array.isArray(data.items) && Array.isArray(existing.items)) {
      data.items.forEach(item => {
        if (item.type === 'widget' && item.widgetConfig && !('adguardPass' in item.widgetConfig)) {
          const prev = existing.items.find(e => e.id === item.id);
          if (prev?.widgetConfig?.adguardPass)
            item.widgetConfig.adguardPass = prev.widgetConfig.adguardPass;
        }
        /* Preserve myspeedPass */
        if (item.type === 'widget' && item.widgetType === 'stats' &&
            item.widgetConfig?.network && !('myspeedPass' in item.widgetConfig.network)) {
          const prev = existing.items.find(e => e.id === item.id);
          if (prev?.widgetConfig?.network?.myspeedPass)
            item.widgetConfig.network.myspeedPass = prev.widgetConfig.network.myspeedPass;
        }
        /* Preserve connections VPN secrets (apiKey / token) when the browser omitted them */
        if (item.type === 'widget' && item.widgetType === 'connections' && item.widgetConfig?.vpn) {
          const prev = existing.items.find(e => e.id === item.id);
          const v = item.widgetConfig.vpn, pv = prev?.widgetConfig?.vpn;
          if (!('apiKey' in v) && pv?.apiKey) v.apiKey = pv.apiKey;
          if (!('token'  in v) && pv?.token)  v.token  = pv.token;
          if (v.apiKey) v.apiKeySet = true;
          if (v.token)  v.tokenSet  = true;
        }
        /* Preserve connections map service tokens (by service id) when the browser omitted them */
        if (item.type === 'widget' && item.widgetType === 'connections' && Array.isArray(item.widgetConfig?.services)) {
          const prev = existing.items.find(e => e.id === item.id);
          const prevSvcs = prev?.widgetConfig?.services || [];
          item.widgetConfig.services.forEach(s => {
            if (!s) return;
            const ps = prevSvcs.find(p => p && p.id === s.id);
            if (ps) MAP_SVC_SECRETS.forEach(k => { if (!(k in s) && ps[k]) s[k] = ps[k]; });
          });
        }
        /* Preserve per-slot passwords that weren't re-submitted */
        if (item.type === 'widget' && item.widgetType === 'duplicati' && Array.isArray(item.widgetConfig?.slots)) {
          const prev = existing.items.find(e => e.id === item.id);
          const prevSlots = prev?.widgetConfig?.slots || [];
          item.widgetConfig.slots = item.widgetConfig.slots.map((slot, i) => {
            const ps = prevSlots[i] || {};
            if (!slot.dupPass   && ps.dupPass)   { slot.dupPass=ps.dupPass;     slot.dupPassSet=true; }
            if (!slot.kopiaPass && ps.kopiaPass)  { slot.kopiaPass=ps.kopiaPass; slot.kopiaPassSet=true; }
            if (slot.dupPass)   slot.dupPassSet=true;
            if (slot.kopiaPass) slot.kopiaPassSet=true;
            return slot;
          });
          /* Propagate passwords across slots sharing the same URL */
          item.widgetConfig.slots.forEach((slot, i) => {
            if (slot.provider === 'duplicati' && slot.dupUrl && !slot.dupPass) {
              const donor = item.widgetConfig.slots.find((s,j) => j!==i && s.provider==='duplicati' && s.dupUrl===slot.dupUrl && s.dupPass);
              if (donor) { slot.dupPass=donor.dupPass; slot.dupPassSet=true; }
            }
            if (slot.provider === 'kopia' && slot.kopiaUrl && !slot.kopiaPass) {
              const donor = item.widgetConfig.slots.find((s,j) => j!==i && s.provider==='kopia' && s.kopiaUrl===slot.kopiaUrl && s.kopiaPass);
              if (donor) { slot.kopiaPass=donor.kopiaPass; slot.kopiaPassSet=true; }
            }
          });
        }
      });
    }
    /* Preserve githubToken — stripped from GET response, never round-tripped */
    if (existing.settings?.githubToken && !data.settings?.githubToken) {
      data.settings = data.settings || {};
      data.settings.githubToken = existing.settings.githubToken;
    }
    saveConfig(data);
    log.audit('config saved', {});
    json(res, 200, { ok:true });
  } catch(e) { json(res, 400, { error:e.message }); }
});

on('GET', '/api/config/export', (_, res) => {
  /* Export uses the same secret-scrubbing as GET /api/config — secrets are
     never written to an exported file. Restored configs re-prompt for credentials. */
  const d = JSON.stringify(scrubSecrets(loadConfig()), null, 2);
  res.writeHead(200, { 'Content-Type':'application/json', 'Content-Disposition':'attachment; filename="dashboard-apps.json"', 'Content-Length':Buffer.byteLength(d) });
  res.end(d);
});

// ── Health / ping ──

on('GET', '/health', (_, res) => json(res, 200, { ok:true }));

on('GET', '/api/health', async(_, res) => {
  const containers = await fetchContainerHealth();
  const cfg = loadConfig(), result = {};
  await Promise.allSettled(cfg.items
    .filter(i => i.type==='app' && (i.container||i.ping||i.monitoring?.healthcheck?.enabled))
    .map(async item => {
      const mon   = item.monitoring?.healthcheck || {};
      const cName = mon.container || item.container || '';
      const ping  = mon.pingUrl   || item.ping    || '';
      let unhealthy = false;
      if (cName) {
        const norm = cName.toLowerCase().replace(/[\s_]+/g,'-');
        const c    = containers[cName] || containers[norm];
        unhealthy  = !c || c.unhealthy;
        result[item.id] = { unhealthy, state:c?.state||'unknown', status:c?.status||'' };
      }
      if (ping) {
        const r = await pingUrl(ping, 6000, item.skipTlsVerify === true);
        if (!r.ok) unhealthy = true;
        result[item.id] = { unhealthy, pingStatus:r.status, pingError:r.error };
      }
    }));
  json(res, 200, result);
});

on('POST', '/api/ping', async(req, res) => {
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'ping', 30, 60_000);
    if (limited) return json(res, 429, { ok:false, error:limited });
    const { url, skipTls=false } = JSON.parse(await readBody(req));
    if (!url) return json(res, 400, { ok:false, error:'url required' });
    const ssrfErr = await strictCheckSsrf(url);
    if (ssrfErr) return json(res, 403, { ok:false, error:ssrfErr });
    json(res, 200, await pingUrl(url, 6000, skipTls === true));
  } catch(e) { json(res, 200, { ok:false, status:0, error:e.message }); }
});

// ── Badges ──

on('GET', '/api/badges', async(_, res) => {
  const cfg = loadConfig(), out = {};
  await Promise.allSettled(cfg.items
    .filter(i => i.type==='app' && (
      (i.badge?.enabled && i.badge?.url) ||
      (i.monitoring?.activity?.enabled && i.monitoring?.activity?.url)
    ))
    .map(async item => {
      try {
        const src = item.monitoring?.activity?.enabled ? item.monitoring.activity : item.badge;
        const baseUrl = rewriteUrl(src.url);
        const url = src.params && Object.keys(src.params).length
          ? baseUrl + (baseUrl.includes('?') ? '&' : '?') + new URLSearchParams(src.params)
          : baseUrl;
        const r   = await fetchJSON(url, { headers: src.headers||{}, timeout:6000, skipTls: item.skipTlsVerify === true });
        const badge = item.monitoring?.activity?.enabled ? {
          extract: item.monitoring.activity.extract,
          params:  item.monitoring.activity.params,
        } : item.badge;
        out[item.id] = { value: computeBadgeValue(r.data, badge), raw:r.data };
      } catch(e) { out[item.id] = { value:0, error:e.message }; }
    }));
  json(res, 200, out);
});

on('POST', '/api/badge-proxy', async(req, res) => {
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'badge-proxy', 60, 60_000);
    if (limited) return json(res, 429, { error:limited });
    const { url, headers={}, params={}, skipTls=false } = JSON.parse(await readBody(req));
    if (!url) return json(res, 400, { error:'url required' });
    const ssrfErr = await strictCheckSsrf(url);
    if (ssrfErr) return json(res, 403, { error:ssrfErr });
    const fullUrl = Object.keys(params).length ? url + (url.includes('?') ? '&' : '?') + new URLSearchParams(params) : url;
    const r = await fetchJSON(fullUrl, { headers, timeout:8000, skipTls: skipTls === true });
    json(res, 200, { status:r.status, data:r.data, numbers:collectNumbers(r.data) });
  } catch(e) { json(res, 502, { error:e.message }); }
});

// ── System stats ──

on('GET', '/api/system-stats', async(req, res) => {
  try {
    const cfg = loadConfig();
    const id  = new URL(req.url, 'http://x').searchParams.get('id') || '';
    const widget = cfg.items?.find(i => i.id === id && i.type === 'widget');
    const slots  = widget?.widgetConfig?.slots || [];

    /* Collect unique mount paths from disk slots */
    const mounts = new Set();
    for (const s of slots) {
      if (s.type !== 'disk') continue;
      if (s.primary)   mounts.add(s.primary);
      if (s.secondary) mounts.add(s.secondary);
    }
    /* Fall back to the global diskMount setting if no widget-specific mounts */
    if (!mounts.size) mounts.add(cfg.settings?.stats?.diskMount || '/');

    const [cpu, ...diskResults] = await Promise.all([
      cpuPercent(),
      ...[...mounts].map(m => Promise.resolve({ mount: m, ...diskStats(m) })),
    ]);
    const ram   = ramPercent();
    const temps = (() => {
      const zones = new Set([0]);
      for (const s of slots) if (s.type === 'temp' && Number.isInteger(s.thermalZone)) zones.add(s.thermalZone);
      const out = {};
      for (const z of zones) { const t = cpuTemp(z); if (t !== null) out[z] = t; }
      return out;
    })();

    json(res, 200, { cpu, ram, temp: temps[0] ?? null, temps, disks: diskResults });
  } catch(e) { json(res, 500, { error:e.message }); }
});

// ── Network stats background poller ──

let _netCache = { rx:0, tx:0 };
let _netPrev  = null;

function _sampleNet(iface) {
  try {
    const text = fs.readFileSync('/proc/net/dev', 'utf8');
    const line = text.split('\n').find(l => l.trim().startsWith(iface));
    if (!line) return null;
    const p = line.trim().split(/\s+/);
    return { rx: parseInt(p[1],10)||0, tx: parseInt(p[9],10)||0, ts: Date.now() };
  } catch { return null; }
}

function _updateNetCache() {
  const cfg   = loadConfig();
  const iface = cfg.settings?.stats?.networkInterface || 'eth0';
  const cur   = _sampleNet(iface);
  if (cur && _netPrev) {
    const dt = (cur.ts - _netPrev.ts) / 1000;
    if (dt > 0) _netCache = { rx: Math.round((cur.rx - _netPrev.rx) / dt), tx: Math.round((cur.tx - _netPrev.tx) / dt) };
  }
  _netPrev = cur;
}

_updateNetCache();
setInterval(_updateNetCache, 2000);

on('GET', '/api/network-stats', (_, res) => {
  json(res, 200, _netCache);
});

// ── Widget config ──

on('GET', '/api/widget-config/:id', (req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error:'widget not found' });
  /* Never expose stored secrets to the browser — the server proxies all API calls. */
  const wc = JSON.parse(JSON.stringify(w.widgetConfig || {}));
  ['adguardPass','githubToken'].forEach(k => delete wc[k]);
  if (wc.network) delete wc.network.myspeedPass;
  if (Array.isArray(wc.slots)) wc.slots.forEach(s => { if(s){ delete s.dupPass; delete s.kopiaPass; } });
  if (wc.vpn) { delete wc.vpn.apiKey; delete wc.vpn.token; }
  if (Array.isArray(wc.services)) wc.services.forEach(sv => { if (sv) MAP_SVC_SECRETS.forEach(k => { if (k in sv) { sv[k+'Set'] = true; delete sv[k]; } }); });
  json(res, 200, { widgetSize: w.widgetSize || 'medium', widgetConfig: wc });
});

// ── Connections: VPN view ──

/* Gluetun's /v1/publicip/ip returns a country NAME, not an ISO code. Map the
   common VPN-exit countries to ISO-3166 alpha-2 so the widget can show a flag;
   unknown names simply yield no code (widget omits the flag). */
const COUNTRY_TO_ISO2 = {
  'united states':'US','united states of america':'US','usa':'US','canada':'CA','mexico':'MX',
  'united kingdom':'GB','uk':'GB','ireland':'IE','netherlands':'NL','germany':'DE','france':'FR',
  'spain':'ES','portugal':'PT','italy':'IT','switzerland':'CH','austria':'AT','belgium':'BE',
  'luxembourg':'LU','sweden':'SE','norway':'NO','denmark':'DK','finland':'FI','iceland':'IS',
  'poland':'PL','czechia':'CZ','czech republic':'CZ','romania':'RO','bulgaria':'BG','hungary':'HU',
  'greece':'GR','ukraine':'UA','estonia':'EE','latvia':'LV','lithuania':'LT','moldova':'MD',
  'russia':'RU','turkey':'TR','israel':'IL','united arab emirates':'AE','japan':'JP','south korea':'KR',
  'korea':'KR','singapore':'SG','hong kong':'HK','taiwan':'TW','india':'IN','indonesia':'ID',
  'malaysia':'MY','thailand':'TH','vietnam':'VN','philippines':'PH','australia':'AU','new zealand':'NZ',
  'brazil':'BR','argentina':'AR','chile':'CL','colombia':'CO','south africa':'ZA','egypt':'EG',
  'serbia':'RS','croatia':'HR','slovakia':'SK','slovenia':'SI',
};
function nameToIso2(name){
  if (!name) return '';
  return COUNTRY_TO_ISO2[String(name).trim().toLowerCase()] || '';
}
const normBase = u => u ? (u.includes('://') ? u : `http://${u}`) : '';

on('GET', '/api/connections/vpn/:id', async(req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error:'widget not found' });
  const vpn = w.widgetConfig?.vpn || {};
  const svc = vpn.service || 'gluetun';
  const out = { service: svc, name: vpn.name || '', href: vpn.href || '', color: vpn.color || '#30D158', connected:false, status:'unknown' };

  try {
    if (svc === 'gluetun') {
      const base = normBase(vpn.url);
      if (!base) throw new Error('No control server URL configured');
      const headers = vpn.apiKey ? { 'X-API-Key': vpn.apiKey } : {};
      /* Public IP is the source of truth: if the control server returns it, the
         tunnel is up and we have the exit location. Check status codes so an
         auth-required (401/403) or other failure surfaces instead of reading as
         "not secured". */
      let ipRes = null;
      try { ipRes = await fetchJSON(base + '/v1/publicip/ip', { headers, timeout:7000 }); }
      catch(e) { out.error = e.code || e.message || 'unreachable'; }
      if (ipRes) {
        if (ipRes.status === 401 || ipRes.status === 403) out.error = 'Auth required — set the API key';
        else if (ipRes.status >= 400) out.error = 'Control server HTTP ' + ipRes.status;
        else {
          const d = ipRes.data || {};
          out.ip = d.public_ip || d.ip || '';
          out.city = d.city || ''; out.region = d.region || ''; out.country = d.country || '';
          out.countryCode = (d.country_code || nameToIso2(d.country) || '').toUpperCase();
          out.org = d.organization || d.org || '';
          { const L = d.location || d.loc; if (L) { const p = String(L).split(','); out.lat = +p[0]; out.lng = +p[1]; } }
        }
      }
      /* VPN status flag (best-effort) — never overrides a good public-IP result */
      if (!out.error) {
        try {
          let s = await fetchJSON(base + '/v1/vpn/status', { headers, timeout:6000 });
          if (s.status === 404) s = await fetchJSON(base + '/v1/openvpn/status', { headers, timeout:6000 });
          if (s.status < 400 && s.data && s.data.status) out.status = s.data.status;
        } catch(e) { /* ignore — publicip already decided */ }
        out.connected = !!out.ip || out.status === 'running';
      }
    } else {
      /* NetBird mesh: count connected peers + a representative location */
      let base = normBase(vpn.url).replace(/\/+$/,'');
      if (!base) throw new Error('No management API URL configured');
      const apiBase = /\/api$/.test(base) ? base : base + '/api';
      const headers = { 'Authorization': `Token ${vpn.token || ''}`, 'Accept':'application/json' };
      const r = await fetchJSON(apiBase + '/peers', { headers, timeout:8000 });
      if (r.status === 401 || r.status === 403) throw new Error('Auth failed — check the access token');
      if (r.status >= 400) throw new Error('Management API HTTP ' + r.status);
      const peers = Array.isArray(r.data) ? r.data : [];
      const connected = peers.filter(p => p && p.connected);
      out.peersTotal = peers.length;
      out.peersConnected = connected.length;
      out.connected = connected.length > 0;
      out.status = out.connected ? 'running' : 'stopped';
      const rep = connected.slice()
        .sort((a,b) => new Date(b.last_seen||0) - new Date(a.last_seen||0))
        .find(p => p.city_name || p.country_code) || connected[0] || null;
      if (rep) {
        out.city = rep.city_name || '';
        out.countryCode = (rep.country_code || '').toUpperCase();
        out.country = out.countryCode;
        out.hostname = rep.hostname || rep.name || '';
      }
    }
  } catch(e) { out.error = e.message; }

  json(res, 200, out);
});

// ── Map ──

const MAP_DEFAULT_COLOR = { conduit:'#AF52DE', gluetun:'#30D158', netbird:'#FF9F0A', plausible:'#5E5CE6', umami:'#64D2FF' };
const MAP_SVC_SECRETS = ['token','apiKey','password'];
const mapNormBase = u => (u && u.includes('://')) ? u : ('http://' + u);
function mapServices(wc){
  if (Array.isArray(wc.services) && wc.services.length) return wc.services;
  const out = [];  /* legacy single-instance config → synthesize a services array */
  if (wc.conduit?.url) out.push({ id:'conduit', type:'conduit', name:wc.conduit.name||'Conduit', color:wc.conduit.color||MAP_DEFAULT_COLOR.conduit, url:wc.conduit.url, adminUrl:wc.conduit.adminUrl||'', enabled:wc.conduit.enabled!==false });
  if (wc.gluetun?.url) out.push({ id:'gluetun', type:'gluetun', name:wc.gluetun.name||'Gluetun', color:wc.gluetun.color||MAP_DEFAULT_COLOR.gluetun, url:wc.gluetun.url, adminUrl:wc.gluetun.adminUrl||'', enabled:wc.gluetun.enabled!==false });
  return out;
}
function mapRawGet(base, path, headers){
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(path, base); } catch(e){ return reject(e); }
    const lib = u.protocol === 'https:' ? https : http;
    const port = u.port ? parseInt(u.port) : (u.protocol === 'https:' ? 443 : 80);
    const r2 = lib.get({ hostname:u.hostname, port, path:u.pathname + u.search, timeout:8000, headers:headers||{} }, rs => {
      const chunks = []; rs.on('data', c => chunks.push(c));
      rs.on('end', () => resolve({ status:rs.statusCode, body:Buffer.concat(chunks).toString('utf8') }));
    });
    r2.on('timeout', () => { r2.destroy(); reject(new Error('Timed out')); });
    r2.on('error', reject);
  });
}
function parseConduitText(raw){
  const regions = {}; let limit = 0, connected = 0, live = 0;
  String(raw).split('\n').forEach(line => {
    let m;
    if ((m = line.match(/^conduit_region_connected_clients\{region="([A-Z]{2})",scope="common"\}\s+([\d.eE+]+)/))) { const v = Math.round(parseFloat(m[2])); if (v > 0) regions[m[1]] = v; }
    else if ((m = line.match(/^conduit_max_common_clients\s+([\d.eE+]+)/))) limit = parseFloat(m[1]);
    else if ((m = line.match(/^conduit_connected_clients\s+([\d.eE+]+)/))) connected = parseFloat(m[1]);
    else if ((m = line.match(/^conduit_is_live\s+([\d.eE+]+)/))) live = parseFloat(m[1]);
  });
  return { regions, limit, connected, live };
}

on('GET', '/api/map-data/:id', async(req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error:'widget not found' });
  const wc = w.widgetConfig || {};
  const services = mapServices(wc).filter(s => s && s.enabled !== false && s.url);
  const results = await Promise.all(services.map(async (s, idx) => {
    const base = mapNormBase(s.url);
    const o = { id: s.id || (s.type + '-' + idx), type: s.type,
      name: s.name || (s.type.charAt(0).toUpperCase() + s.type.slice(1)),
      color: s.color || MAP_DEFAULT_COLOR[s.type] || '#AF52DE', adminUrl: s.adminUrl || '' };
    try {
      if (s.type === 'conduit') {
        const r = await mapRawGet(base, '/metrics');
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        Object.assign(o, { kind:'regions' }, parseConduitText(r.body));
      } else if (s.type === 'gluetun') {
        const r = await fetchJSON(base + '/v1/publicip/ip', { headers: s.apiKey ? { 'X-API-Key': s.apiKey } : {} });
        if (r.status === 401) throw new Error('Auth required — set the API key');
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        const d = r.data || {}; const L = d.location || d.loc;
        o.kind = 'point'; o.city = d.city || ''; o.country = d.country || '';
        if (L) { const p = String(L).split(','); o.lat = +p[0]; o.lng = +p[1]; }
      } else if (s.type === 'netbird') {
        const r = await fetchJSON(base + '/api/peers', { headers: s.token ? { 'Authorization': 'Token ' + s.token } : {} });
        if (r.status === 401 || r.status === 403) throw new Error('Auth required — check the token');
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        const peers = Array.isArray(r.data) ? r.data : [];
        const regions = {}; let conn = 0;
        peers.forEach(p => { if (p && p.connected) { conn++; const cc = (p.country_code || '').toUpperCase(); if (cc) regions[cc] = (regions[cc] || 0) + 1; } });
        o.kind = 'regions'; o.regions = regions; o.connected = conn; o.peersTotal = peers.length; o.limit = 0;
      } else if (s.type === 'plausible') {
        const body = JSON.stringify({ site_id: s.siteId || '', metrics: ['visitors'], date_range: '7d', dimensions: ['visit:country'] });
        const r = await fetchJSON(base + '/api/v2/query', { method:'POST', headers: { 'Content-Type':'application/json', 'Authorization': s.apiKey ? ('Bearer ' + s.apiKey) : '' }, body });
        if (r.status === 401 || r.status === 403) throw new Error('Auth required — check the API key');
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        const rows = (r.data && r.data.results) || [];
        const regions = {}; let total = 0;
        rows.forEach(row => { const cc = (row.dimensions && row.dimensions[0] || '').toUpperCase(); const v = (row.metrics && +row.metrics[0]) || 0; if (cc && v > 0) { regions[cc] = (regions[cc] || 0) + v; total += v; } });
        o.kind = 'regions'; o.regions = regions; o.connected = total; o.limit = 0;
      } else if (s.type === 'umami') {
        const lg = await fetchJSON(base + '/api/auth/login', { method:'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ username: s.username || '', password: s.password || '' }) });
        if (lg.status === 401 || lg.status === 403) throw new Error('Auth required — check username/password');
        if (lg.status >= 400) throw new Error('Login HTTP ' + lg.status);
        const token = lg.data && lg.data.token;
        if (!token) throw new Error('Login failed');
        const end = Date.now(), start = end - 7*24*3600*1000;
        const r = await fetchJSON(base + '/api/websites/' + encodeURIComponent(s.websiteId || '') + '/metrics?type=country&startAt=' + start + '&endAt=' + end, { headers: { 'Authorization': 'Bearer ' + token } });
        if (r.status >= 400) throw new Error('HTTP ' + r.status);
        const rows = Array.isArray(r.data) ? r.data : [];
        const regions = {}; let total = 0;
        rows.forEach(row => { const cc = (row.x || '').toUpperCase(); const v = +row.y || 0; if (cc && v > 0) { regions[cc] = (regions[cc] || 0) + v; total += v; } });
        o.kind = 'regions'; o.regions = regions; o.connected = total; o.limit = 0;
      } else {
        o.error = 'Unsupported service type';
      }
    } catch(e) { o.error = e.message || String(e); }
    return o;
  }));
  json(res, 200, { services: results, meta: { showLegend: wc.showLegend !== false } });
});

on('GET', '/api/map-data-debug/:id', async(req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error:'widget not found', items:cfg.items?.map(i=>({id:i.id,type:i.type})) });
  const wc = w.widgetConfig || {};
  json(res, 200, { widgetConfig:wc, conduitEnabled:wc.conduit?.enabled, conduitUrl:wc.conduit?.url, gluetunEnabled:wc.gluetun?.enabled, gluetunUrl:wc.gluetun?.url });
});

// ── Scrutiny proxy — used by admin panel before widget is saved ──
// Accepts ?url= param so admin can fetch devices without a widget id yet.

on('GET', '/api/scrutiny-proxy', async(req, res) => {
  const u    = new URL(req.url, 'http://x');
  const raw  = u.searchParams.get('url') || '';
  if (!raw) return json(res, 400, { error:'url param required' });
  try {
    const base    = raw.includes('://') ? raw.replace(/\/$/, '') : `http://${raw.replace(/\/$/,'')}`;
    const r       = await fetchJSON(base + '/api/summary', { timeout: 8000 });
    const summary = r.data?.data?.summary || {};
    const devices = Object.values(summary)
      .filter(e => e.device?.smart_support?.available === true && e.smart)
      .map(e => ({
        device_id:   e.device.device_id,
        model_name:  e.device.model_name || e.device.device_serial_id || e.device.device_name,
        device_name: e.device.device_name,
        capacity:    e.device.capacity,
      }));
    json(res, 200, { devices });
  } catch(e) { json(res, 502, { error: e.message }); }
});

// ── Scrutiny — admin device list (saved widget) ──

on('GET', '/api/scrutiny-devices/:id', async(req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error:'widget not found' });
  const url = w.widgetConfig?.scrutinyUrl;
  if (!url) return json(res, 400, { error:'scrutinyUrl not configured' });
  try {
    const base = url.includes('://') ? url.replace(/\/$/, '') : `http://${url.replace(/\/$/,'')}`;
    const r    = await fetchJSON(base + '/api/summary', { timeout: 8000 });
    const summary = r.data?.data?.summary || {};
    /* Return only drives with SMART support available */
    const devices = Object.values(summary)
      .filter(entry => entry.device?.smart_support?.available === true && entry.smart)
      .map(entry => ({
        device_id:   entry.device.device_id,
        model_name:  entry.device.model_name  || entry.device.device_serial_id || entry.device.device_name,
        device_name: entry.device.device_name,
        capacity:    entry.device.capacity,
      }));
    json(res, 200, { devices });
  } catch(e) { json(res, 502, { error: e.message }); }
});

// ── Disk Health widget polling ──

on('GET', '/api/disk-health/:id', async(req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error:'widget not found' });
  const wc  = w.widgetConfig || {};
  const url = wc.scrutinyUrl;
  if (!url) return json(res, 503, { error:'scrutinyUrl not configured' });
  const bays = wc.bays || []; /* array of device_id strings or null */

  try {
    const base = url.includes('://') ? url.replace(/\/$/, '') : `http://${url.replace(/\/$/,'')}`;
    const r    = await fetchJSON(base + '/api/summary', { timeout: 8000 });
    const summary = r.data?.data?.summary || {};

    /* Build a map: device_id → summary entry */
    const byId = {};
    Object.values(summary).forEach(entry => {
      if (entry.device?.device_id) byId[entry.device.device_id] = entry;
    });

    const result = bays.map(deviceId => {
      if (!deviceId) return null;
      const entry = byId[deviceId];
      if (!entry) return { device_id:deviceId, device_status:0, hasSmart:false, error:'not found' };
      return {
        device_id:     deviceId,
        device_status: entry.device.device_status ?? 0,
        hasSmart:      !!(entry.smart),
        model_name:    entry.device.model_name || entry.device.device_serial_id || entry.device.device_name,
        device_name:   entry.device.device_name,
        temp:          entry.smart?.temp ?? null,
        capacity:      entry.device.capacity || null,
      };
    });

    json(res, 200, { bays: result, href: wc.scrutinyHref || '' });
  } catch(e) { json(res, 502, { error: e.message }); }
});

on('GET', '/api/speed-data/:id', async(req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error:'widget not found' });
  const net = w.widgetConfig?.network;
  if (!net?.enabled || !net?.url) return json(res, 503, { error:'network slot not configured' });

  const provider = net.provider || 'myspeed';
  const base     = net.url.includes('://') ? net.url.replace(/\/$/, '') : `http://${net.url.replace(/\/$/,'')}`;

  try {
    if (provider === 'speedtest-tracker') {
      /* Legacy endpoint — no auth required */
      const r = await fetchJSON(base + '/api/speedtest/latest', { timeout: 8000 });
      const row = r.data?.data;
      if (!row?.id) return json(res, 502, { error:'No result from Speedtest Tracker' });
      json(res, 200, {
        download: row.download,
        upload:   row.upload,
        ping:     row.ping,
        failed:   row.failed || false,
        ts:       row.created_at,
      });
    } else {
      /* MySpeed — optional x-password header */
      const headers = {};
      if (net.myspeedPass) headers['x-password'] = net.myspeedPass;
      const r = await fetchJSON(base + '/api/speedtests?limit=1', { headers, timeout: 8000 });
      if (r.status === 401) return json(res, 401, { error:'MySpeed returned 401 — check password' });
      const row = Array.isArray(r.data) ? r.data[0] : r.data;
      if (!row) return json(res, 502, { error:'No result from MySpeed' });
      json(res, 200, {
        download: row.download,
        upload:   row.upload,
        ping:     row.ping,
        failed:   false,
        ts:       row.created,
      });
    }
  } catch(e) { json(res, 502, { error:e.message }); }
});


on('GET', '/api/github-token', (_, res) => {
  const cfg = loadConfig();
  json(res, 200, { configured: !!cfg.settings?.githubToken });
});

on('POST', '/api/github-token', async(req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const { token = '' } = JSON.parse(await readBody(req));
    const cfg = loadConfig();
    cfg.settings = cfg.settings || {};
    if (token.trim()) cfg.settings.githubToken = token.trim();
    else delete cfg.settings.githubToken;
    saveConfig(cfg);
    json(res, 200, { ok: true });
  } catch(e) { json(res, 400, { error: e.message }); }
});

// ── GitHub ──
// Shared helper: resolves the stored GitHub token for a widget item.
// Token lives in settings.githubToken (server-side, never sent to browser).
function getGithubToken() {
  return loadConfig().settings?.githubToken || null;
}

on('GET', '/api/github-data/:id', async(req, res) => {
  const token = getGithubToken();
  if (!token) return json(res, 503, { error: 'GitHub token not configured' });

  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error: 'widget not found' });

  const wc       = w.widgetConfig || {};
  const username = wc.githubUser;
  if (!username) return json(res, 503, { error: 'GitHub username not configured' });

  const view = req.url.includes('view=prs') || wc.githubView !== 'contributions' ? 'prs' : 'contributions';

  if (view === 'contributions') {
    /* Contribution calendar via GraphQL — requires classic PAT with read:user
       or fine-grained PAT with "User contributions" read access.
       Private repo contributions only appear with correct token scope. */
    try {
      const query = `query($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  contributionCount
                  date
                }
              }
            }
          }
        }
      }`;
      const r = await fetchJSON('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'homelab-dashboard/1.0',
        },
        body: JSON.stringify({ query, variables: { login: username } }),
        timeout: 10000,
      });
      if (r.status === 401) return json(res, 401, { error: 'Invalid GitHub token' });
      if (r.data?.errors) return json(res, 502, { error: r.data.errors[0]?.message || 'GraphQL error' });
      const cal  = r.data?.data?.user?.contributionsCollection?.contributionCalendar || {};
      const weeks = cal.weeks || [];
      json(res, 200, { view: 'contributions', weeks, totalContributions: cal.totalContributions || 0 });
    } catch(e) { json(res, 502, { error: e.message }); }
    return;
  }

  /* Pull Requests */
  try {
    const filters  = (wc.githubPrFilters || [wc.githubPrFilter || 'created']);
    const filterArr = Array.isArray(filters) ? filters : [filters];

    /* Build search qualifier — OR across selected filters */
    const qualifiers = filterArr.map(f => {
      if (f === 'created')          return `author:${username}`;
      if (f === 'assigned')         return `assignee:${username}`;
      if (f === 'mentioned')        return `mentions:${username}`;
      if (f === 'review-requested') return `review-requested:${username}`;
      return `author:${username}`;
    });
    /* Combine with OR — GitHub search supports multiple qualifiers; use first for primary count */
    const qualifier = qualifiers.join(' ');
    const q   = encodeURIComponent(`is:open is:pr ${qualifier}`);
    const url = `https://api.github.com/search/issues?q=${q}&sort=updated&order=desc&per_page=20`;

    const r = await fetchJSON(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'homelab-dashboard/1.0',
      },
      timeout: 10000,
    });
    if (r.status === 401) return json(res, 401, { error: 'Invalid GitHub token' });
    if (r.status === 422) return json(res, 502, { error: 'Invalid search query — check username' });

    const items = (r.data?.items || []).map(pr => {
      const repoMatch = (pr.repository_url || '').match(/repos\/(.+)$/);
      const repo = repoMatch ? repoMatch[1] : '—';
      return { number: pr.number, title: pr.title, repo, url: pr.html_url };
    });

    const labelMap = {
      'created':'created','assigned':'assigned',
      'mentioned':'mentioned','review-requested':'review requested',
    };
    const label = filterArr.map(f => labelMap[f] || f).join(', ');
    const allUrl = `https://github.com/pulls?q=${encodeURIComponent(`is:open is:pr ${qualifier}`)}`;

    json(res, 200, {
      view: 'prs',
      totalCount: r.data?.total_count ?? items.length,
      label,
      allUrl,
      items,
    });
  } catch(e) { json(res, 502, { error: e.message }); }
});


// ── Wallpaper ──

on('GET', '/api/wallpaper', async(_, res) => {
  const cfg = loadConfig(), bg = cfg.settings?.background || {};
  if (bg.type !== 'unsplash') return json(res, 200, { url:null });
  try {
    const p = new URLSearchParams({ orientation:'landscape', content_filter:'high', client_id:bg.apiKey||'' });
    if (bg.collection) p.set('collections', bg.collection);
    const r   = await fetchJSON(`https://api.unsplash.com/photos/random?${p}`);
    const raw = r.data?.urls?.raw;
    if (!raw) return json(res, 200, { url:null, error: r.data?.errors?.[0] || 'No image returned' });
    json(res, 200, { url:`${raw}&w=2800&h=1800&q=85&fm=jpg&fit=crop&crop=entropy` });
  } catch(e) { json(res, 200, { url:null, error:e.message }); }
});

// ── Icons ──

let _iconCache = null, _iconCacheAt = 0;
const ICON_CACHE_TTL = 24 * 60 * 60 * 1000;

on('GET', '/api/icons/search', async(req, res) => {
  const q = (new URL(req.url,'http://x').searchParams.get('q')||'').toLowerCase().trim();
  if (!q) return json(res, 200, { results:[] });
  try {
    if (!_iconCache || (Date.now() - _iconCacheAt) > ICON_CACHE_TTL) {
      const r = await fetchJSON('https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@main/metadata/icons.json');
      _iconCache = Array.isArray(r.data) ? r.data : []; _iconCacheAt = Date.now();
    }
    json(res, 200, { results:_iconCache
      .filter(ic => (ic.name||ic.slug||'').toLowerCase().includes(q))
      .slice(0,20)
      .map(ic => ({ name:ic.name||ic.slug, slug:ic.slug||ic.name,
        svgUrl:`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/${ic.slug||ic.name}.svg`,
        pngUrl:`https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${ic.slug||ic.name}.png` })) });
  } catch(e) { json(res, 502, { error:e.message }); }
});

on('GET', '/api/icons/local', (_, res) => {
  try {
    fs.mkdirSync(ICONS_PATH, { recursive:true });
    json(res, 200, { files:fs.readdirSync(ICONS_PATH).filter(f => /\.(svg|png|ico)$/i.test(f)) });
  } catch(e) { json(res, 500, { error:e.message }); }
});

on('POST', '/api/icons/upload', async(req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'upload', 20, 3_600_000);
    if (limited) return json(res, 429, { error:limited });
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('multipart/form-data')) return json(res, 400, { error:'multipart/form-data required' });
    const bMatch = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/i);
    if (!bMatch) return json(res, 400, { error:'missing boundary' });
    const boundary = bMatch[1] || bMatch[2];
    const buf = await new Promise((resolve, reject) => {
      const chunks = []; let total = 0;
      req.on('data', c => { total += c.length; if (total > 2.5*1024*1024) { req.destroy(); return reject(new Error('file too large (max 2 MB)')); } chunks.push(c); });
      req.on('end',  () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
    const delim = Buffer.from('--' + boundary), CRLFCRLF = Buffer.from('\r\n\r\n');
    let filename = '', fileData = null, searchFrom = 0;
    while (true) {
      const delimPos = buf.indexOf(delim, searchFrom);
      if (delimPos === -1) break;
      const afterDelim = delimPos + delim.length;
      if (buf[afterDelim] === 0x2d && buf[afterDelim+1] === 0x2d) break;
      const headerStart = afterDelim + (buf[afterDelim] === 0x0d ? 2 : 0);
      const headerEnd   = buf.indexOf(CRLFCRLF, headerStart);
      if (headerEnd === -1) break;
      const headerStr  = buf.slice(headerStart, headerEnd).toString('latin1');
      const bodyStart  = headerEnd + 4;
      const nextDelim  = buf.indexOf(Buffer.from('\r\n--' + boundary), bodyStart);
      const bodyEnd    = nextDelim === -1 ? buf.length : nextDelim;
      const fnMatch    = headerStr.match(/filename="([^"]+)"/i);
      if (fnMatch) { filename = path.basename(fnMatch[1]); fileData = buf.slice(bodyStart, bodyEnd); }
      searchFrom = bodyEnd + 2;
    }
    if (!filename || !fileData?.length)       return json(res, 400, { error:'no file found in upload' });
    if (!/\.(svg|png|ico)$/i.test(filename))  return json(res, 400, { error:'only .svg, .png, .ico files allowed' });
    if (fileData.length > 2*1024*1024)        return json(res, 400, { error:'file too large (max 2 MB)' });
    if (/\.svg$/i.test(filename)) {
      const SAFE_ELEMENTS = new Set(['svg','g','path','circle','ellipse','rect','line','polyline','polygon','text','tspan','defs','linearGradient','radialGradient','stop','clipPath','mask','symbol','use','title','desc','style']);
      const SAFE_ATTRS    = new Set(['viewBox','xmlns','width','height','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-dasharray','stroke-dashoffset','opacity','fill-opacity','stroke-opacity','transform','d','cx','cy','r','rx','ry','x','y','x1','y1','x2','y2','points','offset','stop-color','stop-opacity','gradientUnits','gradientTransform','patternUnits','patternTransform','clip-path','mask','id','class','style','preserveAspectRatio','text-anchor','font-size','font-family','font-weight']);
      /* Names are compared lowercased, so the allowlists must be too — otherwise
         camelCase items (viewBox, preserveAspectRatio, linearGradient, …) never
         match and get stripped, leaving icons with no size. */
      const SAFE_ELEMENTS_LC = new Set([...SAFE_ELEMENTS].map(s => s.toLowerCase()));
      const SAFE_ATTRS_LC    = new Set([...SAFE_ATTRS].map(s => s.toLowerCase()));
      const UNSAFE_ATTR_RE = /^(on\w|href|xlink:href|src|action|formaction|data)$/i;
      let svg = fileData.toString('utf8');
      svg = svg.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
      svg = svg.replace(/<(\/?)\s*([a-zA-Z][a-zA-Z0-9:]*)([\s\S]*?)(\/?)?>/g, (match, close, tag, attrs, selfClose) => {
        const localTag = tag.split(':').pop().toLowerCase();
        if (!SAFE_ELEMENTS_LC.has(localTag)) return '';
        const safeAttrs = attrs.replace(/\s([a-zA-Z:_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/g, (m, name) => {
          const lname = name.toLowerCase();
          if (UNSAFE_ATTR_RE.test(lname)) return '';
          if (!SAFE_ATTRS_LC.has(lname) && !lname.startsWith('aria-') && !lname.startsWith('data-')) return '';
          return m;
        });
        return `<${close}${tag}${safeAttrs}${selfClose||''}>`;
      });
      fileData = Buffer.from(svg, 'utf8');
    }
    fs.mkdirSync(ICONS_PATH, { recursive:true });
    fs.writeFileSync(path.join(ICONS_PATH, filename), fileData);
    log.audit('icon uploaded', { filename });
    json(res, 200, { ok:true, filename });
  } catch(e) { json(res, 500, { error:e.message }); }
});

// ── Duplicati ──

/* In-memory token cache: widgetId → { accessToken, refreshNonce, expiresAt } */
const _dupTokens = new Map();

/* Duplicati's /api/v1/backups shape varies across versions: a bare array or an
   object wrapper, and each item may be {Backup:{ID,Name,...}} or flat {ID,Name}.
   These helpers normalise all of those so the rest of the code is shape-agnostic. */
function dupList(d){
  return Array.isArray(d)            ? d
    : Array.isArray(d?.Items)        ? d.Items
    : Array.isArray(d?.Data)         ? d.Data
    : Array.isArray(d?.backups)      ? d.backups
    : Array.isArray(d?.Backups)      ? d.Backups
    : [];
}
function dupCore(j){ return (j && (j.Backup || j.backup)) || j || {}; }
function dupId(j){ const b = dupCore(j); return String(b.ID ?? b.Id ?? b.id ?? ''); }
function dupName(j){ const b = dupCore(j); const id = dupId(j); return b.Name || b.name || (id ? `Job ${id}` : 'Backup'); }
function dupMeta(j){ const b = dupCore(j); return b.Metadata || b.metadata || {}; }
function dupSchedule(j){ return j.Schedule || j.schedule || dupCore(j).Schedule || null; }

async function dupLogin(base, password) {
  const r = await fetchJSON(base + '/api/v1/auth/login', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ Password: password }),
    timeout: 10000,
  });
  if (r.status !== 200) throw new Error(`Duplicati login failed: HTTP ${r.status}`);
  const { AccessToken, RefreshNonce } = r.data || {};
  if (!AccessToken) throw new Error('Duplicati login returned no token');
  return { accessToken: AccessToken, refreshNonce: RefreshNonce };
}

async function dupRefresh(base, refreshNonce) {
  const r = await fetchJSON(base + '/api/v1/auth/refresh', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ RefreshNonce: refreshNonce }),
    timeout: 10000,
  });
  if (r.status !== 200) throw new Error(`Duplicati refresh failed: HTTP ${r.status}`);
  const { AccessToken, RefreshNonce } = r.data || {};
  if (!AccessToken) throw new Error('Duplicati refresh returned no token');
  return { accessToken: AccessToken, refreshNonce: RefreshNonce };
}

async function dupGetToken(widgetId, base, password) {
  const cached = _dupTokens.get(widgetId);
  /* Tokens last 5 min; refresh 30s early */
  if (cached && cached.expiresAt > Date.now() + 30000) return cached.accessToken;
  let tokens;
  if (cached?.refreshNonce) {
    try { tokens = await dupRefresh(base, cached.refreshNonce); }
    catch { tokens = await dupLogin(base, password); }
  } else {
    tokens = await dupLogin(base, password);
  }
  _dupTokens.set(widgetId, {
    accessToken:  tokens.accessToken,
    refreshNonce: tokens.refreshNonce,
    expiresAt:    Date.now() + 4.5 * 60 * 1000, /* 4m30s — 30s before 5m expiry */
  });
  return tokens.accessToken;
}

async function dupFetch(widgetId, base, password, path) {
  const token = await dupGetToken(widgetId, base, password);
  const r = await fetchJSON(base + path, {
    headers: { 'Authorization': `Bearer ${token}` },
    timeout: 10000,
  });
  if (r.status === 401) {
    /* Token rejected — clear cache and retry once */
    _dupTokens.delete(widgetId);
    const token2 = await dupGetToken(widgetId, base, password);
    const r2 = await fetchJSON(base + path, {
      headers: { 'Authorization': `Bearer ${token2}` },
      timeout: 10000,
    });
    return r2;
  }
  return r;
}

function dupNormalizeBase(url) {
  if (!url) throw new Error('Duplicati URL not configured');
  return (url.includes('://') ? url : `http://${url}`).replace(/\/$/, '');
}

/* Parse Duplicati date strings — handles compact ISO (20260603T184718Z) and standard ISO */
function dupParseDate(v) {
  if (!v) return 0;
  const s = String(v).trim();
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (compact) {
    const [,yr,mo,dy,hh,mm,ss] = compact;
    return new Date(`${yr}-${mo}-${dy}T${hh}:${mm}:${ss}Z`).getTime();
  }
  const d = new Date(s);
  return isNaN(d) ? 0 : d.getTime();
}

function dupDeriveStatus(job, serverState) {
  const id        = dupId(job);
  const meta      = dupMeta(job);
  const schedule  = dupSchedule(job);
  const tasks     = serverState?.ActiveTask;
  const proposed  = serverState?.ProposedSchedule || [];

  /* Running: active task matches this job */
  const isRunning = tasks != null && String(tasks.BackupID || tasks.Item1 || '') === id;
  if (isRunning) return 'running';

  /* Error */
  if (serverState?.HasError) return 'error';

  /* Missed: now is past the next scheduled run but last finish is before that run */
  const nextEntry = proposed.find(p => String(p.Item1) === id);
  if (nextEntry && nextEntry.Item2) {
    const nextRun      = new Date(nextEntry.Item2).getTime();
    const lastFinished = dupParseDate(meta.LastBackupFinished || meta.LastBackupDate || '');
    if (Date.now() > nextRun && lastFinished < nextRun) return 'missed';
  }

  /* Warning */
  if (serverState?.HasWarning) return 'warning';

  /* Healthy */
  return 'healthy';
}

/* POST /api/duplicati-jobs/:id — admin Fetch Jobs button
   Body: { url, password? } or { url, useStoredPass: true }
   Returns: [{id, name}] */
on('POST', '/api/duplicati-jobs/:id', async(req, res) => {
  if (!checkOrigin(req, res)) return;
  try {
    const body     = JSON.parse(await readBody(req));
    const url      = (body.url || '').trim();
    if (!url) return json(res, 400, { error: 'url required' });
    const base = dupNormalizeBase(url);

    /* Resolve password: explicit in body, or load from stored config */
    let password = (body.password || '').trim();
    if (!password && body.useStoredPass) {
      const cfg = loadConfig();
      const wid = req.params.id;
      const w   = cfg.items?.find(i => i.id === wid && i.type === 'widget');
      /* Find first slot with matching URL that has a password */
      const slot = (w?.widgetConfig?.slots || []).find(s =>
        s?.provider === 'duplicati' &&
        dupNormalizeBase(s.dupUrl || '') === base &&
        s.dupPass
      );
      password = slot?.dupPass || '';
    }

    /* Get token — use a temporary key for preview fetches */
    const tokenKey = req.params.id + '_jobs_fetch';
    _dupTokens.delete(tokenKey); /* always fresh for admin fetch */
    const token = await dupGetToken(tokenKey, base, password);

    const r = await fetchJSON(base + '/api/v1/backups', {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000,
    });
    if (r.status === 401) return json(res, 401, { error: 'Authentication failed — check password' });

    /* Duplicati responses vary by version: a bare array, or wrapped in an object,
       and each item may be {Backup:{ID,Name}} (wrapped) or flat {ID,Name}. */
    const jobs = dupList(r.data)
      .map(j => ({ id: dupId(j), name: dupName(j) }))
      .filter(j => j.id !== '');

    json(res, 200, jobs);
  } catch(e) { json(res, 502, { error: e.message }); }
});

on('OPTIONS', '*', (_, res) => { setPreflightHeaders(res); res.writeHead(204); res.end(); });

// ── Kopia ──

async function kopiaFetch(url, username, password, path) {
  const headers = {};
  if (username && password) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }
  return fetchJSON(url.replace(/\/$/, '') + path, { headers, timeout: 10000 });
}

/* Derive status from a Kopia source entry */
function kopiaDeriveStatus(source) {
  const status = (source.status || '').toUpperCase();
  if (status === 'UPLOADING' || status === 'RUNNING') return 'running';
  if (status === 'PAUSED') return 'warning';

  const last = source.lastSnapshot;
  if (!last) return 'warning';

  /* Error: non-zero error count in last snapshot */
  if ((last.stats?.errorCount || 0) > 0) return 'error';

  /* Warning: last snapshot older than 25 hours */
  const endTime = last.endTime ? new Date(last.endTime).getTime() : 0;
  if (endTime && Date.now() - endTime > 25 * 60 * 60 * 1000) return 'warning';

  return 'healthy';
}

/* Kopia source ID: host@user:path */
function kopiaSourceId(source) {
  return `${source.host}@${source.userName}:${source.path}`;
}

/* POST /api/kopia-sources/:id — admin Fetch Sources button */
on('POST', '/api/kopia-sources/:id', async(req, res) => {
  let body = {};
  try { body = JSON.parse(await readBody(req)); } catch {}

  const url      = body.url?.trim();
  const username = body.username?.trim() || '';
  let   password = body.password?.trim() || '';

  /* Fall back to stored password if admin didn't re-enter */
  if (!password && body.useStoredPass) {
    const cfg = loadConfig();
    const w   = cfg.items?.find(i => i.id === req.params.id);
    if (w?.widgetConfig?.kopiaPass) password = w.widgetConfig.kopiaPass;
  }

  if (!url) return json(res, 400, { error: 'URL required' });

  try {
    const r = await kopiaFetch(url, username, password, '/api/v1/sources');
    if (r.status === 401) return json(res, 401, { error: 'Kopia authentication failed' });
    if (r.status !== 200) return json(res, 502, { error: `Kopia returned HTTP ${r.status}` });

    const sources = (r.data?.sources || []).map(s => ({
      id:   kopiaSourceId(s.source),
      name: s.source.path,
    }));
    json(res, 200, sources);
  } catch(e) { json(res, 502, { error: e.message }); }
});

/* GET /api/backup-data/:id — unified widget polling, per-slot connection config */
on('GET', '/api/backup-data/:id', async(req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error: 'widget not found' });

  const wc    = w.widgetConfig || {};
  const slots = Array.isArray(wc.slots) ? wc.slots : [];

  /* Group slots by provider+url to batch API calls */
  const dupGroups   = {};  /* url → {base, pass, slots:[{i,jobId}]} */
  const kopiaGroups = {};  /* url → {url, user, pass, slots:[{i,jobId}]} */

  slots.forEach((s, i) => {
    if (!s?.provider || !s.jobId) return;
    if (s.provider === 'duplicati' && s.dupUrl) {
      const base = dupNormalizeBase(s.dupUrl);
      if (!dupGroups[base]) dupGroups[base] = { base, pass: s.dupPass||'', slots:[] };
      dupGroups[base].slots.push({ i, jobId: String(s.jobId), customName: s.customName||'' });
    } else if (s.provider === 'kopia' && s.kopiaUrl) {
      const url = s.kopiaUrl.trim();
      if (!kopiaGroups[url]) kopiaGroups[url] = { url, user: s.kopiaUser||'', pass: s.kopiaPass||'', slots:[] };
      kopiaGroups[url].slots.push({ i, jobId: s.jobId, customName: s.customName||'' });
    }
  });

  const result = Array(slots.length).fill(null);

  try {
    /* ── Duplicati groups ── */
    await Promise.all(Object.values(dupGroups).map(async ({base, pass, slots: gs}) => {
      try {
        const [stateR, backupsR] = await Promise.all([
          dupFetch(req.params.id, base, pass, '/api/v1/serverstate'),
          dupFetch(req.params.id, base, pass, '/api/v1/backups'),
        ]);
        if (stateR.status === 401 || backupsR.status === 401) return;
        const serverState = stateR.data || {};
        const backups     = dupList(backupsR.data);
        const proposed    = {};
        (serverState.ProposedSchedule||[]).forEach(p=>{ if(p.Item1&&p.Item2) proposed[String(p.Item1)]=p.Item2; });
        gs.forEach(({i, jobId, customName}) => {
          const j = backups.find(b => dupId(b) === jobId);
          if (!j) return;
          const id = dupId(j);
          const meta = dupMeta(j);
          result[i] = { id, name: customName || dupName(j),
            status: dupDeriveStatus(j, serverState),
            lastFinished: meta.LastBackupFinished||meta.LastBackupDate||meta.LastBackupStarted||null,
            nextRun: proposed[id]||dupSchedule(j)?.Time||null };
        });
      } catch {}
    }));

    /* ── Kopia groups ── */
    await Promise.all(Object.values(kopiaGroups).map(async ({url, user, pass, slots: gs}) => {
      try {
        const r = await kopiaFetch(url, user, pass, '/api/v1/sources');
        if (r.status !== 200) return;
        const allSources = r.data?.sources||[];
        gs.forEach(({i, jobId, customName}) => {
          const s = allSources.find(src => kopiaSourceId(src.source) === jobId);
          if (!s) return;
          result[i] = { id: kopiaSourceId(s.source), name: customName || s.source.path,
            status: kopiaDeriveStatus(s),
            lastFinished: s.lastSnapshot?.endTime||null, nextRun: null };
        });
      } catch {}
    }));

    json(res, 200, result);   /* indexed by slot — nulls kept so the widget maps by index */
  } catch(e) { json(res, 502, { error: e.message }); }
});
