const { on, json, readBody, getIp } = require('../router');
const { loadConfig } = require('../config');
const { fetchChecked, fetchUnchecked, pingChecked } = require('../proxy');
const { rateLimit } = require('../auth');
const { PING_MS, FETCH_MS } = require('../timeouts');
const { IS_DEMO } = require('../demo');
const demoData = require('../demo-data');
const { collectNumbers, computeBadgeValue } = require('../badge-extract');

on('POST', '/api/ping', async(req, res) => {
  try {
    const ip = getIp(req);
    const limited = rateLimit(ip, 'ping', 30, 60_000);
    if (limited) return json(res, 429, { ok:false, error:limited });
    const { url, skipTls=false } = JSON.parse(await readBody(req));
    if (!url) return json(res, 400, { ok:false, error:'url required' });
    json(res, 200, await pingChecked(url, PING_MS, skipTls === true));
  } catch(e) {
    if (e.status === 403) return json(res, 403, { ok:false, error:e.message });
    json(res, 200, { ok:false, status:0, error:e.message });
  }
});

on('GET', '/api/badges', async(_, res) => {
  const cfg = loadConfig(), out = {};
  if (IS_DEMO) return json(res, 200, demoData.demoBadges(cfg.items));
  await Promise.allSettled(cfg.items
    .filter(i => i.type==='app' && (
      (i.badge?.enabled && i.badge?.url) ||
      (i.monitoring?.activity?.enabled && i.monitoring?.activity?.url)
    ))
    .map(async item => {
      try {
        const src = item.monitoring?.activity?.enabled ? item.monitoring.activity : item.badge;
        const baseUrl = src.url;
        const url = src.params && Object.keys(src.params).length
          ? baseUrl + (baseUrl.includes('?') ? '&' : '?') + new URLSearchParams(src.params)
          : baseUrl;
        const r   = await fetchUnchecked(url, { headers: src.headers||{}, timeout:PING_MS, skipTls: item.skipTlsVerify === true });
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
    const fullUrl = Object.keys(params).length ? url + (url.includes('?') ? '&' : '?') + new URLSearchParams(params) : url;
    const r = await fetchChecked(fullUrl, { headers, timeout:FETCH_MS, skipTls: skipTls === true });
    json(res, 200, { status:r.status, data:r.data, numbers:collectNumbers(r.data) });
  } catch(e) { json(res, e.status || 502, { error:e.message }); }
});

