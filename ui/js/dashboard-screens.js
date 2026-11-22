import { html, setHtml } from '/js/html.js?v=48f9dc21';
import { t } from '/js/i18n.js?v=82ba9da2';

export function liftVeil() {
  document.body.classList.add('ready');
}

/** Shows one error screen over the page. A second call shows nothing.
    @param {ReturnType<typeof html>} content @returns {HTMLElement|null} */
function showErrorScreen(content) {
  if (document.body.classList.contains('api-down')) return null;
  document.documentElement.style.removeProperty('--boot-bg');
  const msg = document.createElement('div');
  msg.className = 'api-error-screen';
  msg.setAttribute('role', 'alert');
  setHtml(msg, content);
  for (const child of document.body.children) /** @type {HTMLElement} */ (child).inert = true;
  document.body.classList.add('api-down');
  document.body.appendChild(msg);
  return msg;
}

export function showApiDown() {
  const msg = showErrorScreen(
    html`<h2 class="api-error-title">${t('home.apiDownTitle')}</h2><p class="api-error-sub">${t('home.apiDownSub')}</p><button class="api-error-btn" type="button">${t('home.retry')}</button>`,
  );
  /* Not an inline onclick. The page's CSP refuses those. */
  msg?.querySelector('.api-error-btn')?.addEventListener('click', () => location.reload());
}

export function showBuildFailed() {
  showErrorScreen(
    html`<h2 class="api-error-title">${t('home.loadFailed')}</h2><a class="api-error-btn" href="/admin/">${t('home.emptyAction')}</a>`,
  );
}

/** @param {() => void} build */
export function tryBuild(build) {
  try {
    build();
  } catch (e) {
    console.error('dashboard build failed', e);
    showBuildFailed();
  }
}
