/* Admin UI: authentication.
   Login gate and password-strength meter. onLogin is injected by the caller
   (the main module's load()) so this module doesn't depend back on it. */
import { ag, ap } from '/js/admin-shared.js?v=2';
import { t } from '/js/i18n.js?v=1';
import { pwStrength } from '/js/password-strength.js?v=1';

export async function checkAuth(onLogin) {
  try {
    const d = await ag('/api/auth/check');
    if (!d.enabled || d.authenticated) return true;
    showLoginScreen(onLogin);
    return false;
  } catch(e) {
    /* 401 means auth is enabled and we're not logged in */
    if (e.status === 401) { showLoginScreen(onLogin); return false; }
    return true; /* any other error, let load() handle it */
  }
}

function showLoginScreen(onLogin) {
  const s   = document.getElementById('login-screen');
  const btn = document.getElementById('login-btn');
  const pw  = document.getElementById('login-pw');
  const err = document.getElementById('login-err');
  if (s) s.style.display = 'flex';

  async function doLogin() {
    if (btn) btn.disabled = true;
    if (err) err.style.display = 'none';
    try {
      await ap('/api/auth/login', { password: pw?.value||'' });
      if (s) s.style.display = 'none';
      onLogin?.();
    } catch(e) {
      if (err) { err.textContent = e.message||'Incorrect password.'; err.style.display = 'block'; }
      if (pw) { pw.value = ''; pw.focus(); }
    } finally { if (btn) btn.disabled = false; }
  }

  if (btn) btn.onclick = doLogin;
  if (pw) { pw.focus(); pw.onkeydown = e => { if (e.key === 'Enter') doLogin(); }; }
}

export function wirePasswordStrength(inputId, barsId, hintId) {
  const inp  = document.getElementById(inputId);
  const bars = document.getElementById(barsId)?.querySelectorAll('.pwbar');
  const hint = document.getElementById(hintId);
  if (!inp || !bars?.length) return;
  const dim = 'rgba(255,255,255,.1)';
  inp.addEventListener('input', () => {
    const { score, labelKey, color } = pwStrength(inp.value);
    bars.forEach((b, i) => { b.style.background = inp.value && i < score ? color : dim; });
    if (hint) { hint.textContent = inp.value && labelKey ? t(labelKey) : ''; hint.style.color = color; }
  });
}
