const fs = require('fs');
const { on, json } = require('../router');
const { loadConfig } = require('../config');
const { fetchJSON, strictCheckSsrf } = require('../proxy');
const { scrubWidgetSecrets } = require('../widget-secrets');
const { getRegistry } = require('../widgets');
const { normalizeBase } = require('../widget-data');
const { FETCH_MS } = require('../timeouts');
const { mapScrutinyDevices } = require('../scrutiny');

/* Normalize, SSRF-guard, fetch a Scrutiny summary and shape its device list.
   Shared by the query-URL and config-URL routes so both apply the same guard
   and produce the same result. Returns { devices } or { status, error }. */
async function fetchScrutinyDevices(rawUrl) {
  const base  = normalizeBase(rawUrl);
  const guard = await strictCheckSsrf(base);
  if (guard.error) return { status: 403, error: guard.error };
  const r = await fetchJSON(base + '/api/summary', { timeout: FETCH_MS, pinIp: guard.ip });
  return { devices: mapScrutinyDevices(r.data?.data?.summary) };
}

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
setInterval(_updateNetCache, 2000).unref();

on('GET', '/api/network-stats', (_, res) => {
  json(res, 200, _netCache);
});

on('GET', '/api/widget-config/:id', (req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error:'widget not found' });
  const wc = JSON.parse(JSON.stringify(w.widgetConfig || {}));
  const _entry = getRegistry()[w.widgetType];
  if (_entry) scrubWidgetSecrets({ widgetType: w.widgetType, widgetConfig: wc }, _entry);
  json(res, 200, { widgetSize: w.widgetSize || 'medium', widgetConfig: wc });
});

on('GET', '/api/geocode-proxy', async(req, res) => {
  const u    = new URL(req.url, 'http://x');
  const name = (u.searchParams.get('q') || '').trim();
  if (!name) return json(res, 400, { error: 'q param required' });
  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search'
      + `?name=${encodeURIComponent(name)}&count=5&language=en&format=json`;
    const r = await fetchJSON(url, { timeout: FETCH_MS });
    if (r.status >= 400) return json(res, 502, { error: 'Geocoding HTTP ' + r.status });
    const results = ((r.data && r.data.results) || []).map(p => ({
      name: p.name, country: p.country, admin1: p.admin1,
      lat: p.latitude, lon: p.longitude,
    }));
    json(res, 200, { results });
  } catch(e) { json(res, 502, { error: e.message }); }
});

on('GET', '/api/scrutiny-proxy', async(req, res) => {
  const u   = new URL(req.url, 'http://x');
  const raw = u.searchParams.get('url') || '';
  if (!raw) return json(res, 400, { error:'url param required' });
  try {
    const out = await fetchScrutinyDevices(raw);
    if (out.error) return json(res, out.status, { error: out.error });
    json(res, 200, { devices: out.devices });
  } catch(e) { json(res, 502, { error: e.message }); }
});

on('GET', '/api/truenas-proxy', async(req, res) => {
  const u   = new URL(req.url, 'http://x');
  const raw = u.searchParams.get('url') || '';
  const key = u.searchParams.get('key') || '';
  if (!raw) return json(res, 400, { error:'url param required' });
  if (!key) return json(res, 400, { error:'API key required' });
  try {
    const base  = normalizeBase(raw);
    const guard = await strictCheckSsrf(base);
    if (guard.error) return json(res, 403, { error: guard.error });
    const r = await fetchJSON(base + '/api/v2.0/pool', {
      headers: { Authorization: 'Bearer ' + key }, timeout: FETCH_MS, pinIp: guard.ip,
    });
    if (r.status === 401 || r.status === 403) return json(res, 401, { error:'TrueNAS auth failed, check API key' });
    if (r.status >= 400) return json(res, 502, { error:'TrueNAS HTTP ' + r.status });
    const pools = (Array.isArray(r.data) ? r.data : []).map(p => ({
      name:     p.name,
      healthy:  p.healthy === true,
      capacity: (p.size != null ? Number(p.size) : null),
    }));
    json(res, 200, { pools });
  } catch(e) { json(res, 502, { error: e.message }); }
});

on('GET', '/api/scrutiny-devices/:id', async(req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error:'widget not found' });
  const url = w.widgetConfig?.scrutinyUrl;
  if (!url) return json(res, 400, { error:'scrutinyUrl not configured' });
  try {
    const out = await fetchScrutinyDevices(url);
    if (out.error) return json(res, out.status, { error: out.error });
    json(res, 200, { devices: out.devices });
  } catch(e) { json(res, 502, { error: e.message }); }
});

on('GET', '/api/speed-data/:id', async(req, res) => {
  const cfg = loadConfig();
  const w   = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error:'widget not found' });
  const net = w.widgetConfig?.network;
  if (!net?.enabled || !net?.url) return json(res, 503, { error:'network slot not configured' });

  const provider = net.provider || 'myspeed';
  const base     = normalizeBase(net.url);

  try {
    const guard = await strictCheckSsrf(base);
    if (guard.error) return json(res, 403, { error: guard.error });
    if (provider === 'speedtest-tracker') {
      const r = await fetchJSON(base + '/api/speedtest/latest', { timeout: FETCH_MS, pinIp: guard.ip });
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
      const headers = {};
      if (net.myspeedPass) headers['x-password'] = net.myspeedPass;
      const r = await fetchJSON(base + '/api/speedtests?limit=1', { headers, timeout: FETCH_MS, pinIp: guard.ip });
      if (r.status === 401) return json(res, 401, { error:'MySpeed returned 401, check password' });
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

