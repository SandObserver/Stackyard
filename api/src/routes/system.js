const fs = require('fs');
const { on, json } = require('../router');
const { loadConfig } = require('../config');
const { scrubWidgetSecrets } = require('../widget-secrets');
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
  json(res, 200, { widgetSize: w.widgetSize || 'medium', widgetConfig: wc });
});

