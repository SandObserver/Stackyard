const { on, json, readBody, checkOrigin } = require('../router');
const { IS_DEMO, DEMO_READONLY_MSG } = require('../demo');
const { loadConfig, saveConfig, ensureSystemItems, migrate } = require('../config');
const log = require('../log');
const { scrubConfigSecrets, preserveConfigSecrets } = require('../widget-secrets');
const { scrubItemBadgeSecrets, preserveItemBadgeSecrets } = require('../badge-headers');
const { applyBackupSlotDonors } = require('../backup-secrets');

const DOCK_MAX = 4;

function scrubSecrets(cfg) {
  const safe = JSON.parse(JSON.stringify(cfg));
  scrubConfigSecrets(safe);
  if (Array.isArray(safe.items)) {
    for (const item of safe.items) if (item && item.type === 'app') scrubItemBadgeSecrets(item);
  }
  if (safe.settings?.background?.apiKey) delete safe.settings.background.apiKey;
  if (safe.settings?.auth) {
    delete safe.settings.auth.secret;
    delete safe.settings.auth.passwordHash;
  }
  return safe;
}

on('GET', '/api/config', (_, res) => {
  json(res, 200, ensureSystemItems(scrubSecrets(loadConfig())));
});

on('GET', '/api/settings/unsplash-key', (_, res) => {
  json(res, 200, { configured:!!(loadConfig().settings?.background?.apiKey) });
});

on('POST', '/api/settings/unsplash-key', async(req, res) => {
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG });
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
  if (IS_DEMO) return json(res, 403, { error: DEMO_READONLY_MSG });
  if (!checkOrigin(req, res)) return;
  try {
    const data = JSON.parse(await readBody(req));
    if (!Array.isArray(data.items)) return json(res, 400, { error:'items must be an array' });
    const bad = data.items.find(i => !i || typeof i.id !== 'string' || !i.id || typeof i.type !== 'string' || !i.type);
    if (bad) return json(res, 400, { error:'every item needs a non-empty id and type' });
    /* The dashboard renders at most DOCK_MAX dock apps, so a config holding more
       would silently lose the extras. Mirrors DOCK_MAX in ui/js/admin-logic.js;
       the two cannot share a module across the CJS/ESM split without a build step. */
    if (data.items.filter(i => i.type === 'app' && i.dock).length > DOCK_MAX)
      return json(res, 400, { error:`at most ${DOCK_MAX} apps can be shown in the dock` });
    const KNOWN_SETTINGS = new Set(['background', 'stats', 'server', 'auth', 'theme', 'layout', 'search', 'greeting', 'logLevel', 'language']);
    if (data.settings && typeof data.settings === 'object') {
      for (const key of Object.keys(data.settings)) {
        if (!KNOWN_SETTINGS.has(key)) delete data.settings[key];
      }
      if (data.settings.logLevel && !['debug', 'info', 'error'].includes(data.settings.logLevel)) delete data.settings.logLevel;
      if (data.settings.language && !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(data.settings.language)) delete data.settings.language;
    }
    const existing = loadConfig();
    /* Stale-write check. A client that sends no _rev (a script, or a config
       restored from a file) is trusted and overwrites, so this only guards the
       read-modify-write the admin UI does. */
    if (data._rev != null && Number(data._rev) !== (Number(existing._rev) || 0))
      return json(res, 409, { error:'This config was changed somewhere else. Reload the page and try again.' });
    if (existing.settings?.background?.apiKey && !data.settings?.background?.apiKey) {
      data.settings = data.settings || {};
      data.settings.background = data.settings.background || {};
      data.settings.background.apiKey = existing.settings.background.apiKey;
    }
    if (existing.settings?.auth) {
      data.settings = data.settings || {};
      data.settings.auth = data.settings.auth || {};
      if (existing.settings.auth.secret) data.settings.auth.secret = existing.settings.auth.secret;
      if (existing.settings.auth.passwordHash) data.settings.auth.passwordHash = existing.settings.auth.passwordHash;
    }
    preserveConfigSecrets(data, existing);
    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        if (item?.type !== 'app') continue;
        const prev = existing.items?.find(e => e && e.id === item.id);
        preserveItemBadgeSecrets(item, prev);
      }
    }
    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        if (item?.type === 'widget' && item.widgetType === 'backup')
          applyBackupSlotDonors(item.widgetConfig?.slots);
      }
    }
    migrate(data); /* upgrade old imported/restored configs; no-op for normal saves */
    ensureSystemItems(data);
    saveConfig(data);
    if (data.settings) log.setLevel(data.settings.logLevel);
    log.audit('config saved', {});
    json(res, 200, { ok:true });
  } catch(e) { json(res, 400, { error:e.message }); }
});

on('GET', '/api/config/export', (_, res) => {
  const safe = scrubSecrets(loadConfig());
  delete safe._rev; /* a rev only means something against this install's disk */
  const d = JSON.stringify(safe, null, 2);
  res.writeHead(200, { 'Content-Type':'application/json', 'Content-Disposition':'attachment; filename="dashboard-apps.json"', 'Content-Length':Buffer.byteLength(d) });
  res.end(d);
});

