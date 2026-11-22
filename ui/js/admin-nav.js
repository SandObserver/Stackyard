import { resolveAdminSection } from '/js/admin-logic.js?v=81fd47cf';
import { fadeOpacity } from '/js/admin-shared.js?v=0f28a237';
import { initGlideSelect, syncGlideSelect } from '/js/glide-select.js?v=0c57b286';
import { t } from '/js/i18n.js?v=82ba9da2';
import { animateIcon } from '/js/icon-motion.js?v=7bfd91f5';
import { el, qa, storeGet, storeSet } from '/js/utils.js?v=457d9918';

const STORE = 'admin_sec';

let shown = '';
let titled = false;

/** Call once the catalog has loaded. */
export function titleSettingsPage() {
  titled = true;
  const key = el('sec-' + shown)
    ?.querySelector('.sec-title[data-i18n]')
    ?.getAttribute('data-i18n');
  document.title = key ? t('nav.sectionTitle', { section: t(key) }) : t('nav.pageTitle');
}

export function scrollSettingsTop() {
  scrollTo(0, 0);
}

/** Give each sidebar and tab bar icon its motion. */
export function animateNavIcons() {
  for (const b of document.querySelectorAll('.nl[data-sec], .mtab[data-sec]')) {
    const svg = b.querySelector('svg.ni');
    if (svg instanceof SVGSVGElement) animateIcon(svg, /** @type {HTMLElement} */ (b).dataset.sec || '', b);
  }
}

/** Show one Settings section at a time, picked from the sidebar, the tab bar or
    the address hash, and remember it for the next visit. */
export function initNav() {
  const links = qa('.nl, .mtab');
  const sections = qa('.sec', document).map(s => s.id.replace(/^sec-/, ''));
  shown = '';

  /* Do not scroll on the restoring first call. Only a picked section. */
  function show(requested, picked, ev) {
    const id = resolveAdminSection(requested, sections);
    if (id === null) return;
    if (requested && id !== requested) console.warn('admin: unknown section', requested, '- showing', id);
    const changed = id !== shown;
    shown = id;
    qa('.sec', document).forEach(s => {
      s.hidden = s.id !== 'sec-' + id;
    });
    const keyboard = ev?.detail === 0;
    if (picked && changed && !keyboard) fadeOpacity(el('sec-' + id));
    links.forEach(l => {
      const on = l.dataset.sec === id;
      l.classList.toggle('active', on);
      if (on) l.setAttribute('aria-current', 'page');
      else l.removeAttribute('aria-current');
    });
    syncGlideSelect(document, { snap: keyboard });
    storeSet(STORE, id);
    if (titled) titleSettingsPage();
    if (picked) scrollSettingsTop();
  }
  links.forEach(l => l.addEventListener('click', e => show(l.dataset.sec, true, e)));
  addEventListener('hashchange', () => show(location.hash.slice(1), true));
  show(location.hash.slice(1) || storeGet(STORE));
  initGlideSelect();
}
