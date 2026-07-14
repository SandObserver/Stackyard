const { on, json } = require('../router');
const { fetchJSON } = require('../proxy');
const { PING_MS } = require('../timeouts');
const log = require('../log');
const pkg = require('../../package.json');

/* Installed container version, baked in at build time from api/package.json. */
const CURRENT = process.env.APP_VERSION || pkg.version || '0.0.0';
const REPO = 'SandObserver/stackyard';
const CACHE_MS = 60 * 60 * 1000; /* re-check the latest release at most hourly */

/** @type {{ at: number, latest: string|null }} */
let _cache = { at: 0, latest: null };

function parseVer(v) { return String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0); }
function isNewer(a, b) {
  const pa = parseVer(a), pb = parseVer(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function getLatest() {
  const now = Date.now();
  if (_cache.latest !== null && (now - _cache.at) < CACHE_MS) return _cache.latest;
  try {
    const r = await fetchJSON(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'stackyard', 'Accept': 'application/vnd.github+json' },
      timeout: PING_MS,
    });
    const tag = r.data && (r.data.tag_name || r.data.name);
    _cache = { at: now, latest: tag ? String(tag).replace(/^v/i, '') : null };
  } catch (e) {
    log.error('version check failed', { error: e.message });
    _cache = { at: now, latest: _cache.latest }; /* keep any prior value, refresh timestamp */
  }
  return _cache.latest;
}

on('GET', '/api/version', async (_, res) => {
  let latest = null, updateAvailable = false;
  try {
    latest = await getLatest();
    if (latest) updateAvailable = isNewer(latest, CURRENT);
  } catch { /* installed version still returns below */ }
  json(res, 200, { current: CURRENT, latest, updateAvailable });
});
