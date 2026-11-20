import { setupErrorKey } from '/js/admin-error.js?v=5abd7438';
import { landingAfterSetup } from '/js/dashboard-logic.js?v=b4828b62';
import { html, raw, setHtml } from '/js/html.js?v=c71f8903';
import { t } from '/js/i18n.js?v=99563c71';
import { iconSvg } from '/js/icon-set.js?v=361e54a5';
import { contextWords, meterColor, passwordMeter, passwordMismatch } from '/js/password-policy.js?v=e16ebd1a';
import { fillUsernames, wireReveal } from '/js/password-reveal.js?v=37f218b4';
import { q, qa, qi } from '/js/utils.js?v=9ed2b298';

/** @param {import('/js/dashboard-state.js?v=51013727').DashboardState} dash
    @returns {Promise<void>} */
export function showSetupPrompt(dash) {
  return new Promise(resolve => {
    const ov = /** @type {HTMLDialogElement} */ (document.createElement('dialog'));
    ov.className = 'setup-prompt';
    ov.setAttribute('aria-labelledby', 'setup-title');
    setHtml(
      ov,
      html`<form class="setup-card" method="post" novalidate><input type="text" name="username" autocomplete="username" hidden><p id="setup-title" class="setup-title">${t('setup.title')}</p><p class="setup-sub">${t('setup.sub')}</p><div class="setup-field"><input id="setup-pw" type="password" placeholder="${t('setup.newPassword')}" aria-label="${t('setup.newPassword')}" aria-describedby="setup-hint" autocomplete="new-password" class="setup-pw"><button id="setup-reveal" type="button" class="setup-reveal" aria-pressed="false" aria-label="${t('common.showPassword')}" title="${t('common.showPassword')}">${raw(iconSvg('eye', 18))}</button></div><input id="setup-pw2" type="password" placeholder="${t('setup.confirmPassword')}" aria-label="${t('setup.confirmPassword')}" autocomplete="new-password" class="setup-pw"><input id="setup-code" type="text" placeholder="${t('hostBlock.code')}" aria-label="${t('hostBlock.code')}" aria-describedby="setup-code-help" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" class="setup-pw"><p id="setup-code-help" class="setup-hint">${t('hostBlock.setupHelp')}</p><div id="setup-bars" class="setup-bars" aria-hidden="true"><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span></div><div id="setup-hint" class="setup-hint" role="status"></div><div id="setup-err" class="setup-err" role="alert"></div><div class="setup-btns"><button id="setup-skip" type="button" class="setup-btn setup-btn-skip">${t('setup.skip')}</button><button id="setup-set" type="submit" class="setup-btn setup-btn-set" disabled>${t('setup.set')}</button></div></form>`,
    );
    const pw = qi('#setup-pw', ov);
    const pw2 = qi('#setup-pw2', ov);
    const code = qi('#setup-code', ov);
    const rev = /** @type {HTMLButtonElement} */ (q('#setup-reveal', ov));
    const bars = qa('.pwbar', ov);
    const hint = q('#setup-hint', ov);
    const err = q('#setup-err', ov);
    const setB = qi('#setup-set', ov);
    const skip = qi('#setup-skip', ov);

    /* A typo here locks the dashboard with no way back in. */
    const matches = () => pw2.value !== '' && !passwordMismatch(pw.value, pw2.value);
    const words = contextWords(location.hostname);
    const sync = () => {
      const { lit, tone, key, vars, ok } = passwordMeter(pw.value, words);
      bars.forEach((b, i) => {
        b.style.background = i < lit ? meterColor(tone) : '';
      });
      hint.textContent = t(key, vars);
      const mismatch = pw2.value !== '' && passwordMismatch(pw.value, pw2.value);
      err.textContent = mismatch ? t('setup.mismatch') : '';
      err.style.display = mismatch ? 'block' : 'none';
      setB.disabled = !ok || !matches() || !code.value.trim();
    };
    pw.addEventListener('input', sync);
    pw2.addEventListener('input', sync);
    code.addEventListener('input', sync);

    wireReveal(rev, [pw, pw2]);
    fillUsernames(ov);

    sync();
    document.body.appendChild(ov);
    ov.showModal();
    pw.focus();
    /* Escape must not dismiss this: there is nothing usable behind it, and Skip
       is the deliberate way past. */
    ov.addEventListener('cancel', e => e.preventDefault());
    ov.addEventListener('close', () => {
      ov.remove();
      resolve();
    });
    const close = () => ov.close();

    skip.onclick = async () => {
      skip.disabled = true;
      try {
        await fetch('/api/auth/dismiss-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      } catch {}
      const to = landingAfterSetup(dash.items);
      if (to) {
        location.href = to;
        return;
      }
      close();
    };

    async function doSet() {
      if (!passwordMeter(pw.value, words).ok || !matches() || !code.value.trim()) return;
      setB.disabled = true;
      skip.disabled = true;
      err.style.display = 'none';
      try {
        const r = await fetch('/api/auth/set-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw.value, code: code.value }),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw Object.assign(new Error(`HTTP ${r.status}`), { kind: body?.kind, code: body?.code });
        }
        const to = landingAfterSetup(dash.items);
        if (to) location.href = to;
        else location.reload();
      } catch (e) {
        const key = setupErrorKey(e);
        err.textContent = t(key);
        err.style.display = 'block';
        setB.disabled = false;
        skip.disabled = false;
        if (key === 'hostBlock.codeWrong') code.focus();
      }
    }
    q('form', ov).addEventListener('submit', e => {
      e.preventDefault();
      if (!setB.disabled) doSet();
    });
    pw.focus();
  });
}
