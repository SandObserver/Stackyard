/* The Settings page appearance: dark, light, or whichever the device asks for.

   The choice is per device, not per dashboard. It is read from localStorage and
   never written to the config, so two people opening Settings on two machines
   each get their own, and a machine keeps its own through a config import.

   "system" is resolved here rather than in a media query. The stylesheets carry
   one light block, selected by data-theme, and a prefers-color-scheme copy of it
   would be a second place to change every colour.

   ui/js/admin-theme.js repeats what this file decides so the attribute is on
   <html> before the first paint. A parity test holds the two together. */

export const THEME_KEY = 'sy-theme';

/** @type {readonly ['system','light','dark']} */
export const THEME_MODES = /** @type {const} */ (['system', 'light', 'dark']);

/** The stored value, or "system" for anything this version does not know.
    @param {string|null|undefined} value */
export function normaliseMode(value) {
  return THEME_MODES.includes(/** @type {any} */ (value)) ? String(value) : 'system';
}

/** The theme a mode resolves to.
    @param {string} mode
    @param {boolean} prefersDark whether the device asks for a dark appearance */
export function resolveTheme(mode, prefersDark) {
  const m = normaliseMode(mode);
  if (m === 'system') return prefersDark ? 'dark' : 'light';
  return m;
}

/** The chrome colour for a theme: the surface the page draws behind its panel. */
export function themeColor(theme) {
  return theme === 'light' ? '#FFFFFF' : '#0d1117';
}

/** Writes the theme onto the document.
    @param {string} theme
    @param {Document} doc */
export function applyTheme(theme, doc = document) {
  doc.documentElement.setAttribute('data-theme', theme);
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColor(theme));
}

/** The mode this device is set to.
    @param {Storage} [store] */
export function readMode(store) {
  try {
    return normaliseMode((store || localStorage).getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

/** Stores a mode and applies it.
    @param {string} mode
    @param {Storage} [store] */
export function writeMode(mode, store) {
  const m = normaliseMode(mode);
  try {
    (store || localStorage).setItem(THEME_KEY, m);
  } catch {}
  applyTheme(resolveTheme(m, prefersDark()));
  return m;
}

export function prefersDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return true;
  }
}

/** Follows the device while the mode is "system". Returns a teardown.
    @param {() => string} currentMode */
export function watchSystemTheme(currentMode) {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = e => {
      if (currentMode() === 'system') applyTheme(resolveTheme('system', e.matches));
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  } catch {
    return () => {};
  }
}
