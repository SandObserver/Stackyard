import { apiGet, apiPost } from '/js/admin-shared.js?v=81ab2f92';
import { initI18n, t } from '/js/i18n.js?v=5579776a';
import { loginErrorKey } from '/js/admin-error.js?v=61f73e4d';
import { pwStrength } from '/js/password-strength.js?v=389e0ed0';
import { el, inp as inpById, qa } from '/js/utils.js?v=fdc0243f';
import { blockingScreenFor } from '/js/config-recovery.js?v=dbe542e1';

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
    is back in. A fixed overlay, so a half-filled editor underneath survives.

    @returns {Promise<boolean>} */
export function requireLogin() {
  return new Promise(resolve => {
    showLoginScreen(() => resolve(true));
  });
}

/** @type {Element[]} */
let madeInert = [];
/** @type {HTMLElement|null} */
let focusBefore = null;

/** @param {HTMLElement|null} screen */
function blockPageBehind(screen) {
  if (madeInert.length) return;
  focusBefore = /** @type {HTMLElement|null} */ (document.activeElement);
  madeInert = [...document.body.children].filter(c => c !== screen && !c.hasAttribute('inert'));
  madeInert.forEach(c => c.setAttribute('inert', ''));
}

function unblockPageBehind() {
  madeInert.forEach(c => c.removeAttribute('inert'));
  madeInert = [];
  if (focusBefore?.isConnected && focusBefore !== document.body) focusBefore.focus();
  focusBefore = null;
}

function showLoginScreen(onLogin) {
  const s = el('login-screen');
  const btn = inpById('login-btn');
  const pw = inpById('login-pw');
  const err = el('login-err');
  if (s) s.style.display = 'flex';
  blockPageBehind(s);

  async function doLogin() {
    if (btn) btn.disabled = true;
    if (err) err.style.display = 'none';
    try {
      await apiPost('/api/auth/login', { password: pw?.value || '' });
      if (s) s.style.display = 'none';
      unblockPageBehind();
      onLogin?.();
    } catch (e) {
      if (err) {
        err.textContent = t(loginErrorKey(e));
        err.style.display = 'block';
      }
      if (pw) {
        pw.value = '';
        pw.focus();
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  if (btn) btn.onclick = doLogin;
  if (pw) {
    pw.focus();
    pw.onkeydown = e => {
      if (e.key === 'Enter') doLogin();
    };
  }
}

export function wirePasswordStrength(inputId, barsId, hintId) {
  const inp = inpById(inputId);
  const bars = qa('.pwbar', el(barsId));
  const hint = el(hintId);
  if (!inp || !bars?.length) return;
  inp.addEventListener('input', () => {
    const { score, labelKey, color } = pwStrength(inp.value);
    bars.forEach((b, i) => {
      b.style.background = inp.value && i < score ? color : '';
    });
    if (hint) {
      hint.textContent = inp.value && labelKey ? t(labelKey) : '';
    }
  });
}
