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

module.exports = { CONFIG_PATH, ICONS_PATH, loadConfig, saveConfig };
