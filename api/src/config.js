const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.CONFIG_PATH || '/data/apps.json';
const ICONS_PATH  = process.env.ICONS_PATH  || '/icons';

let _cfgCache = null, _cfgCacheAt = 0;
const CONFIG_TTL_MS = 5000;

function loadConfig() {
  const now = Date.now();
  if (_cfgCache && (now - _cfgCacheAt) < CONFIG_TTL_MS) return _cfgCache;
  try {
    _cfgCache = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    _cfgCacheAt = now;
    return _cfgCache;
  } catch { return { items:[], settings:{} }; }
}

function saveConfig(data) {
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

module.exports = { CONFIG_PATH, ICONS_PATH, loadConfig, saveConfig, ensureSystemItems };
