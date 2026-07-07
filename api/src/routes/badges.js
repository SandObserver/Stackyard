const { on, json, readBody, getIp } = require('../router');
const { loadConfig } = require('../config');
const { fetchJSON, pingUrl, strictCheckSsrf, rewriteUrl } = require('../proxy');
const { rateLimit } = require('../auth');

function collectNumbers(obj, path='', out=[], _depth=0, _state={n:0}) {
  const MAX_DEPTH = 6, MAX_NODES = 256;
  if (_state.n++ > MAX_NODES || _depth > MAX_DEPTH || obj == null) return out;
  if (typeof obj === 'number') { out.push({ path:path||'(root)', value:obj }); return out; }
  if (Array.isArray(obj)) {
    const countPath = path ? `${path}.$count` : '$count';
    out.push({ path:countPath, value:obj.length, label:`${path||'root'} — count` });
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
    if (seg === '$count' || seg === 'count') return Array.isArray(cur) ? cur.length : undefined;
    const fM = seg.match(filterRe);
    if (fM) {
      const [, field, rawVal] = fM;
      const val = rawVal === 'true' ? true : rawVal === 'false' ? false : rawVal;
      cur = Array.isArray(cur) ? cur.filter(item => item && item[field] === val) : undefined;
      continue;
    }
    const bare = seg.match(/^\[(\d+)\]$/);
    if (bare) { cur = Array.isArray(cur) ? cur[+bare[1]] : undefined; continue; }
    const named = seg.match(/^(\w+)\[(\d+)\]$/);
    if (named) { cur = Array.isArray(cur[named[1]]) ? cur[named[1]][+named[2]] : undefined; continue; }
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

on('POST', '/api/ping', async(req, res) => {
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'ping', 30, 60_000);
    if (limited) return json(res, 429, { ok:false, error:limited });
    const { url, skipTls=false } = JSON.parse(await readBody(req));
    if (!url) return json(res, 400, { ok:false, error:'url required' });
    const guard = await strictCheckSsrf(url);
    if (guard.error) return json(res, 403, { ok:false, error:guard.error });
    json(res, 200, await pingUrl(url, 6000, skipTls === true, guard.ip));
  } catch(e) { json(res, 200, { ok:false, status:0, error:e.message }); }
});

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
    const guard = await strictCheckSsrf(url);
    if (guard.error) return json(res, 403, { error:guard.error });
    const fullUrl = Object.keys(params).length ? url + (url.includes('?') ? '&' : '?') + new URLSearchParams(params) : url;
    const r = await fetchJSON(fullUrl, { headers, timeout:8000, skipTls: skipTls === true, pinIp: guard.ip });
    json(res, 200, { status:r.status, data:r.data, numbers:collectNumbers(r.data) });
  } catch(e) { json(res, 502, { error:e.message }); }
});

