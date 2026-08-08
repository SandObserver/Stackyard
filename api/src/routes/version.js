const { on, json } = require('../router');
const { fetchUnchecked } = require('../proxy');
const { PING_MS } = require('../timeouts');
const log = require('../log');
const pkg = require('../../package.json');
const { isNewer } = require('../semver');

/* Installed container version, baked in at build time from api/package.json. */
const CURRENT = process.env.APP_VERSION || pkg.version || '0.0.0';
const REPO = 'SandObserver/stackyard';
const CACHE_MS = 60 * 60 * 1000; /* re-check the latest release at most hourly */

/* `checked` rather than a null test on `latest`: the guard used to be
   `latest !== null`, so a failed lookup left it null and every subsequent request
   went back to GitHub. Unauthenticated callers get 60 requests an hour, so an
   install that cannot reach GitHub, or one behind blocked egress, spent its quota
   and stayed rate-limited. A failure is now cached like a success, and any
   previously known value is kept. */
/** @type {{ at: number, latest: string|null, checked: boolean }} */
let _cache = { at: 0, latest: null, checked: false };

/** Whether the remote lookup should run, given what is cached.

    Keyed on `checked`, not on whether a version was found. The guard used to ask
    `latest !== null`, so a failed lookup never counted as cached and the next
    request went straight back out.

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
    _cache = { at: now, latest: _cache.latest, checked: true }; /* keep any prior value */
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

/* Exported for tests; the route above registers itself on require. */
module.exports = {
  shouldFetch,
  CACHE_MS,
  _resetCache: () => {
    _cache = { at: 0, latest: null, checked: false };
  },
};
