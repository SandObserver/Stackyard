const { on, json } = require('../router');
const { fetchUnchecked } = require('../proxy');
const { PING_MS } = require('../timeouts');
const log = require('../log');
const pkg = require('../../package.json');
const { isNewer } = require('../semver');

const CURRENT = process.env.APP_VERSION || pkg.version || '0.0.0';
const REPO = 'SandObserver/stackyard';
const CACHE_MS = 60 * 60 * 1000;

/** @type {{ at: number, latest: string|null, checked: boolean }} */
let _cache = { at: 0, latest: null, checked: false };

/** Key this on `checked`, not on whether a version was found. A failed lookup
    must count as cached, or an install that cannot reach GitHub spends its
    unauthenticated quota and stays rate-limited.

    @param {{ at:number, checked:boolean }} cache @param {number} now */
function shouldFetch(cache, now) {
  return !cache.checked || now - cache.at >= CACHE_MS;
}

async function getLatest() {
  const now = Date.now();
  if (!shouldFetch(_cache, now)) return _cache.latest;
  try {
    const r = await fetchUnchecked(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'stackyard', Accept: 'application/vnd.github+json' },
      timeout: PING_MS,
    });
    const tag = r.data && (r.data.tag_name || r.data.name);
    _cache = { at: now, latest: tag ? String(tag).replace(/^v/i, '') : null, checked: true };
  } catch (e) {
    log.error('version check failed', { error: e.message });
    _cache = { at: now, latest: _cache.latest, checked: true };
  }
  return _cache.latest;
}

on('GET', '/api/version', async (_, res) => {
  let latest = null,
    updateAvailable = false;
  try {
    latest = await getLatest();
    if (latest) updateAvailable = isNewer(latest, CURRENT);
  } catch {
    /* installed version still returns below */
  }
  json(res, 200, { current: CURRENT, latest, updateAvailable });
});

module.exports = {
  shouldFetch,
  CACHE_MS,
  _resetCache: () => {
    _cache = { at: 0, latest: null, checked: false };
  },
};
