import { applyTheme, fadeTheme, prefersDark, readMode, resolveTheme, THEME_KEY } from '/js/theme.js?v=4e6279e8';
import { rethemeTiles } from '/js/utils.js?v=457d9918';

/** @param {{ refreshBadges: () => void, applyBg: () => unknown }} deps */
export function wireThemeChanges({ refreshBadges, applyBg }) {
  const rethemeFrames = () => {
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        /** @type {any} */ (frame.contentWindow)?.__applyHostTheme?.();
      } catch {
        /* A cross-origin page keeps its own theme. */
      }
    }
  };
  new MutationObserver(rethemeFrames).observe(document.documentElement, { attributeFilter: ['data-transparency'] });
  const retheme = () => {
    applyTheme(resolveTheme(readMode(), prefersDark()));
    rethemeTiles();
    rethemeFrames();
    refreshBadges();
    applyBg();
  };
  const onTheme = () => fadeTheme(retheme);
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (readMode() === 'system') onTheme();
    });
  } catch {}
  window.addEventListener('storage', e => {
    if (e.key === THEME_KEY) onTheme();
  });
}
