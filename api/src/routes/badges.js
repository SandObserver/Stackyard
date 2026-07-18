const { on, json, readBody, getIp } = require('../router');
const { loadConfig } = require('../config');
const { fetchChecked, fetchUnchecked, pingChecked } = require('../proxy');
const { rateLimit } = require('../auth');
const { PING_MS, FETCH_MS } = require('../timeouts');
const { IS_DEMO } = require('../demo');
const demoData = require('../demo-data');
const { collectNumbers, computeBadgeValue } = require('../badge-extract');
const { requestParts, toRows, preserveItemBadgeSecrets, rowsToObject } = require('../badge-headers');

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
        const { headers, params } = requestParts(item);
        const baseUrl = src.url;
        const url = Object.keys(params).length
          ? baseUrl + (baseUrl.includes('?') ? '&' : '?') + new URLSearchParams(params)
          : baseUrl;
        const r   = await fetchUnchecked(url, { headers, timeout:PING_MS, skipTls: item.skipTlsVerify === true });
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
    const body = JSON.parse(await readBody(req));
    const { url, itemId, skipTls=false } = body;
    if (!url) return json(res, 400, { error:'url required' });
    /* Rows the user did not retype arrive as secret rows without a value. Fill
       them from the stored item so a test after reload uses the real credential,
       without ever sending it to the browser. */
    let headerRows = toRows(body.headers);
    let paramRows = toRows(body.params);
    if (itemId) {
      const stored = loadConfig().items?.find(i => i && i.id === itemId);
      if (stored) {
        const oldSrc = stored.monitoring?.activity?.enabled ? stored.monitoring.activity : stored.badge;
        const shim = { badge: { headers: headerRows, params: paramRows } };
        preserveItemBadgeSecrets(shim, { badge: { headers: oldSrc?.headers, params: oldSrc?.params } });
        headerRows = shim.badge.headers; paramRows = shim.badge.params;
      }
    }
    const headers = rowsToObject(headerRows);
    const params = rowsToObject(paramRows);
    const fullUrl = Object.keys(params).length ? url + (url.includes('?') ? '&' : '?') + new URLSearchParams(params) : url;
    const r = await fetchChecked(fullUrl, { headers, timeout:FETCH_MS, skipTls: skipTls === true });
    json(res, 200, { status:r.status, data:r.data, numbers:collectNumbers(r.data) });
  } catch(e) { json(res, e.status || 502, { error:e.message }); }
});

