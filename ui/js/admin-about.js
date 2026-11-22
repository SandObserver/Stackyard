import { apiGet } from '/js/admin-shared.js?v=0f28a237';
import { html, setHtml } from '/js/html.js?v=48f9dc21';
import { t } from '/js/i18n.js?v=82ba9da2';
import { el } from '/js/utils.js?v=457d9918';

/* The arc turns once, as on the docs site, when the logo is pointed at or
   tapped. Never on its own. */
export function initAboutLogo() {
  const wrap = document.querySelector('.about-ic-wrap');
  const orbit = document.querySelector('.about-orbit');
  if (!wrap || !orbit || typeof orbit.animate !== 'function') return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let run = null;
  const spin = () => {
    if (run || reduce.matches) return;
    run = orbit.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], {
      duration: 1000,
      easing: 'cubic-bezier(.65,0,.35,1)',
    });
    run.onfinish = run.oncancel = () => {
      run = null;
    };
  };
  wrap.addEventListener('pointerenter', e => {
    if (/** @type {PointerEvent} */ (e).pointerType !== 'touch') spin();
  });
  wrap.addEventListener('click', spin);
}

/** Write the running version into the sidebar and About, with a link when a
    newer release exists. Translated, so it runs after the catalog loads. */
export async function initVersion() {
  try {
    const d = await apiGet('/api/version');
    const v = (d.current || d.version || '').replace(/^v/i, '');
    if (v) {
      const vEl = el('sidebar-version');
      const aEl = el('about-version');
      if (vEl) vEl.textContent = 'v' + v;
      if (aEl) aEl.textContent = t('about.version', { v });
      if (d.updateAvailable) {
        const dot = el('about-update-dot');
        dot?.classList.remove('d-none');
        if (aEl && d.latest) {
          const lv = String(d.latest).replace(/^v/i, '');
          setHtml(
            aEl,
            html`${t('about.version', { v })} &middot;
              <a
                href="https://github.com/SandObserver/stackyard/releases/latest"
                target="_blank"
                rel="noopener"
                class="upd-link"
                >${t('about.updateTo', { v: lv })}</a
              >`,
          );
        }
      }
    }
  } catch {}
}
