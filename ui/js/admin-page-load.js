import { initAboutLogo, initVersion } from '/js/admin-about.js?v=50860c17';
import { render } from '/js/admin-list.js?v=d1cefe2a';
import { titleSettingsPage } from '/js/admin-nav.js?v=465fb192';
import { loadSettings } from '/js/admin-settings.js?v=48b2de2a';
import { syncPickerLabels } from '/js/admin-settings-controls.js?v=4b3a87ea';
import { apiGet, errorText, nameEditPen, toast } from '/js/admin-shared.js?v=0f28a237';
import { collapsedFolders, state } from '/js/admin-state.js?v=064b9b85';
import { applyBackground, firstViewWait, rememberBackground, resolveBackground } from '/js/background.js?v=51e46417';
import { html, setHtml } from '/js/html.js?v=48f9dc21';
import { initI18n, t } from '/js/i18n.js?v=82ba9da2';
import { loadLocalIcons } from '/js/icons.js?v=76c29d43';
import { el, q, qa, within } from '/js/utils.js?v=457d9918';
import { saveBootHint } from '/js/wallpaper-cache.js?v=cd968718';

/** Load the config into the admin page, and show the wallpaper behind it.
    @param {{ writes: { loaded: (items: any[]) => void, drawn: () => void, syncDashSave: () => void } }} page */
export function createPageLoad({ writes }) {
  let bgCall = 0;
  let bgShown = false;

  async function applyBg() {
    const call = ++bgCall;
    const root = document.documentElement;
    const s = (state._settings && state._settings.background) || {};
    let bg = null;
    try {
      bg = await resolveBackground(s);
    } catch {}
    if (call !== bgCall) return;
    if (bg || !bgShown) rememberBackground(s, bg);
    if (bg) {
      applyBackground(root, bg);
      bgShown = true;
      if (document.body.classList.contains('loaded')) root.classList.add('wall-in');
      return;
    }
    root.style.removeProperty('--boot-bg');
    if (!bgShown && s.type === 'unsplash') toast(t('toast.wallpaperUnavailable'), 'err');
  }

  async function load() {
    const iconsReq = loadLocalIcons();
    const widgetsReq = apiGet('/api/widgets').catch(() => null);
    const c = await apiGet('/api/config');
    await iconsReq;
    writes.loaded(c.items || []);
    state.items = c.items || [];
    state._settings = c.settings || {};
    saveBootHint({ lang: await initI18n(c.settings?.language || 'en') });
    document.documentElement.classList.remove('lang-pending');
    qa('.ie-row').forEach(nameEditPen);
    titleSettingsPage();
    initVersion();
    initAboutLogo();
    syncPickerLabels();
    const wr = await widgetsReq;
    state._widgetReg = Object.create(null);
    (wr?.widgets || []).forEach(w => {
      state._widgetReg[w.name] = w;
    });
    state._widgetRejected = wr?.rejected || [];
    state.items.filter(i => i.type === 'folder').forEach(f => collapsedFolders.add(f.id));
    document.body.classList.add('authed');
    render();
    writes.drawn();
    writes.syncDashSave();
    loadSettings(c, { applyBg });
    syncPickerLabels();
    await within(applyBg(), firstViewWait());
  }

  /** Load, or show the failure with a way to try again. */
  const loadOrShowFailure = () => {
    document.body.classList.remove('load-stopped');
    return load()
      .catch(e => {
        toast(t('toast.configLoadFailed', { err: errorText(e) }), 'err');
        const al = el('al');
        if (al) {
          /* An inline onclick is blocked by the CSP. */
          setHtml(
            al,
            html`<div class="dash-load-fail">${t('home.loadFailed')}<br><br><button class="retry-btn" type="button">${t('home.retry')}</button></div>`,
          );
          q('.retry-btn', al)?.addEventListener('click', () => location.reload());
          el('al-grp')?.classList.remove('d-none');
        }
      })
      .finally(() => {
        document.documentElement.classList.remove('lang-pending');
        document.body.classList.add('loaded');
      });
  };

  return { load, applyBg, loadOrShowFailure };
}
