const { on, json } = require('../router');
const { loadConfig } = require('../config');
const { fetchUnchecked, pingUnchecked } = require('../proxy');
const { PING_MS } = require('../timeouts');
const { IS_DEMO } = require('../demo');
const demoData = require('../demo-data');
const log = require('../log');
const SOCKET_PROXY_URL_DEFAULT = process.env.SOCKET_PROXY_URL || '';

async function fetchContainerHealth() {
  const cfg = loadConfig();
  const socketUrl = cfg.settings?.server?.socketProxyUrl || SOCKET_PROXY_URL_DEFAULT;
  if (!socketUrl) return {};
  try {
    const r = await fetchUnchecked(`${socketUrl}/containers/json?all=true`);
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

on('GET', '/health', (_, res) => json(res, 200, { ok:true }));

on('GET', '/api/health', async(_, res) => {
  if (IS_DEMO) { const cfg = loadConfig(); return json(res, 200, demoData.demoHealth(cfg.items)); }
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
        const r = await pingUnchecked(ping, PING_MS, item.skipTlsVerify === true);
        if (!r.ok) unhealthy = true;
        result[item.id] = { unhealthy, pingStatus:r.status, pingError:r.error };
      }
    }));
  json(res, 200, result);
});

