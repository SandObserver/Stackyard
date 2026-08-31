import { ag, ap } from '/js/admin-shared.js?v=78a4fff2';
import { t } from '/js/i18n.js?v=83239bf4';
import { pwStrength } from '/js/password-strength.js?v=42f45ac7';
import { el, inp as inpById, qa } from '/js/utils.js?v=d7db702a';

export async function checkAuth(onLogin) {
  try {
    const d = await ag('/api/auth/check');
    if (!d.enabled || d.authenticated) return true;
    showLoginScreen(onLogin);
    return false;
  } catch (e) {
    if (e.status === 401) {
      showLoginScreen(onLogin);
      return false;
    }
    return true;
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

function showLoginScreen(onLogin) {
  const s = el('login-screen');
  const btn = inpById('login-btn');
  const pw = inpById('login-pw');
  const err = el('login-err');
  if (s) s.style.display = 'flex';

  async function doLogin() {
    if (btn) btn.disabled = true;
    if (err) err.style.display = 'none';
    try {
      await ap('/api/auth/login', { password: pw?.value || '' });
      if (s) s.style.display = 'none';
      onLogin?.();
    } catch (e) {
      if (err) {
        err.textContent = e.message || t('login.incorrect');
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
  const dim = 'rgba(255,255,255,.1)';
  inp.addEventListener('input', () => {
    const { score, labelKey, color } = pwStrength(inp.value);
    bars.forEach((b, i) => {
      b.style.background = inp.value && i < score ? color : dim;
    });
    if (hint) {
      hint.textContent = inp.value && labelKey ? t(labelKey) : '';
      hint.style.color = color;
    }
  });
}
