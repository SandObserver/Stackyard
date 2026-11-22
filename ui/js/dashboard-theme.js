import { applyTheme, prefersDark, readMode, resolveTheme, THEME_KEY } from '/js/theme.js?v=0bbd81e8';
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
  let themeWaits = false;
  const onTheme = () => {
    /* A hidden page skips a view transition. Run it when the page is seen. */
    if (document.hidden) {
      if (themeWaits) return;
      themeWaits = true;
      document.addEventListener(
        'visibilitychange',
        () => {
          themeWaits = false;
          onTheme();
        },
        { once: true },
      );
      return;
    }
    const doc = /** @type {any} */ (document);
    if (typeof doc.startViewTransition === 'function') doc.startViewTransition(retheme);
    else retheme();
  };
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (readMode() === 'system') onTheme();
    });
  } catch {}
  window.addEventListener('storage', e => {
    if (e.key === THEME_KEY) onTheme();
  });
}
