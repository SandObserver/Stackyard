import { LANG_STORE, boot } from '/js/dashboard-boot.js?v=cb324c51';
import { showBuildFailed, liftVeil } from '/js/dashboard-screens.js?v=79b0c104';
import { createDashboardState } from '/js/dashboard-state.js?v=51013727';
import { startGlass } from '/js/glass.js?v=7c376881';
import { initI18n, isSupported } from '/js/i18n.js?v=82ba9da2';
import { ensureSprite } from '/js/icon-set.js?v=beda3062';
import { isMobileLayout } from '/js/layout.js?v=6680c0bf';
import { watchTransparency } from '/js/theme.js?v=0bbd81e8';
import { storeGet } from '/js/utils.js?v=457d9918';

ensureSprite();

if (!('GestureEvent' in window)) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport)
    viewport.setAttribute('content', `${viewport.getAttribute('content')},interactive-widget=resizes-content`);
}

const dash = createDashboardState({
  mob: isMobileLayout(true),
  /* Set by boot-hints.js. */
  bootTimeoutMs: /** @type {any} */ (window).__bootTimeoutMs,
});

watchTransparency();
startGlass();
boot(dash).catch(async e => {
  console.error('[boot]', e);
  const lastLang = storeGet(LANG_STORE);
  await initI18n(isSupported(lastLang) ? lastLang : 'en').catch(() => {});
  showBuildFailed();
  liftVeil();
});
