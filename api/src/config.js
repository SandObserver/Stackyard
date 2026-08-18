const fs = require('fs');
const path = require('path');
const log = require('./log');
const { IS_DEMO } = require('./demo');
const { migrateItemBadgeHeaders } = require('./badge-headers');

const CONFIG_PATH = process.env.CONFIG_PATH || '/data/apps.json';
const ICONS_PATH = process.env.ICONS_PATH || '/icons';

let _cfgCache = null,
  _cfgCacheAt = 0;
const CONFIG_TTL_MS = 5000;

/* Bump when a release changes the shape. Add a matching step in migrate(). */
const SCHEMA_VERSION = 4;

function migrateSocketProxyScheme(settings) {
  const url = settings?.server?.socketProxyUrl;
  if (typeof url !== 'string' || !/^tcp:\/\//i.test(url)) return false;
  settings.server.socketProxyUrl = url.replace(/^tcp:\/\//i, 'http://');
  return true;
}

/* The stats widget was one widget with two views. Each view is now its own
   widget type, and the view key no longer means anything. */
function migrateStatsWidgetSplit(cfg) {
  if (!Array.isArray(cfg.items)) return;
  for (const item of cfg.items) {
    if (!item || item.widgetType !== 'stats') continue;
    const wc = item.widgetConfig;
    const view = wc && typeof wc === 'object' ? wc.widgetSubType : undefined;
    item.widgetType = view === 'disk-health' ? 'disk-health' : 'system-summary';
    if (wc && typeof wc === 'object') delete wc.widgetSubType;
  }
}

/* Must stay idempotent. It runs on every read and every write. A config with no
   _schemaVersion is version 1. */
function migrate(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  let v = Number(cfg._schemaVersion) || 1;
  if (v < 2) {
    if (Array.isArray(cfg.items)) {
      for (const item of cfg.items) if (item && item.type === 'app') migrateItemBadgeHeaders(item);
    }
    v = 2;
  }
  if (v < 3) {
    if (migrateSocketProxyScheme(cfg.settings))
      log.warn('Docker socket URL rewritten from tcp to http; the tcp form is no longer accepted');
    v = 3;
  }
  if (v < 4) {
    migrateStatsWidgetSplit(cfg);
    v = 4;
  }
  cfg._schemaVersion = SCHEMA_VERSION;
  return cfg;
}

let _demoCfg = null;
/* Never read from disk. Nothing a demo visitor does may persist. */
function loadDemoConfig() {
  if (!_demoCfg) {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'demo', 'demo-config.json'), 'utf8');
    _demoCfg = migrate(JSON.parse(raw));
    ensureSystemItems(_demoCfg);
  }
  return _demoCfg;
}

function _normalizeShape(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.items !== undefined && !Array.isArray(parsed.items)) return null;
  if (!Array.isArray(parsed.items)) parsed.items = [];
  if (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) parsed.settings = {};
  return parsed;
}

/* Written with wx. One corruption must not overwrite an earlier backup. */
let _lastCorruptRaw = null;
function _backupCorrupt(raw) {
  if (raw === _lastCorruptRaw) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    fs.writeFileSync(`${CONFIG_PATH}.corrupt-${stamp}`, raw, { encoding: 'utf8', flag: 'wx' });
  } catch {}
  _lastCorruptRaw = raw;
}

function loadConfig() {
  if (IS_DEMO) return loadDemoConfig();

  const now = Date.now();
  if (_cfgCache && now - _cfgCacheAt < CONFIG_TTL_MS) return _cfgCache;

  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    if (e.code !== 'ENOENT')
      log.warn('config file unreadable, starting with a blank config', { path: CONFIG_PATH, error: e.message });
    return migrate({ items: [], settings: {} });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    log.warn('config file corrupt, backing up and starting with a blank config', {
      path: CONFIG_PATH,
      error: e.message,
    });
    _backupCorrupt(raw);
    return migrate({ items: [], settings: {} });
  }

  const shaped = _normalizeShape(parsed);
  if (!shaped) {
    log.warn('config file has the wrong shape, backing up and starting with a blank config', { path: CONFIG_PATH });
    _backupCorrupt(raw);
    return migrate({ items: [], settings: {} });
  }

  const before = shaped._schemaVersion;
  migrate(shaped);
  _cfgCache = shaped;
  _cfgCacheAt = now;
  /* A failed write must not break reads. */
  if (shaped._schemaVersion !== before) {
    try {
      saveConfig(shaped);
    } catch {}
  }
  return shaped;
}

function saveConfig(data) {
  if (data && typeof data === 'object') {
    data._schemaVersion = SCHEMA_VERSION;
    data._rev = (Number(data._rev) || 0) + 1;
  }
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';

  /* Write, flush, rename, flush the directory. Without both flushes a power cut
     leaves the rename applied and the contents lost. */
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }

  try {
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing more to do */
    }
    throw e;
  }

  try {
    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    /* Some filesystems refuse to fsync a directory. The contents are already
       durable. */
  }

  /* Only after the write succeeded. */
  _cfgCache = data;
  _cfgCacheAt = Date.now();
}

const SYSTEM_SETTINGS_ITEM = {
  id: 'settings',
  type: 'app',
  system: 'settings',
  label: 'Settings',
  dock: false,
  color: '#027eae',
};
function ensureSystemItems(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  if (!Array.isArray(cfg.items)) cfg.items = [];
  const s = cfg.items.find(i => i && i.system === 'settings');
  if (!s) cfg.items.push({ ...SYSTEM_SETTINGS_ITEM });
  else {
    s.type = 'app';
    s.system = 'settings';
    if (!s.label) s.label = 'Settings';
  }
  return cfg;
}

module.exports = { CONFIG_PATH, ICONS_PATH, SCHEMA_VERSION, loadConfig, saveConfig, ensureSystemItems, migrate };
