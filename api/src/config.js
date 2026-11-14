const fs = require('fs');
const path = require('path');
const log = require('./log');
const { IS_DEMO } = require('./demo');
const { migrateItemBadgeHeaders } = require('./badge-headers');

const CONFIG_PATH = process.env.CONFIG_PATH || '/data/apps.json';
/* Holds secrets. Never send it, export it, back it up or log its contents. */
const HELD_PATH = path.join(path.dirname(CONFIG_PATH), 'held-widget-config.json');
const ICONS_PATH = process.env.ICONS_PATH || '/icons';

/* A path set to somewhere that does not exist starts the process normally and
   fails on the first write, with nothing said at boot. Only an explicit value
   is checked: the image creates the defaults. */
function missingPathDirs(env = process.env, exists = p => fs.existsSync(p)) {
  const out = [];
  if (env.CONFIG_PATH) {
    const dir = path.dirname(env.CONFIG_PATH);
    if (!exists(dir)) out.push({ name: 'CONFIG_PATH', dir });
  }
  if (env.ICONS_PATH && !exists(env.ICONS_PATH)) out.push({ name: 'ICONS_PATH', dir: env.ICONS_PATH });
  return out;
}

for (const { name, dir } of missingPathDirs())
  log.warn('configured directory does not exist; writes there will fail', { variable: name, dir });

let _cfgCache = null,
  _cfgCacheAt = 0;
const CONFIG_TTL_MS = 5000;

/* Bump when a release changes the shape. Add a matching step in migrate(). */
const SCHEMA_VERSION = 9;

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

/* The DNS widget no longer offers a medium size. */
function migrateDnsWidgetSize(cfg) {
  if (!Array.isArray(cfg.items)) return;
  for (const item of cfg.items) {
    if (item && item.widgetType === 'dns' && item.widgetSize === 'medium') item.widgetSize = 'small';
  }
}

/* The GitHub widget no longer offers an extra large size. */
function migrateGithubWidgetSize(cfg) {
  if (!Array.isArray(cfg.items)) return;
  for (const item of cfg.items) {
    if (item && item.widgetType === 'github' && item.widgetSize === 'xlarge') item.widgetSize = 'large';
  }
}

/* The Books widget held one view. It now holds a row per shelf. */
function migrateBooksShelves(cfg) {
  if (!Array.isArray(cfg.items)) return;
  for (const item of cfg.items) {
    if (!item || item.widgetType !== 'books') continue;
    const wc = item.widgetConfig;
    if (!wc || typeof wc !== 'object' || Array.isArray(wc.shelves)) continue;
    const shelf = {};
    if (wc.source != null) shelf.source = wc.source;
    if (wc.listId != null) shelf.listId = wc.listId;
    wc.shelves = [shelf];
    delete wc.source;
    delete wc.listId;
  }
}

/* The editor reads only `monitoring.activity`. A top-level `badge` block loses
   its headers on the next save. */
function migrateLegacyBadge(cfg) {
  if (!Array.isArray(cfg.items)) return;
  for (const item of cfg.items) {
    if (!item || item.type !== 'app' || !item.badge || typeof item.badge !== 'object') continue;
    const act = item.monitoring?.activity;
    if (act && (act.enabled || act.url)) continue;
    item.monitoring = { ...(item.monitoring || {}), activity: item.badge };
    delete item.badge;
  }
}

