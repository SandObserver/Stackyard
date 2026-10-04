// @ts-check
import { esc, html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { LANGUAGES, initI18n, t } from '/js/i18n.js?v=5579776a';
import { sanitizeI18nMarkup } from '/js/i18n-markup.js?v=8c90e1dd';
import { fillNames, pickLanguage, screenFor } from '/js/config-recovery-logic.js?v=e6e24763';

let _shown = false;
export const recoveryShown = () => _shown;

/** The screen an API error body calls for, or null.
    @param {unknown} body */
export const blockingScreenFor = body => screenFor(body, location.host);

/** Replace the page with a screen that explains why the API refuses every
    request, and how to fix it. Nothing else on the page may keep running.
    @param {NonNullable<ReturnType<typeof screenFor>>} screenText */
export async function showBlockingScreen(screenText) {
  _shown = true;
  await initI18n(
    pickLanguage(
      navigator.languages || [navigator.language],
      LANGUAGES.map(l => l.code),
    ),
  );
  const screen = document.createElement('div');
  screen.className = 'cfg-recovery';
  setHtml(
    screen,
    html`<div class="cfg-recovery-card">
      <div class="cfg-recovery-body"></div>
      <button class="cfg-recovery-btn" type="button">${t('configRecovery.checkAgain')}</button>
      <p class="cfg-recovery-status" role="status"></p>
      <p class="cfg-recovery-help"></p>
    </div>`,
  );
  const body = /** @type {HTMLElement} */ (screen.querySelector('.cfg-recovery-body'));
  const btn = /** @type {HTMLButtonElement} */ (screen.querySelector('.cfg-recovery-btn'));
  const status = /** @type {HTMLElement} */ (screen.querySelector('.cfg-recovery-status'));
  const help = /** @type {HTMLElement} */ (screen.querySelector('.cfg-recovery-help'));
  render(body, help, screenText);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = '';
    try {
      const res = await fetch('/api/auth/check', { cache: 'no-store' });
      const next = res.ok ? null : blockingScreenFor(await res.json().catch(() => null));
      if (!next) {
        location.reload();
        return;
      }
      render(body, help, next);
      status.textContent = t(next.still);
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

/** @param {HTMLElement} body @param {HTMLElement} help
    @param {NonNullable<ReturnType<typeof screenFor>>} s */
function render(body, help, s) {
  document.title = t(s.title);
  setHtml(
    body,
    html`<h1 class="cfg-recovery-title" tabindex="-1">${t(s.title)}</h1>
      <p class="cfg-recovery-why">${named(s.why.key, s.why.vars)}</p>
      <p class="cfg-recovery-safe">${t(s.safe)}</p>
      <h2 class="cfg-recovery-steps-title">${t(s.stepsTitle)}</h2>
      <ol class="cfg-recovery-steps">
        ${s.steps.map(step => html`<li>${named(step.key, step.vars)}</li>`)}
      </ol>`,
  );
  setHtml(
    help,
    html`${s.logHint ? html`${t('configRecovery.logHint')} ` : ''}<a href="${s.help}" target="_blank" rel="noopener">${t('configRecovery.troubleshooting')}</a>`,
  );
}

/** @param {string} key @param {Record<string, string>} [vars] */
const named = (key, vars) => raw(fillNames(v => t(key, v), vars, sanitizeI18nMarkup, esc));
