import { apiGet, apiPost } from '/js/admin-shared.js?v=495be496';
import { initI18n, t } from '/js/i18n.js?v=99563c71';
import { loginErrorAdvice } from '/js/admin-error.js?v=5abd7438';
import { passwordMeter, contextWords, meterColor } from '/js/password-policy.js?v=e16ebd1a';
import { el, inp as inpById, qa } from '/js/utils.js?v=c1d4e76c';
import { blockingScreenFor, showBlockingScreen } from '/js/config-recovery.js?v=da14e1c7';
import { fillUsernames } from '/js/password-reveal.js?v=37f218b4';

export async function checkAuth(onLogin) {
  try {
    const d = await apiGet('/api/auth/check');
    if (!d.enabled || d.authenticated) return true;
    await initI18n(d.language || 'en');
    document.title = t('nav.pageTitle');
    showLoginScreen(onLogin);
    return false;
  } catch (e) {
    if (e.status === 401) {
      showLoginScreen(onLogin);
      return false;
    }
    return !blockingScreenFor(e);
  }
}

/** Show the sign-in box over whatever is on screen, and resolve once the person
    is back in. A modal dialog, so it stacks above an open dialog and a
    half-filled editor underneath survives.

    @returns {Promise<boolean>} */
export function requireLogin() {
  return new Promise(resolve => {
    showLoginScreen(() => resolve(true));
  });
}

/** @type {HTMLElement|null} */
let focusBefore = null;

function showLoginScreen(onLogin) {
  const s = /** @type {HTMLDialogElement|null} */ (el('login-screen'));
  const btn = inpById('login-btn');
  const pw = inpById('login-pw');
  const err = el('login-err');
  let signedIn = false;
  if (s) {
    s.oncancel = e => e.preventDefault();
    /* Keep. A browser closes a modal on repeated Escape even when cancel is
       prevented, which leaves the page without a way to sign in. */
    s.onclose = () => {
      if (signedIn || !s.isConnected) return;
      s.showModal();
      pw?.focus();
    };
    if (!s.open) {
      focusBefore = /** @type {HTMLElement|null} */ (document.activeElement);
      s.showModal();
    }
  }

  function clearError() {
    if (err) err.style.display = 'none';
    pw?.removeAttribute('aria-invalid');
    pw?.removeAttribute('aria-describedby');
  }

  /** @param {{ key: string, vars?: Record<string, unknown> }} advice @param {boolean} invalid */
  function showError(advice, invalid) {
    if (!err) return;
    err.textContent = t(advice.key, advice.vars);
    err.style.display = 'block';
    if (invalid) pw?.setAttribute('aria-invalid', 'true');
    pw?.setAttribute('aria-describedby', 'login-err');
  }

  async function doLogin() {
    if (btn) btn.disabled = true;
    try {
      await apiPost('/api/auth/login', { password: pw?.value || '' });
      signedIn = true;
      if (pw) pw.value = '';
      s?.close();
      if (focusBefore?.isConnected && focusBefore !== document.body) focusBefore.focus();
      focusBefore = null;
      onLogin?.();
    } catch (e) {
      const screen = blockingScreenFor(e);
      if (screen) {
        signedIn = true;
        s?.close();
        await showBlockingScreen(screen);
        return;
      }
      const advice = loginErrorAdvice(e);
      showError(advice, advice.key === 'login.incorrect');
      if (pw) {
        pw.value = '';
        pw.focus();
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  const form = /** @type {HTMLFormElement|null} */ (el('login-form'));
  if (form) {
    fillUsernames(form);
    form.onsubmit = e => {
      e.preventDefault();
      if (btn?.disabled) return;
      clearError();
      if (pw?.validity.valueMissing) {
        showError({ key: 'login.empty' }, true);
        pw.focus();
        return;
      }
      doLogin();
    };
  }
  pw?.focus();
}

export function wirePasswordStrength(inputId, barsId, hintId) {
  const inp = inpById(inputId);
  const bars = qa('.pwbar', el(barsId));
  const hint = el(hintId);
  if (!inp || !bars?.length) return;
  const words = contextWords(location.hostname);
  const paint = () => {
    const { lit, tone, key, vars } = passwordMeter(inp.value, words);
    bars.forEach((b, i) => {
      b.style.background = i < lit ? meterColor(tone) : '';
    });
    if (hint) hint.textContent = t(key, vars);
  };
  inp.addEventListener('input', paint);
  paint();
}
