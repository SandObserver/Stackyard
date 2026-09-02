// @ts-check
/* The wallpaper both first-party pages show. Reads and writes one entry so the
   dashboard and the settings pages never show different photos. */

export const WALLPAPER_STORE = 'dash_wallpaper';

/** One day. */
const WALLPAPER_TTL_MS = 24 * 60 * 60 * 1000;

/** @param {any} bg the background settings @returns {string} */
function wallpaperKey(bg) {
  return `${bg?.type || ''}|${bg?.collection || ''}`;
}

/** The still-valid wallpaper URL held for these background settings, if any.

    @param {string|null|undefined} stored the raw stored entry
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

/** @param {any} bg @param {number} [now] @returns {string|null} */
export function loadWallpaper(bg, now = Date.now()) {
  let stored = null;
  try {
    stored = localStorage.getItem(WALLPAPER_STORE);
  } catch {
    return null;
  }
  return readWallpaperCache(stored, bg, now);
}

/** @param {string} url @param {any} bg @param {number} [now] @returns {void} */
export function saveWallpaper(url, bg, now = Date.now()) {
  try {
    localStorage.setItem(WALLPAPER_STORE, writeWallpaperCache(url, bg, now));
  } catch {}
}
