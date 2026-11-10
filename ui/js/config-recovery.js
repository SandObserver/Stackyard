// @ts-check
import { esc, html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { LANGUAGES, initI18n, t } from '/js/i18n.js?v=ec60b9bd';
import { sanitizeI18nMarkup } from '/js/i18n-markup.js?v=8c90e1dd';
import { fillNames, pickLanguage, screenFor, setupCodeErrorKey } from '/js/config-recovery-logic.js?v=d3529225';
import { contextWords, passwordMismatch, passwordProblem, REFUSAL_KEYS } from '/js/password-policy.js?v=0c0fd0af';
import { fillUsernames, wireReveal } from '/js/password-reveal.js?v=37f218b4';
import { ensureSprite, iconSvg } from '/js/icon-set.js?v=b7e5d7d1';

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
  ensureSprite();
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
      ${screenText.setup ? setupForm(screenText.setupHelp) : ''}
      <div class="cfg-recovery-more"></div>
      <button class="cfg-recovery-btn${screenText.setup ? ' cfg-recovery-btn-secondary' : ''}" type="button">${t('configRecovery.checkAgain')}</button>
      <p class="cfg-recovery-status" role="status"></p>
      <p class="cfg-recovery-help"></p>
    </div>`,
  );
  const body = /** @type {HTMLElement} */ (screen.querySelector('.cfg-recovery-body'));
  const more = /** @type {HTMLElement} */ (screen.querySelector('.cfg-recovery-more'));
  const btn = /** @type {HTMLButtonElement} */ (screen.querySelector('.cfg-recovery-card > .cfg-recovery-btn'));
  const status = /** @type {HTMLElement} */ (screen.querySelector('.cfg-recovery-card > .cfg-recovery-status'));
  const help = /** @type {HTMLElement} */ (screen.querySelector('.cfg-recovery-help'));
  render(body, more, help, screenText);
  const form = /** @type {HTMLFormElement | null} */ (screen.querySelector('.cfg-recovery-form'));
  if (form) {
    fillUsernames(form);
    const field = name => /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
    wireReveal(/** @type {HTMLButtonElement} */ (form.querySelector('.cfg-recovery-reveal')), [
      field('password'),
      field('confirm'),
    ]);
    form.addEventListener('submit', e => submitSetup(e, form));
    form.addEventListener('input', e => clearInvalid(/** @type {HTMLInputElement} */ (e.target)));
  }
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = '';
    try {
      const res = await fetch('/api/auth/check', { cache: 'no-store' });
      const next = res.ok ? null : blockingScreenFor(await res.json().catch(() => null));
      if (!next || next.setup !== screenText.setup) {
        location.reload();
        return;
      }
      render(body, more, help, next);
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

/** @param {HTMLElement} body @param {HTMLElement} more @param {HTMLElement} help
    @param {NonNullable<ReturnType<typeof screenFor>>} s */
function render(body, more, help, s) {
  document.title = t(s.title);
  setHtml(
    body,
    html`<h1 class="cfg-recovery-title" tabindex="-1">${t(s.title)}</h1>
      <p class="cfg-recovery-why">${named(s.why.key, s.why.vars)}</p>
      <p class="cfg-recovery-safe">${t(s.safe)}</p>`,
  );
  setHtml(
    more,
    html`<h2 class="cfg-recovery-steps-title">${t(s.stepsTitle)}</h2>
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

/** @param {string} helpKey */
function setupForm(helpKey) {
  return html`<section class="cfg-recovery-setup" aria-labelledby="cfg-setup-title">
    <h2 id="cfg-setup-title" class="cfg-recovery-steps-title">${t('hostBlock.setupTitle')}</h2>
    <p id="cfg-setup-help" class="cfg-recovery-safe">${t(helpKey)}</p>
    <form class="cfg-recovery-form" method="post" novalidate>
      <input type="text" name="username" autocomplete="username" hidden>
      <label class="cfg-recovery-label">${t('hostBlock.code')}
        <input class="cfg-recovery-input cfg-recovery-code" name="code" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required aria-describedby="cfg-setup-help">
      </label>
      <div class="cfg-recovery-label">
        <label for="cfg-setup-password">${t('setup.newPassword')}</label>
        <span class="cfg-recovery-field">
          <input id="cfg-setup-password" class="cfg-recovery-input" name="password" type="password" autocomplete="new-password" required>
          <button type="button" class="cfg-recovery-reveal" aria-pressed="false" aria-label="${t('common.showPassword')}" title="${t('common.showPassword')}">${raw(iconSvg('eye', 18))}</button>
        </span>
      </div>
      <label class="cfg-recovery-label">${t('setup.confirmPassword')}
        <input class="cfg-recovery-input" name="confirm" type="password" autocomplete="new-password" required>
      </label>
      <p id="cfg-setup-error" class="cfg-recovery-status cfg-recovery-error" role="alert"></p>
      <button class="cfg-recovery-btn" type="submit">${t('setpw.submit')}</button>
    </form>
  </section>`;
}

/** @param {SubmitEvent} e @param {HTMLFormElement} form */
async function submitSetup(e, form) {
  e.preventDefault();
  const field = name => /** @type {HTMLInputElement} */ (form.elements.namedItem(name));
  const code = field('code');
  const password = field('password');
  const confirm = field('confirm');
  const error = /** @type {HTMLElement} */ (form.querySelector('.cfg-recovery-error'));
  const submit = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
  /** @param {string} key @param {HTMLInputElement} at */
  const refuse = (key, at) => {
    for (const f of [code, password, confirm]) clearInvalid(f);
    at.setAttribute('aria-invalid', 'true');
    at.setAttribute('aria-describedby', `${at.getAttribute('aria-describedby') || ''} cfg-setup-error`.trim());
    error.textContent = t(key);
    at.focus();
  };
  if (!code.value.trim()) return refuse('hostBlock.codeMissing', code);
  const problem = passwordProblem(password.value, contextWords(location.hostname));
  if (problem) return refuse(REFUSAL_KEYS[problem], password);
  if (passwordMismatch(password.value, confirm.value)) return refuse('setup.mismatch', confirm);
  submit.disabled = true;
  error.textContent = '';
  try {
    const res = await fetch('/api/auth/setup-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.value, password: password.value }),
    });
    if (res.ok || res.status === 409) {
      location.reload();
      return;
    }
    const key = setupCodeErrorKey(await res.json().catch(() => null));
    refuse(key, key === 'hostBlock.codeWrong' ? code : password);
  } catch {
    error.textContent = t('home.apiDownTitle');
  } finally {
    submit.disabled = false;
  }
}

/** @param {HTMLInputElement} field */
function clearInvalid(field) {
  if (!field.hasAttribute('aria-invalid')) return;
  field.removeAttribute('aria-invalid');
  const rest = (field.getAttribute('aria-describedby') || '').replace('cfg-setup-error', '').trim();
  if (rest) field.setAttribute('aria-describedby', rest);
  else field.removeAttribute('aria-describedby');
}
