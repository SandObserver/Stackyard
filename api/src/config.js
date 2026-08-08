const fs   = require('fs');
const path = require('path');
const log  = require('./log');
const { IS_DEMO } = require('./demo');
const { migrateItemBadgeHeaders } = require('./badge-headers');

const CONFIG_PATH = process.env.CONFIG_PATH || '/data/apps.json';
const ICONS_PATH  = process.env.ICONS_PATH  || '/icons';

let _cfgCache = null, _cfgCacheAt = 0;
const CONFIG_TTL_MS = 5000;

/* Bump when a release changes the shape, and add a matching step in migrate(). */
const SCHEMA_VERSION = 2;

/* Idempotent, so it is safe on every read and write. A config with no
   _schemaVersion is version 1. Add ordered steps: `if (v < 2) { ...; v = 2; }`. */
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
/* Read from the bundled showcase file, never from disk, so nothing a visitor
   does can persist. */
function loadDemoConfig() {
  if (!_demoCfg) {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'demo', 'demo-config.json'), 'utf8');
    _demoCfg = migrate(JSON.parse(raw));
    ensureSystemItems(_demoCfg);
  }
  return _demoCfg;
}

/* items is what every consumer iterates, so a wrong-typed one is the crash
   vector. A missing items or settings is repaired rather than rejected, so a
   minimal but valid config is kept instead of being backed up and blanked. */
function _normalizeShape(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.items !== undefined && !Array.isArray(parsed.items)) return null;
  if (!Array.isArray(parsed.items)) parsed.items = [];
  if (!parsed.settings || typeof parsed.settings !== 'object' || Array.isArray(parsed.settings)) parsed.settings = {};
  return parsed;
}

/* Timestamped and written with wx, so one corruption cannot overwrite an earlier
   backup, and the same content is preserved only once. */
let _lastCorruptRaw = null;
function _backupCorrupt(raw) {
  if (raw === _lastCorruptRaw) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try { fs.writeFileSync(`${CONFIG_PATH}.corrupt-${stamp}`, raw, { encoding:'utf8', flag:'wx' }); } catch {}
  _lastCorruptRaw = raw;
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

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    /* Preserve it instead of letting the next save overwrite it. */
    log.warn('config file corrupt, backing up and starting with a blank config', { path: CONFIG_PATH, error: e.message });
    _backupCorrupt(raw);
    return migrate({ items:[], settings:{} });
  }

  const shaped = _normalizeShape(parsed);
  if (!shaped) {
    /* Valid JSON, wrong shape. Treated like an unparseable file rather than
       caching a shape that throws for every consumer. */
    log.warn('config file has the wrong shape, backing up and starting with a blank config', { path: CONFIG_PATH });
    _backupCorrupt(raw);
    return migrate({ items:[], settings:{} });
  }

  const before = shaped._schemaVersion;
  migrate(shaped);
  _cfgCache = shaped; _cfgCacheAt = now;
  /* A failed write, on a read-only volume for instance, must not break reads: the
     migrated copy is cached and re-migrates next load. */
  if (shaped._schemaVersion !== before) { try { saveConfig(shaped); } catch {} }
  return shaped;
}

/* Every write bumps _rev, and POST /api/config rejects a stale one, so two admin
   tabs saving over each other is a 409 rather than a silent loss. */
function saveConfig(data) {
  if (data && typeof data === 'object') {
    data._schemaVersion = SCHEMA_VERSION;
    data._rev = (Number(data._rev) || 0) + 1;
  }
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive:true });
  const tmp = CONFIG_PATH + '.tmp';

  /* Write, flush, rename, flush the directory. Temp-and-rename alone only stops a
     reader seeing a half-written file; without the flushes a power cut can leave
     the rename applied and the contents lost, which is a real case on a Pi that
     gets unplugged. The second flush is on the directory, because the rename is
     a directory entry. */
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
    /* Otherwise a failed save leaves a temp file behind for good. */
    try { fs.unlinkSync(tmp); } catch { /* nothing more to do */ }
    throw e;
  }

  try {
    const dirFd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
  } catch {
    /* Some filesystems refuse to fsync a directory. The contents are already
       durable here, so this is not worth failing the save over. */
  }

  /* Only after the write succeeded, or the app shows changes that were never
     saved. */
  _cfgCache = data; _cfgCacheAt = Date.now();
}

/* A permanent default item: movable and hideable like any app, but never removed
   or edited. Guaranteed present on every read and write. */
const SYSTEM_SETTINGS_ITEM = { id:'settings', type:'app', system:'settings', label:'Settings', dock:false, color:'#027eae' };
function ensureSystemItems(cfg) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  if (!Array.isArray(cfg.items)) cfg.items = [];
  const s = cfg.items.find(i => i && i.system === 'settings');
  if (!s) cfg.items.push({ ...SYSTEM_SETTINGS_ITEM });
  else { s.type = 'app'; s.system = 'settings'; if (!s.label) s.label = 'Settings'; }
  return cfg;
}

module.exports = { CONFIG_PATH, ICONS_PATH, SCHEMA_VERSION, loadConfig, saveConfig, ensureSystemItems, migrate };
