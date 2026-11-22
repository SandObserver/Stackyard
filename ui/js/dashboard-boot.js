import { firstViewWait } from '/js/background.js?v=51e46417';
import { blockingScreenFor, showBlockingScreen } from '/js/config-recovery.js?v=ad222fc7';
import { createBadges } from '/js/dashboard-badges.js?v=a6f982e9';
import { createDesktopGrid } from '/js/dashboard-grid.js?v=20529cfb';
import { wirePageInput, wireTileSettle } from '/js/dashboard-input.js?v=d00db7fb';
import { createLayout } from '/js/dashboard-layout.js?v=468fef4e';
import { configChanged, withKnownSizes } from '/js/dashboard-logic.js?v=b4828b62';
import { createPager } from '/js/dashboard-pager.js?v=f6910a39';
import { createPolling } from '/js/dashboard-polling.js?v=1cf284ec';
import { liftVeil, showApiDown } from '/js/dashboard-screens.js?v=79b0c104';
import { showSetupPrompt } from '/js/dashboard-setup.js?v=57d2e8bb';
import { wireThemeChanges } from '/js/dashboard-theme.js?v=7ca0569a';
import { createWallpaper } from '/js/dashboard-wallpaper.js?v=e4719c98';
import { initFluidHover } from '/js/fluid-hover.js?v=eb6cc81c';
import { currentLang, initI18n, isSupported } from '/js/i18n.js?v=82ba9da2';
import { iconChain, loadLocalIcons } from '/js/icons.js?v=76c29d43';
import { sanitizeItemLinks } from '/js/link-url.js?v=0bffa1dd';
import { initSpotlight } from '/js/spotlight.js?v=0a57ef85';
import { initUI, mkFolderGlyph, openFolderDesktop, openFolderMobile } from '/js/ui.js?v=bc665c94';
import { storeGet, storeSet, within } from '/js/utils.js?v=457d9918';
import { startWakeLock } from '/js/wake-lock.js?v=6b9591cf';
import { saveBootHint } from '/js/wallpaper-cache.js?v=cd968718';
import { WIDGET_COLS } from '/js/widget-types.js?v=afec2dab';

export const LANG_STORE = 'dash_lang';

/** @param {import('/js/dashboard-state.js?v=51013727').DashboardState} dash */
export async function boot(dash) {
  const BOOT_TIMEOUT_MS = dash.bootTimeoutMs;
  /** @param {string} type */
  const linkFields = type => dash.widgetReg[type]?.fields;
  const badges = createBadges(dash);
  const pager = createPager(dash);
  const { goTo } = pager;
  const grid = createDesktopGrid({ dash, badges, goTo });
  const wallpaper = createWallpaper(dash);
  const { applyBg } = wallpaper;
  const { BEL, breg, bunreg, bupd, refreshBadges, pollBadges, pollHealth } = badges;

  const settled = p =>
    p.then(
      v => ({ v }),
      e => ({ e }),
    );
  const early = /** @type {any} */ (window).__early;
  /** @type {any} */ (window).__early = null;
  const configReq = settled(
    early?.config ?? fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(BOOT_TIMEOUT_MS) }),
  );
  /** @param {Promise<Response>} [sent] */
  const loadWidgets = sent =>
    settled(
      (sent ?? fetch('/api/widgets', { cache: 'no-store' })).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    );
  let widgetsReq = loadWidgets(early?.widgets);
  const iconsReq = loadLocalIcons();

  let authData = null;
  try {
    const authCheck = await (early?.auth ??
      fetch('/api/auth/check', {
        cache: 'no-store',
        signal: AbortSignal.timeout(BOOT_TIMEOUT_MS),
      }));
    if (authCheck.status === 401) {
      window.location.href = '/admin/';
      return;
    }
    authData = await authCheck.json();
    const screen = authCheck.ok ? null : blockingScreenFor(authData);
    if (screen) {
      await showBlockingScreen(screen);
      return;
    }
    if (authData.enabled && !authData.authenticated) {
      window.location.href = '/admin/';
      return;
    }
  } catch {
    /* API down, handled below */
  }

  let apiFailed = false;
  /** @type {Promise<unknown>|null} */
  let wallpaperShown = null;
  const showWallpaperOnce = () => (wallpaperShown ??= applyBg());
  try {
    const got = await configReq;
    if (got.e) throw got.e;
    const res = got.v;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const c = await res.json();
    dash.items = withKnownSizes(c.items || [], WIDGET_COLS.desktop);
    dash.S = c.settings || {};
    dash.rev = c._rev ?? null;
    storeSet(LANG_STORE, await initI18n(dash.S.language || 'en'));
    saveBootHint({ lang: currentLang() });
    showWallpaperOnce();
  } catch (e) {
    console.error('[boot]', e);
    apiFailed = true;
  }

  await iconsReq;

  /* Without the list every widget renders as a blank frame. */
  if (!apiFailed && (await widgetsReq).e) widgetsReq = loadWidgets();
  if (!apiFailed && (await widgetsReq).e) {
    console.error('[boot]', (await widgetsReq).e);
    apiFailed = true;
  }

  if (apiFailed) {
    /* The catalog is loaded as the last step of the fetch that just failed, so
       without this the only screen left renders its own keys. nginx serves this
       file, the API served the config, so it is still reachable. */
    const lastLang = storeGet(LANG_STORE);
    await initI18n(isSupported(lastLang) ? lastLang : 'en');
    showApiDown();
    liftVeil();
    return;
  }

  if (authData && !authData.setupPrompted && !authData.passwordSet) {
    await showSetupPrompt(dash);
  }

  dash.widgetReg = Object.create(null);
  const wr = (await widgetsReq).v;
  for (const w of Array.isArray(wr?.widgets) ? wr.widgets : []) if (w && w.name) dash.widgetReg[w.name] = w;
  /* Saving rejects these, but a config written earlier still reaches here.
     See ui/js/link-url.js. */
  sanitizeItemLinks(dash.items, linkFields);

  const { items, S, CB, widgetReg } = dash;
  initUI({ items, S, CB, BEL, breg, bunreg, bupd, widgetReg });
  initFluidHover();
  initSpotlight({
    getItems: () => dash.items,
    isMob: () => dash.mob,
    typeToOpen: () => dash.S.typeToSearch !== false,
    CB,
    iconChain,
    openFolderDesktop,
    openFolderMobile,
    folderGlyph: mkFolderGlyph,
  });

  const layout = createLayout({ dash, grid, pager, wallpaper });
  layout.buildLayout();

  if (dash.S.background?.type === 'unsplash') screen.orientation?.addEventListener('change', applyBg);

  wirePageInput({ dash, goTo });

  showWallpaperOnce();

  wireThemeChanges({ refreshBadges, applyBg });

  layout.watchLayoutChange();
  layout.watchSafeArea();
  layout.watchOrientation();
  layout.watchResize();

  /** @param {any} c a fetched config */
  const differs = c => {
    sanitizeItemLinks(c.items || [], linkFields);
    return configChanged({ items: dash.items, settings: dash.S, _rev: dash.rev }, c);
  };
  const polling = createPolling({ badges, differs, rev: () => dash.rev });

  wireTileSettle();
  polling.watchVisibility();
  polling.watchRestore(BOOT_TIMEOUT_MS);

  pollBadges();
  pollHealth();
  polling.startPolling();

  /* A settings change reloads the page, so this is read once. */
  if (dash.S.keepAwake === true) startWakeLock();

  await within(
    layout.firstBuild.then(() => wallpaperShown),
    firstViewWait(),
  );
  liftVeil();
}
