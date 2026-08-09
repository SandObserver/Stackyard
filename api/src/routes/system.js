const fs = require('fs');
const { on, json } = require('../router');
const { loadConfig } = require('../config');
const { scrubWidgetSecrets, WITHHELD_FLAG } = require('../widget-secrets');
const { getRegistry } = require('../widgets');

let _netCache = { rx: 0, tx: 0 };
let _netPrev = null;

/* One /proc/net/dev line, as bytes received and transmitted.

   Split on the colon, not on whitespace: the kernel pads the name to a fixed
   width, so once the receive counter is wide enough it runs into the colon and
   every field shifts by one. The interface name is matched exactly, or eth0
   also matches eth0.100. */
const RX_BYTES = 0; /* field order after the colon, per the header line */
const TX_BYTES = 8;

/** Parse the counters out of /proc/net/dev text. Separate from the file read so
    the field handling can be tested without a kernel that produces the awkward
    shapes.
    @param {string} text @param {string} iface */
function parseNetDev(text, iface) {
  for (const line of String(text || '').split('\n')) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    if (line.slice(0, at).trim() !== iface) continue;
    const f = line
      .slice(at + 1)
      .trim()
      .split(/\s+/)
      .map(Number);
    const rx = f[RX_BYTES],
      tx = f[TX_BYTES];
    if (!Number.isFinite(rx) || !Number.isFinite(tx)) return null;
    return { rx, tx };
  }
  return null;
}

function _sampleNet(iface) {
  try {
    const got = parseNetDev(fs.readFileSync('/proc/net/dev', 'utf8'), iface);
    return got ? { ...got, ts: Date.now() } : null;
  } catch {
    return null;
  }
}

function _updateNetCache() {
  const cfg = loadConfig();
  const iface = cfg.settings?.stats?.networkInterface || 'eth0';
  const cur = _sampleNet(iface);
  if (cur && _netPrev) {
    const dt = (cur.ts - _netPrev.ts) / 1000;
    if (dt > 0) {
      const rx = Math.round((cur.rx - _netPrev.rx) / dt);
      const tx = Math.round((cur.tx - _netPrev.tx) / dt);
      /* A counter that went backwards means the interface was reset or replaced,
         not that traffic flowed backwards. Reporting the negative delta showed
         figures like -2499500 until the next sample. Skip the window and start
         again from this reading. */
      _netCache = rx >= 0 && tx >= 0 ? { rx, tx } : { rx: 0, tx: 0 };
    }
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
  const w = cfg.items?.find(i => i.id === req.params.id && i.type === 'widget');
  if (!w) return json(res, 404, { error: 'widget not found' });
  const _entry = getRegistry()[w.widgetType];
  /* Same rule as the config read: with no manifest there is no way to tell which
     fields are secret, so nothing is sent. See widget-secrets.js. */
  if (!_entry) {
    return json(res, 200, { widgetSize: w.widgetSize || 'medium', widgetConfig: {}, [WITHHELD_FLAG]: true });
  }
  const wc = JSON.parse(JSON.stringify(w.widgetConfig || {}));
  scrubWidgetSecrets({ widgetType: w.widgetType, widgetConfig: wc }, _entry);
  json(res, 200, { widgetSize: w.widgetSize || 'medium', widgetConfig: wc });
});

/* Exported for tests; the routes above register themselves on require. */
module.exports = { parseNetDev };
