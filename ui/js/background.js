// @ts-check
import { cssColor, sanitizeCssUrl } from '/js/utils.js?v=843b7c2b';
import { loadWallpaper, saveWallpaper } from '/js/wallpaper-cache.js?v=c5f8a3e6';

export const BACKDROP = '#0d1117';

const DEFAULT_BRIGHTNESS = 0.62;

/** @typedef {{ image: string, color: string, brightness: string, size: string,
                url: string|null, fit: 'fit'|'fill' }} Background */

/** @param {any} bg @param {string|null} [wallpaperUrl]
    @returns {Background|null} */
export function backgroundFor(bg, wallpaperUrl = null) {
  const s = bg || {};
  if (s.type === 'color' && s.color) {
    return {
      image: 'none',
      color: cssColor(s.color, BACKDROP),
      brightness: '1',
      size: 'cover',
      url: null,
      fit: 'fill',
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
  };
}

/** @param {HTMLElement} root @param {Background} b */
export function applyBackground(root, b) {
  root.style.setProperty('--bg-image', b.image);
  root.style.setProperty('--bg-color', b.color);
  root.style.setProperty('--bg-brightness', b.brightness);
  root.style.setProperty('--bg-size', b.size);
}

async function unsplashUrl(bg) {
  const cached = loadWallpaper(bg);
  if (cached) return cached;
  const r = await fetch('/api/wallpaper', { cache: 'no-store' });
  const d = await r.json();
  const url = d.url || null;
  if (url) saveWallpaper(url, bg);
  return url;
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
    const url = await unsplashUrl(s);
    if (!url) return null;
    return (await decoded(url)) ? backgroundFor(s, url) : null;
  }
  return backgroundFor(s);
}