/* Every reader takes the health check from `monitoring.healthcheck` only. */
function migrateLegacyPing(cfg) {
  if (!Array.isArray(cfg.items)) return;
  for (const item of cfg.items) {
    if (!item || item.type !== 'app' || !('ping' in item)) continue;
    const mon = item.monitoring;
    if (mon != null && (typeof mon !== 'object' || Array.isArray(mon))) continue;
    const ping = typeof item.ping === 'string' ? item.ping.trim() : '';
    if (ping && !mon?.healthcheck) {
      const container = typeof item.container === 'string' ? item.container : '';
      item.monitoring = { ...(mon || {}), healthcheck: { enabled: true, container, pingUrl: ping } };
    }
    delete item.ping;
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
  if (v < 5) {
    migrateDnsWidgetSize(cfg);
    v = 5;
  }
  if (v < 6) {
    migrateBooksShelves(cfg);
    v = 6;
  }
  if (v < 7) {
    migrateGithubWidgetSize(cfg);
    v = 7;
  }
  if (v < 8) {
    migrateLegacyBadge(cfg);
    v = 8;
  }
  if (v < 9) {
    migrateLegacyPing(cfg);
    v = 9;
  }
  freeSettingsId(cfg);
  dropBadChildren(cfg);
  cfg._schemaVersion = SCHEMA_VERSION;
  return cfg;
}

function freeSettingsId(cfg) {
  if (!Array.isArray(cfg.items)) return;
  const clashing = cfg.items.filter(i => i && i.id === 'settings' && i.system !== 'settings');
  if (!clashing.length) return;
  const first = cfg.items.find(i => i && i.id === 'settings');
  const taken = new Set(cfg.items.map(i => i?.id));
  let n = 2;
  let firstNewId = null;
  for (const item of clashing) {
    while (taken.has(`settings-${n}`)) n++;
    item.id = `settings-${n}`;
    taken.add(item.id);
    if (item === first) firstNewId = item.id;
  }
  if (!firstNewId) return;
  for (const folder of cfg.items) {
    if (Array.isArray(folder?.children))
      folder.children = folder.children.map(id => (id === 'settings' ? firstNewId : id));
  }
}

/* Keep. Every page reads children as a list, and a string or object there
   stops the dashboard and Settings from drawing. */
function dropBadChildren(cfg) {
  if (!Array.isArray(cfg.items)) return;
  for (const item of cfg.items) if (item && item.children != null && !Array.isArray(item.children)) item.children = [];
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

const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

/* A wrong-typed settings must count as damage. Replacing it with {} turns
   sign-in off and the next save erases the password. */
function _normalizeShape(parsed) {
  if (!isPlainObject(parsed)) return null;
  if (parsed.items !== undefined && !Array.isArray(parsed.items)) return null;
  if (parsed.settings !== undefined && !isPlainObject(parsed.settings)) return null;
  if (!Array.isArray(parsed.items)) parsed.items = [];
  if (parsed.settings === undefined) parsed.settings = {};
  return parsed;
}

const { HELP_URL } = require('../../ui/js/config-recovery-logic.js');

/* Set while the file on disk cannot be used. Do not save then: the blank
   config has sign-in off and replaces the owner's settings and password. */
let _damage = null;
let _damageLogged = null;

function _markDamaged(reason, error, backup) {
  _damage = { reason, file: path.basename(CONFIG_PATH), ...(backup ? { backup } : {}) };
  const key = `${reason}:${backup || ''}`;
  if (key === _damageLogged) return;
  _damageLogged = key;
  log.error('config file cannot be used; sign-in and saving are refused until it is fixed', {
    path: CONFIG_PATH,
    reason,
    ...(backup ? { backup } : {}),
    ...(error ? { error } : {}),
    help: HELP_URL,
  });
}

function _clearDamage() {
  if (_damage) log.info('config file readable again', { path: CONFIG_PATH });
  _damage = null;
  _damageLogged = null;
}

/** @returns {{ reason: 'unreadable' | 'corrupt', file: string, backup?: string } | null} */
function configDamage() {
  if (IS_DEMO) return null;
  loadConfig();
  return _damage;
}

/* Written with wx. One corruption must not overwrite an earlier backup. */
let _lastCorruptRaw = null;
let _lastBackup = null;
function _backupCorrupt(raw) {
  if (raw === _lastCorruptRaw) return _lastBackup;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${CONFIG_PATH}.corrupt-${stamp}`;
  _lastBackup = null;
  try {
    fs.writeFileSync(target, raw, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    _lastBackup = path.basename(target);
  } catch (e) {
    log.warn('could not write the corrupt-config backup', { path: CONFIG_PATH, error: e.message });
  }
  _lastCorruptRaw = raw;
  return _lastBackup;
}

let _modeChecked = false;

function _tightenEarlierFiles() {
  const dir = path.dirname(CONFIG_PATH);
  const backup = `${path.basename(CONFIG_PATH)}.corrupt`;
  let names = [];
  try {
    names = fs.readdirSync(dir).filter(n => n === backup || n.startsWith(`${backup}-`));
  } catch {
    /* unreadable folder: the config read reports it */
  }
  const files = [
    CONFIG_PATH,
    `${CONFIG_PATH}.tmp`,
    HELD_PATH,
    `${HELD_PATH}.tmp`,
    ...names.map(n => path.join(dir, n)),
  ];
  for (const file of files) {
    try {
      if (fs.lstatSync(file).isFile()) fs.chmodSync(file, 0o600);
    } catch {
      /* not the owner: leave the mode to the host */
    }
  }
}

function _readDisk() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') _clearDamage();
    else _markDamaged('unreadable', e.message);
    return null;
  }
  if (!_modeChecked) {
    _modeChecked = true;
    _tightenEarlierFiles();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* Never log the parser's message. It quotes the file, secrets included. */
    _markDamaged('corrupt', 'not valid JSON', _backupCorrupt(raw));
    return null;
  }

  const shaped = _normalizeShape(parsed);
  if (!shaped) {
    _markDamaged('corrupt', 'wrong shape', _backupCorrupt(raw));
    return null;
  }

  _clearDamage();
  /* Every reader dereferences items without a guard. */
  if (!shaped.items.every(isPlainObject)) {
    const first = raw !== _lastCorruptRaw;
    const backup = _backupCorrupt(raw);
    shaped.items = shaped.items.filter(isPlainObject);
    if (first)
      log.warn('config entries that are not objects were skipped', {
        path: CONFIG_PATH,
        ...(backup ? { backup } : {}),
      });
  }
  return shaped;
}

const _releaseLogged = new Set();

/* Returns the live cache. Do not write to it. Call loadConfigForUpdate to
   change the config. A write here survives a failed save. */
function loadConfig() {
  if (IS_DEMO) return loadDemoConfig();

  const now = Date.now();
  if (_cfgCache && now - _cfgCacheAt < CONFIG_TTL_MS) return _cfgCache;

  const shaped = _readDisk();
  if (!shaped) return migrate({ items: [], settings: {} });

  const before = shaped._schemaVersion;
  migrate(shaped);
  /* Required here. widget-secrets loads widgets.js, which loads this file. */
  const { moved, stale } = require('./widget-secrets').releaseHeldConfigs(shaped, _readHeldForLoad());
  const fresh = moved.filter(id => !_releaseLogged.has(id));
  if (fresh.length) log.audit('stored credentials dropped until retyped', { items: fresh });
  _cfgCache = shaped;
  _cfgCacheAt = now;
  /* A failed write must not break reads. */
  if (shaped._schemaVersion !== before || moved.length) {
    try {
      saveConfig(shaped, { release: [...moved, ...stale] });
      for (const id of moved) _releaseLogged.delete(id);
    } catch (e) {
      for (const id of moved) _releaseLogged.add(id);
      if (shaped._schemaVersion !== before || fresh.length)
        log.warn('migrated config could not be written back', { path: CONFIG_PATH, error: e.message });
    }
  } else if (stale.length) {
    _pruneHeld(shaped, stale);
  }
  return shaped;
}

/* Reads the file, not the cache. A hand edit made in the cache window would
   otherwise be overwritten by the next save. */
function loadConfigForUpdate() {
  _cfgCacheAt = 0;
  return structuredClone(loadConfig());
}

const WRITE_FAILURES = {
  ENOSPC: [507, 'internal.disk-full'],
  EDQUOT: [507, 'internal.disk-full'],
  EACCES: [500, 'internal.config-not-writable'],
  EPERM: [500, 'internal.config-not-writable'],
  EROFS: [500, 'internal.config-not-writable'],
  EBUSY: [500, 'internal.config-file-mounted'],
};

function tagWriteFailure(e) {
  const known = WRITE_FAILURES[e?.code];
  if (known) [e.status, e.apiCode] = known;
  return e;
}

/* keepRev is only for writes the browser never sees. Every open dashboard
   reloads when _rev changes. */
/* Write, flush, rename, flush the directory. Without both flushes a power cut
   leaves the rename applied and the contents lost. */
function _writeAtomic(file, text) {
  const dir = path.dirname(file);
  const tmp = file + '.tmp';
  try {
    fs.mkdirSync(dir, { recursive: true });
    /* Keep the unlink. A temp file left by a crash keeps its mode through the
       rename and exposes the secrets. */
    try {
      fs.unlinkSync(tmp);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* nothing more to do */
    }
    throw tagWriteFailure(e);
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
}

/** @returns {Record<string, { widgetType: string, widgetConfig: object }>} */
function _readHeld() {
  let raw;
  try {
    raw = fs.readFileSync(HELD_PATH, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const out = {};
  if (!isPlainObject(parsed)) return out;
  for (const [id, entry] of Object.entries(parsed))
    if (isPlainObject(entry) && typeof entry.widgetType === 'string' && isPlainObject(entry.widgetConfig))
      out[id] = entry;
  return out;
}

function _readHeldForLoad() {
  try {
    return _readHeld();
  } catch (e) {
    log.warn('held widget config could not be read', { path: HELD_PATH, error: e.message });
    return {};
  }
}

function _writeHeld(held) {
  if (Object.keys(held).length) return _writeAtomic(HELD_PATH, JSON.stringify(held, null, 2));
  try {
    fs.unlinkSync(HELD_PATH);
  } catch (e) {
    if (e.code !== 'ENOENT') throw tagWriteFailure(e);
  }
}

function _pruneHeld(data, release = []) {
  if (!Array.isArray(data?.items)) return;
  try {
    const held = _readHeld();
    const items = data.items;
    const kept = {};
    for (const [id, entry] of Object.entries(held)) {
      if (release.includes(id)) continue;
      const item = items.find(i => i && i.id === id);
      if (item?.type === 'widget' && item.widgetType === entry.widgetType) kept[id] = entry;
    }
    if (Object.keys(kept).length !== Object.keys(held).length) _writeHeld(kept);
  } catch (e) {
    log.warn('held widget config could not be updated', { path: HELD_PATH, error: e.message });
  }
}

function loadHeldConfigs() {
  return structuredClone(_readHeld());
}

function saveConfig(data, { keepRev = false, hold = {}, release = [] } = {}) {
  /* Check the file, not the cache. A file broken after the last read must be
     kept, not overwritten. */
  _readDisk();
  if (_damage) throw new Error('config file cannot be used; refusing to overwrite it');
  if (data && typeof data === 'object') {
    data._schemaVersion = SCHEMA_VERSION;
    if (!keepRev) data._rev = (Number(data._rev) || 0) + 1;
  }
  /* Clone before writing. A value the clone cannot handle must fail here, not
     after the file is replaced: every later read clones it and fails too. */
  const copy = structuredClone(data);
  /* Keep this order. Writing the config file first loses the held config on a crash. */
  if (Object.keys(hold).length) _writeHeld({ ..._readHeld(), ...hold });
  _writeAtomic(CONFIG_PATH, JSON.stringify(data, null, 2));
  _pruneHeld(data, release);

  /* Only after the write succeeded. */
  _cfgCache = copy;
  _cfgCacheAt = Date.now();
}

/** Saves replace the file by rename, which a mount point refuses.
    @param {string} [mountinfo] @returns {boolean} */
function configFileIsMount(mountinfo) {
  let text = mountinfo;
  if (text === undefined) {
    try {
      text = fs.readFileSync('/proc/self/mountinfo', 'utf8');
    } catch {
      return false;
    }
  }
  const decode = s => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  return text.split('\n').some(line => decode(line.split(' ')[4] || '') === CONFIG_PATH);
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

module.exports = {
  CONFIG_PATH,
  ICONS_PATH,
  SCHEMA_VERSION,
  loadConfig,
  loadConfigForUpdate,
  configDamage,
  configFileIsMount,
  saveConfig,
  loadHeldConfigs,
  HELD_PATH,
  ensureSystemItems,
  migrate,
  missingPathDirs,
};
