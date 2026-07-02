/* Admin UI — authentication.
   Login gate and password-strength meter. onLogin is injected by the caller
   (the main module's load()) so this module doesn't depend back on it. */
import { ag, ap } from '/js/admin-shared.js?v=2';

export async function checkAuth(onLogin) {
  try {
    const d = await ag('/api/auth/check');
    if (!d.enabled || d.authenticated) return true;
    showLoginScreen(onLogin);
    return false;
  } catch(e) {
    /* 401 means auth is enabled and we're not logged in */
    if (e.status === 401) { showLoginScreen(onLogin); return false; }
    return true; /* any other error — let load() handle it */
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

export function pwStrength(pw) {
  const dim = 'rgba(255,255,255,.1)';
  if (!pw) return { score:0, label:'', color:dim, ok:false };
  if (pw.length < 8) return { score:1, label:'Too short, min 8 characters', color:'#ff453a', ok:false };
  let score = 1; /* starts at 1 once length >= 8 */
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  score = Math.min(4, score - 1); /* 1..5 → 0..4 */
  const labels = ['Weak','Fair','Good','Strong'];
  const colors = ['#ff9f0a','#ffd60a','#34c759','#34c759'];
  return { score: score + 1, label: labels[score], color: colors[score], ok: score >= 1 };
}

export function wirePasswordStrength(inputId, barsId, hintId) {
  const inp  = document.getElementById(inputId);
  const bars = document.getElementById(barsId)?.querySelectorAll('.pwbar');
  const hint = document.getElementById(hintId);
  if (!inp || !bars?.length) return;
  const dim = 'rgba(255,255,255,.1)';
  inp.addEventListener('input', () => {
    const { score, label, color, ok } = pwStrength(inp.value);
    bars.forEach((b, i) => { b.style.background = inp.value && i < score ? color : dim; });
    if (hint) { hint.textContent = inp.value ? label : ''; hint.style.color = color; }
  });
}
