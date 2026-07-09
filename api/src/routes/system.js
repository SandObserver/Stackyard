const fs = require('fs');
const { on, json } = require('../router');
const { loadConfig } = require('../config');
const { fetchJSON, strictCheckSsrf } = require('../proxy');
const { scrubWidgetSecrets, MAP_SVC_SECRETS } = require('../widget-secrets');
const { getRegistry } = require('../widgets');

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
  if (wc.network) delete wc.network.myspeedPass;
  if (Array.isArray(wc.slots)) wc.slots.forEach(s => { if(s){ delete s.dupPass; delete s.kopiaPass; } });
  if (wc.vpn) { delete wc.vpn.apiKey; delete wc.vpn.token; }
  if (Array.isArray(wc.services)) wc.services.forEach(sv => { if (sv) MAP_SVC_SECRETS.forEach(k => { if (k in sv) { sv[k+'Set'] = true; delete sv[k]; } }); });
  json(res, 200, { widgetSize: w.widgetSize || 'medium', widgetConfig: wc });
});

on('GET', '/api/geocode-proxy', async(req, res) => {
  const u    = new URL(req.url, 'http://x');
  const name = (u.searchParams.get('q') || '').trim();
  if (!name) return json(res, 400, { error: 'q param required' });
  try {
    const url = 'https://geocoding-api.open-meteo.com/v1/search'
      + `?name=${encodeURIComponent(name)}&count=5&language=en&format=json`;
    const r = await fetchJSON(url, { timeout: 8000 });
    if (r.status >= 400) return json(res, 502, { error: 'Geocoding HTTP ' + r.status });
    const results = ((r.data && r.data.results) || []).map(p => ({
      name: p.name, country: p.country, admin1: p.admin1,
      lat: p.latitude, lon: p.longitude,
    }));
    json(res, 200, { results });
  } catch(e) { json(res, 502, { error: e.message }); }
});

on('GET', '/api/scrutiny-proxy', async(req, res) => {
  const u    = new URL(req.url, 'http://x');
  const raw  = u.searchParams.get('url') || '';
  if (!raw) return json(res, 400, { error:'url param required' });
  try {
    const base    = raw.includes('://') ? raw.replace(/\/$/, '') : `http://${raw.replace(/\/$/,'')}`;
    const guard = await strictCheckSsrf(base);
    if (guard.error) return json(res, 403, { error: guard.error });
    const r       = await fetchJSON(base + '/api/summary', { timeout: 8000, pinIp: guard.ip });
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

on('GET', '/api/truenas-proxy', async(req, res) => {
  const u   = new URL(req.url, 'http://x');
  const raw = u.searchParams.get('url') || '';
  const key = u.searchParams.get('key') || '';
  if (!raw) return json(res, 400, { error:'url param required' });
  if (!key) return json(res, 400, { error:'API key required' });
  try {
    const base    = raw.includes('://') ? raw.replace(/\/$/, '') : `http://${raw.replace(/\/$/,'')}`;
    const guard = await strictCheckSsrf(base);
    if (guard.error) return json(res, 403, { error: guard.error });
    const r = await fetchJSON(base + '/api/v2.0/pool', {
      headers: { Authorization: 'Bearer ' + key }, timeout: 8000, pinIp: guard.ip,
    });
    if (r.status === 401 || r.status === 403) return json(res, 401, { error:'TrueNAS auth failed — check API key' });
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
    const base = url.includes('://') ? url.replace(/\/$/, '') : `http://${url.replace(/\/$/,'')}`;
    const r    = await fetchJSON(base + '/api/summary', { timeout: 8000 });
    const summary = r.data?.data?.summary || {};
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

