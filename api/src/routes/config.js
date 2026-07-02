const path = require('path');
const { on, json, readBody, checkOrigin } = require('../router');
const { loadConfig, saveConfig, ensureSystemItems, migrate } = require('../config');
const log = require('../log');
const { scrubConfigSecrets, preserveConfigSecrets, MAP_SVC_SECRETS } = require('../widget-secrets');

function scrubSecrets(cfg) {
  const safe = JSON.parse(JSON.stringify(cfg));
  scrubConfigSecrets(safe);
  if (safe.settings?.background?.apiKey) delete safe.settings.background.apiKey;
  if (Array.isArray(safe.items)) {
    safe.items.forEach(item => {
      if (item.type === 'widget' && item.widgetConfig) {
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
      data.settings.auth = data.settings.auth || {};
      if (existing.settings.auth.secret) data.settings.auth.secret = existing.settings.auth.secret;
      if (existing.settings.auth.passwordHash) data.settings.auth.passwordHash = existing.settings.auth.passwordHash;
    }
    preserveConfigSecrets(data, existing);
    if (Array.isArray(data.items) && Array.isArray(existing.items)) {
      data.items.forEach(item => {
        if (item.type === 'widget' && item.widgetType === 'stats' &&
            item.widgetConfig?.network && !('myspeedPass' in item.widgetConfig.network)) {
          const prev = existing.items.find(e => e.id === item.id);
          if (prev?.widgetConfig?.network?.myspeedPass)
            item.widgetConfig.network.myspeedPass = prev.widgetConfig.network.myspeedPass;
        }
        if (item.type === 'widget' && item.widgetType === 'connections' && item.widgetConfig?.vpn) {
          const prev = existing.items.find(e => e.id === item.id);
          const v = item.widgetConfig.vpn, pv = prev?.widgetConfig?.vpn;
          if (!('apiKey' in v) && pv?.apiKey) v.apiKey = pv.apiKey;
          if (!('token'  in v) && pv?.token)  v.token  = pv.token;
          if (v.apiKey) v.apiKeySet = true;
          if (v.token)  v.tokenSet  = true;
        }
        if (item.type === 'widget' && item.widgetType === 'connections' && Array.isArray(item.widgetConfig?.services)) {
          const prev = existing.items.find(e => e.id === item.id);
          const prevSvcs = prev?.widgetConfig?.services || [];
          item.widgetConfig.services.forEach(s => {
            if (!s) return;
            const ps = prevSvcs.find(p => p && p.id === s.id);
            if (ps) MAP_SVC_SECRETS.forEach(k => { if (!(k in s) && ps[k]) s[k] = ps[k]; });
          });
        }
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
    migrate(data); /* upgrade old imported/restored configs; no-op for normal saves */
    ensureSystemItems(data);
    saveConfig(data);
    log.audit('config saved', {});
    json(res, 200, { ok:true });
  } catch(e) { json(res, 400, { error:e.message }); }
});

on('GET', '/api/config/export', (_, res) => {
  const d = JSON.stringify(scrubSecrets(loadConfig()), null, 2);
  res.writeHead(200, { 'Content-Type':'application/json', 'Content-Disposition':'attachment; filename="dashboard-apps.json"', 'Content-Length':Buffer.byteLength(d) });
  res.end(d);
});

