// @ts-check
import { esc, html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { LANGUAGES, initI18n, t } from '/js/i18n.js?v=1f1ea9c1';
import { sanitizeI18nMarkup } from '/js/i18n-markup.js?v=8c90e1dd';
import {
  fillNames,
  HELP_URL,
  pickLanguage,
  readConfigDamage,
  recoverySteps,
} from '/js/config-recovery-logic.js?v=43ade6d7';

let _shown = false;
export const recoveryShown = () => _shown;

/** Replace the page with the recovery screen. Nothing else on the page may keep
    running: the API refuses every request until the file is fixed.
    @param {{ reason: string, file: string, backup: string | null }} damage */
export async function showConfigRecovery(damage) {
  _shown = true;
  await initI18n(
    pickLanguage(
      navigator.languages || [navigator.language],
      LANGUAGES.map(l => l.code),
    ),
  );
  document.title = t('configRecovery.title');
  const screen = document.createElement('div');
  screen.className = 'cfg-recovery';
  setHtml(
    screen,
    html`<div class="cfg-recovery-card">
      <div class="cfg-recovery-body"></div>
      <button class="cfg-recovery-btn" type="button">${t('configRecovery.checkAgain')}</button>
      <p class="cfg-recovery-status" role="status"></p>
      <p class="cfg-recovery-help">${t('configRecovery.logHint')} <a href="${HELP_URL}" target="_blank" rel="noopener">${t('configRecovery.troubleshooting')}</a></p>
    </div>`,
  );
  const body = /** @type {HTMLElement} */ (screen.querySelector('.cfg-recovery-body'));
  const btn = /** @type {HTMLButtonElement} */ (screen.querySelector('.cfg-recovery-btn'));
  const status = /** @type {HTMLElement} */ (screen.querySelector('.cfg-recovery-status'));
  renderBody(body, damage);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = '';
    try {
      const res = await fetch('/api/auth/check', { cache: 'no-store' });
      const next = res.status === 503 ? readConfigDamage(await res.json().catch(() => null)) : null;
      if (!next) {
        location.reload();
        return;
      }
      renderBody(body, next);
      status.textContent = t('configRecovery.stillDamaged');
    } catch {
      status.textContent = t('home.apiDownTitle');
    } finally {
      btn.disabled = false;
    }
  });
  document.body.replaceChildren(screen);
  document.body.classList.add('ready');
  /** @type {HTMLElement | null} */ (body.querySelector('h1'))?.focus();
}

/** @param {HTMLElement} body @param {{ reason: string, file: string, backup: string | null }} damage */
function renderBody(body, damage) {
  const why = damage.reason === 'unreadable' ? 'configRecovery.whyUnreadable' : 'configRecovery.whyCorrupt';
  setHtml(
    body,
    html`<h1 class="cfg-recovery-title" tabindex="-1">${t('configRecovery.title')}</h1>
      <p class="cfg-recovery-why">${named(why, { file: damage.file })}</p>
      <p class="cfg-recovery-safe">${t('configRecovery.locked')}</p>
      <h2 class="cfg-recovery-steps-title">${t('configRecovery.stepsTitle')}</h2>
      <ol class="cfg-recovery-steps">
        ${recoverySteps(damage).map(s => html`<li>${named(s.key, s.vars)}</li>`)}
      </ol>`,
  );
}

/** @param {string} key @param {Record<string, string>} [vars] */
const named = (key, vars) => raw(fillNames(v => t(key, v), vars, sanitizeI18nMarkup, esc));
