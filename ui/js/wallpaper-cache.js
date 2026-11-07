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

/** @typedef {{ name: string, profile: string, site: string }} PhotoCredit */
/** @typedef {{ url: string, credit: PhotoCredit|null }} CachedWallpaper */

const UNSPLASH = 'https://unsplash.com/';

/** A credit the page may render as links, or null.

    @param {any} c @returns {PhotoCredit|null} */
export function validCredit(c) {
  if (!c || typeof c !== 'object') return null;
  const { name, profile, site } = c;
  if (typeof name !== 'string' || !name.trim()) return null;
  if (typeof profile !== 'string' || !profile.startsWith(UNSPLASH)) return null;
  if (typeof site !== 'string' || !site.startsWith(UNSPLASH)) return null;
  return { name, profile, site };
}

/** The still-valid wallpaper held for these background settings, if any.

    @param {string|null|undefined} stored the raw stored entry
    @param {any} bg the background settings the page was built from
    @param {number} now
    @returns {CachedWallpaper|null} */
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
  /* Keep. An entry stored before credits would show the photo uncredited. */
  if (!('credit' in entry)) return null;
  return { url: entry.url, credit: validCredit(entry.credit) };
}

/** @param {CachedWallpaper} wallpaper @param {any} bg @param {number} now @returns {string} */
export function writeWallpaperCache(wallpaper, bg, now) {
  return JSON.stringify({ url: wallpaper.url, credit: wallpaper.credit, key: wallpaperKey(bg), at: now });
}

const BOOT_HINT_STORE = 'sy-boot';

/** @param {{ url?: string|null, color?: string|null, lang?: string }} hint @returns {void} */
export function saveBootHint(hint) {
  try {
    const was = JSON.parse(localStorage.getItem(BOOT_HINT_STORE) || '{}');
    localStorage.setItem(BOOT_HINT_STORE, JSON.stringify({ ...was, ...hint }));
  } catch {}
}

const WALLPAPER_MAX_PX = 2880;

/** @param {string} url
    @param {{ width: number, height: number, dpr: number, landscape: boolean }} screen CSS pixels
    @returns {string} */
export function sizedWallpaperUrl(url, { width, height, dpr, landscape }) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.hostname !== 'images.unsplash.com' || !(width > 0 && height > 0 && dpr > 0)) return url;
  const long = Math.max(width, height) * dpr;
  const short = Math.min(width, height) * dpr;
  const scale = Math.min(1, WALLPAPER_MAX_PX / long);
  const l = Math.round(long * scale);
  const s = Math.round(short * scale);
  u.searchParams.set('w', String(landscape ? l : s));
  u.searchParams.set('h', String(landscape ? s : l));
  u.searchParams.set('q', '75');
  u.searchParams.set('auto', 'format');
  u.searchParams.delete('fm');
  return u.href;
}

/** @param {any} bg @param {number} [now] @returns {CachedWallpaper|null} */
export function loadWallpaper(bg, now = Date.now()) {
  let stored = null;
  try {
    stored = localStorage.getItem(WALLPAPER_STORE);
  } catch {
    return null;
  }
  return readWallpaperCache(stored, bg, now);
}

/** @param {CachedWallpaper} wallpaper @param {any} bg @param {number} [now] @returns {void} */
export function saveWallpaper(wallpaper, bg, now = Date.now()) {
  try {
    localStorage.setItem(WALLPAPER_STORE, writeWallpaperCache(wallpaper, bg, now));
  } catch {}
}
