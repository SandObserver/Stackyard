const fs   = require('fs');
const path = require('path');
const log  = require('./log');
const { IS_DEMO } = require('./demo');
const { migrateItemBadgeHeaders } = require('./badge-headers');

const CONFIG_PATH = process.env.CONFIG_PATH || '/data/apps.json';
const ICONS_PATH  = process.env.ICONS_PATH  || '/icons';

let _cfgCache = null, _cfgCacheAt = 0;
const CONFIG_TTL_MS = 5000;

/* Current on-disk config shape. Bump when a release changes the shape in a way
   older configs need transforming for, and add a matching step in migrate(). */
const SCHEMA_VERSION = 2;

/* Walk an old config forward to the current shape. Idempotent: a no-op when the
   config is already current, so it is safe to run on every read and write.
   A config with no _schemaVersion is treated as version 1 (the baseline shape),
   which is correct for every config predating this field. Future breaking
   changes add ordered steps, e.g. `if (v < 2) { ...transform...; v = 2; }`. */
function migrate(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  let v = Number(cfg._schemaVersion) || 1;
  if (v < 2) {
    if (Array.isArray(cfg.items)) {
      for (const item of cfg.items) if (item && item.type === 'app') migrateItemBadgeHeaders(item);
    }
    v = 2;
  }
  cfg._schemaVersion = SCHEMA_VERSION;
  return cfg;
}

let _demoCfg = null;
/* In demo mode the config is read from the bundled showcase file and never
   from disk, so nothing a visitor does can persist. */
function loadDemoConfig() {
  if (!_demoCfg) {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'demo', 'demo-config.json'), 'utf8');
    _demoCfg = migrate(JSON.parse(raw));
    ensureSystemItems(_demoCfg);
  }
  return _demoCfg;
}

function loadConfig() {
  if (IS_DEMO) return loadDemoConfig();

  const now = Date.now();
  if (_cfgCache && (now - _cfgCacheAt) < CONFIG_TTL_MS) return _cfgCache;

  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT') log.warn('config file unreadable, starting with a blank config', { path: CONFIG_PATH, error: e.message });
    return migrate({ items:[], settings:{} });
  }

  try {
    const parsed = JSON.parse(raw);
    const before = parsed._schemaVersion;
    migrate(parsed);
    _cfgCache = parsed; _cfgCacheAt = now;
    /* Persist once if a version bump actually changed the file, so an upgraded
       install migrates on disk even if the user never saves. Never let a failed
       write (e.g. read-only volume) break reads; the migrated copy is already
       cached in memory and will re-migrate next load. */
    if (parsed._schemaVersion !== before) { try { saveConfig(parsed); } catch {} }
    return parsed;
  } catch (e) {
    /* Bad JSON, e.g. a manual edit gone wrong. Preserve the broken file
       instead of letting the next save overwrite it, then start fresh. */
    log.warn('config file corrupt, backing up and starting with a blank config', { path: CONFIG_PATH, error: e.message });
    try { fs.writeFileSync(CONFIG_PATH + '.corrupt', raw, 'utf8'); } catch {}
    return migrate({ items:[], settings:{} });
  }
}

/* Every write bumps _rev. POST /api/config compares the _rev a client read
   against the one on disk and rejects a stale write, so two admin tabs saving
   over each other surfaces as a 409 instead of silently dropping one of them. */
function saveConfig(data) {
  if (data && typeof data === 'object') {
    data._schemaVersion = SCHEMA_VERSION;
    data._rev = (Number(data._rev) || 0) + 1;
  }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive:true });
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
  _cfgCache = data; _cfgCacheAt = Date.now();
}

/* The Settings app is a permanent, non-deletable default item. It behaves like
   any app on the dashboard (movable, foldable, hideable) but is never removed
   or edited. We guarantee its presence on every read and write. */
const SYSTEM_SETTINGS_ITEM = { id:'settings', type:'app', system:'settings', label:'Settings', dock:false, color:'#3b4250' };
function ensureSystemItems(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  if (!Array.isArray(cfg.items)) cfg.items = [];
  const s = cfg.items.find(i => i && i.system === 'settings');
  if (!s) cfg.items.push({ ...SYSTEM_SETTINGS_ITEM });
  else { s.type = 'app'; s.system = 'settings'; if (!s.label) s.label = 'Settings'; }
  return cfg;
}

module.exports = { CONFIG_PATH, ICONS_PATH, SCHEMA_VERSION, loadConfig, saveConfig, ensureSystemItems, migrate };
