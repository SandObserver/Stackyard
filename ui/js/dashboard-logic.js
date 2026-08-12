// @ts-check
/* Keep this module free of the DOM, of fetch and of module state. */

/** Whether the open dashboard should reload to pick up a config change. The
    field fingerprint is only a fallback for a page whose loaded copy predates
    `_rev`. It misses any field nobody listed.

    @param {any} loaded the config this page was built from
    @param {any} fetched what the poll just received
    @returns {boolean} */
export function configChanged(loaded, fetched) {
  if (!fetched || typeof fetched !== 'object') return false;
  if (fetched._rev != null && loaded?._rev != null) return fetched._rev !== loaded._rev;
  return fingerprint(fetched) !== fingerprint(loaded);
}

/** @param {any} c */
function fingerprint(c) {
  return JSON.stringify(c?.items?.map(i => `${i?.id}|${i?.label}|${i?.href}`)) + JSON.stringify(c?.settings);
}

/** One day. */
const WALLPAPER_TTL_MS = 24 * 60 * 60 * 1000;

/** @param {any} bg the background settings @returns {string} */
function wallpaperKey(bg) {
  return `${bg?.type || ''}|${bg?.collection || ''}`;
}

/** The still-valid wallpaper URL held for these background settings, if any.

    @param {string|null} stored the raw stored entry
    @param {any} bg the background settings the page was built from
    @param {number} now
    @returns {string|null} */
export function readWallpaperCache(stored, bg, now) {
  if (typeof stored !== 'string' || !stored) return null;
  let entry;
  try {
    entry = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!entry || typeof entry.url !== 'string' || !entry.url) return null;
  if (entry.key !== wallpaperKey(bg)) return null;
  if (typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return null;
  /* A clock moved backwards would otherwise hold one photo forever. */
  if (now < entry.at || now - entry.at >= WALLPAPER_TTL_MS) return null;
  return entry.url;
}

/** @param {string} url @param {any} bg @param {number} now @returns {string} */
export function writeWallpaperCache(url, bg, now) {
  return JSON.stringify({ url, key: wallpaperKey(bg), at: now });
}

/** The page index to open on, clamped to the pages that exist.

    @param {string|null} stored @param {number} totalPages @returns {number} */
export function restorePage(stored, totalPages) {
  const n = Number(stored);
  if (stored == null || stored === '' || !Number.isInteger(n) || n < 0) return 0;
  if (!Number.isInteger(totalPages) || totalPages < 1) return 0;
  return Math.min(n, totalPages - 1);
}

/** Where to send the browser once first-run setup is finished.

    @param {unknown} items the dashboard items the page was built from
    @returns {string|null} a path to navigate to, or null to stay put */
export function landingAfterSetup(items) {
  return Array.isArray(items) && items.length === 0 ? '/admin' : null;
}
