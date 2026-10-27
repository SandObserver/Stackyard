// @ts-check
import { cssColor, sanitizeCssUrl } from '/js/utils.js?v=ab3cac1d';
import { loadWallpaper, saveWallpaper, validCredit } from '/js/wallpaper-cache.js?v=321c8003';

export const BACKDROP = '#0d1117';

const DEFAULT_BRIGHTNESS = 0.62;

/** @typedef {{ name: string, profile: string, site: string }} PhotoCredit */
/** @typedef {{ image: string, color: string, brightness: string, size: string,
                url: string|null, fit: 'fit'|'fill', credit: PhotoCredit|null }} Background */

/** @param {any} bg @param {string|null} [wallpaperUrl] @param {PhotoCredit|null} [credit]
    @returns {Background|null} */
export function backgroundFor(bg, wallpaperUrl = null, credit = null) {
  const s = bg || {};
  if (s.type === 'color' && s.color) {
    return {
      image: 'none',
      color: cssColor(s.color, BACKDROP),
      brightness: '1',
      size: 'cover',
      url: null,
      fit: 'fill',
      credit: null,
    };
  }
  const url = s.type === 'url' ? s.url : s.type === 'unsplash' ? wallpaperUrl : null;
  if (!url) return null;
  const fit = s.type === 'url' && s.fit === 'fit' ? 'fit' : 'fill';
  const brightness = Number(s.brightness ?? DEFAULT_BRIGHTNESS);
  return {
    image: `url('${sanitizeCssUrl(url)}')`,
    color: BACKDROP,
    brightness: String(Number.isFinite(brightness) ? brightness : DEFAULT_BRIGHTNESS),
    size: fit === 'fit' ? 'contain' : 'cover',
    url: sanitizeCssUrl(url),
    fit,
    credit: s.type === 'unsplash' ? credit : null,
  };
}

/** @param {HTMLElement} root @param {Background} b */
export function applyBackground(root, b) {
  root.style.setProperty('--bg-image', b.image);
  root.style.setProperty('--bg-color', b.color);
  root.style.setProperty('--bg-brightness', b.brightness);
  root.style.setProperty('--bg-size', b.size);
}

/** @param {any} bg @returns {Promise<{ url: string, credit: PhotoCredit|null }|null>} */
async function unsplashPhoto(bg) {
  const cached = loadWallpaper(bg);
  if (cached) return cached;
  const r = await fetch('/api/wallpaper', { cache: 'no-store' });
  const d = await r.json();
  if (typeof d.url !== 'string' || !d.url) return null;
  const photo = { url: d.url, credit: validCredit(d.credit) };
  saveWallpaper(photo, bg);
  return photo;
}

const decoded = url =>
  new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });

/** @param {any} bg @returns {Promise<Background|null>} */
export async function resolveBackground(bg) {
  const s = bg || {};
  if (s.type === 'unsplash') {
    const photo = await unsplashPhoto(s);
    if (!photo) return null;
    return (await decoded(photo.url)) ? backgroundFor(s, photo.url, photo.credit) : null;
  }
  return backgroundFor(s);
}
