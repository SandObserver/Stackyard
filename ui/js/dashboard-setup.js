import { setupErrorKey } from '/js/admin-error.js?v=5abd7438';
import { landingAfterSetup } from '/js/dashboard-logic.js?v=b4828b62';
import { html, raw, setHtml } from '/js/html.js?v=48f9dc21';
import { t } from '/js/i18n.js?v=82ba9da2';
import { iconSvg } from '/js/icon-set.js?v=beda3062';
import {
  contextWords,
  meterColor,
  passwordMeter,
  passwordMismatch,
  passwordProblem,
  REFUSAL_KEYS,
} from '/js/password-policy.js?v=e16ebd1a';
import { fillUsernames, wireReveal } from '/js/password-reveal.js?v=bdd477f5';
import { q, qa, qi, setLiveText } from '/js/utils.js?v=457d9918';

/** @param {import('/js/dashboard-state.js?v=51013727').DashboardState} dash
    @returns {Promise<void>} */
export function showSetupPrompt(dash) {
  return new Promise(resolve => {
    const ov = /** @type {HTMLDialogElement} */ (document.createElement('dialog'));
    ov.className = 'setup-prompt';
    ov.setAttribute('aria-labelledby', 'setup-title');
    ov.setAttribute('closedby', 'none');
    setHtml(
      ov,
      html`<form class="setup-card" method="post" novalidate><input type="text" name="username" autocomplete="username" hidden><p id="setup-title" class="setup-title">${t('setup.title')}</p><p class="setup-sub">${t('setup.sub')}</p><div class="setup-group"><label for="setup-pw" class="setup-label">${t('setup.newPassword')}</label><div class="setup-field"><input id="setup-pw" name="password" type="password" required aria-describedby="setup-hint" autocomplete="new-password" class="setup-pw"><button id="setup-reveal" type="button" class="setup-reveal" aria-pressed="false" aria-label="${t('common.showPassword')}" title="${t('common.showPassword')}">${raw(iconSvg('eye', 18))}</button></div></div><div class="setup-group"><label for="setup-pw2" class="setup-label">${t('setup.confirmPassword')}</label><input id="setup-pw2" name="confirm" type="password" required autocomplete="new-password" class="setup-pw"></div><div class="setup-group"><label for="setup-code" class="setup-label">${t('hostBlock.code')}</label><input id="setup-code" name="code" type="text" required aria-describedby="setup-code-help" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" class="setup-pw"></div><p id="setup-code-help" class="setup-hint">${t('hostBlock.setupHelp')}</p><div id="setup-bars" class="setup-bars" aria-hidden="true"><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span></div><div id="setup-hint" class="setup-hint"></div><p id="setup-live" class="visually-hidden" aria-live="polite"></p><div id="setup-err" class="setup-err" role="alert"></div><div class="setup-btns"><button id="setup-skip" type="button" class="setup-btn setup-btn-skip">${t('setup.skip')}</button><button id="setup-set" type="submit" class="setup-btn setup-btn-set">${t('setup.set')}</button></div></form>`,
    );
    const pw = qi('#setup-pw', ov);
    const pw2 = qi('#setup-pw2', ov);
    const code = qi('#setup-code', ov);
    const fields = [pw, pw2, code];
    const rev = /** @type {HTMLButtonElement} */ (q('#setup-reveal', ov));
    const bars = qa('.pwbar', ov);
    const hint = q('#setup-hint', ov);
    const live = q('#setup-live', ov);
    const err = q('#setup-err', ov);
    const setB = qi('#setup-set', ov);
    const skip = qi('#setup-skip', ov);
    let done = false;

    const words = contextWords(location.hostname);
    let band = passwordMeter('', words).key;
    const paintMeter = () => {
      const { lit, tone, key, vars } = passwordMeter(pw.value, words);
      bars.forEach((b, i) => {
        b.style.background = i < lit ? meterColor(tone) : '';
      });
      const text = t(key, vars);
      hint.textContent = text;
      if (key !== band) {
        band = key;
        setLiveText(live, text);
      }
    };

    /** @param {HTMLInputElement} f */
    const unmark = f => {
      if (!f.hasAttribute('aria-invalid')) return;
      f.removeAttribute('aria-invalid');
      const rest = (f.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter(id => id && id !== 'setup-err')
        .join(' ');
      if (rest) f.setAttribute('aria-describedby', rest);
      else f.removeAttribute('aria-describedby');
    };
    /** @type {string | null} */
    let shownKey = null;
    const hideError = () => {
      shownKey = null;
      err.style.display = 'none';
    };
    /** @param {string} key @param {HTMLInputElement | null} at */
    const showError = (key, at) => {
      for (const f of fields) unmark(f);
      shownKey = key;
      setLiveText(err, t(key));
      err.style.display = 'block';
      if (!at) return;
      at.setAttribute('aria-invalid', 'true');
      at.setAttribute('aria-describedby', `${at.getAttribute('aria-describedby') || ''} setup-err`.trim());
    };

    /* A typo here locks the dashboard with no way back in. */
    /** @returns {[string, HTMLInputElement] | null} */
    const firstProblem = () => {
      const problem = passwordProblem(pw.value, words);
      if (problem) return [REFUSAL_KEYS[problem], pw];
      if (passwordMismatch(pw.value, pw2.value)) return ['setup.mismatch', pw2];
      if (!code.value.trim()) return ['hostBlock.codeMissing', code];
      return null;
    };

    const mismatched = () => pw2.value !== '' && passwordMismatch(pw.value, pw2.value);
    const clearMatched = () => {
      if (shownKey !== 'setup.mismatch' || mismatched()) return;
      unmark(pw2);
      hideError();
    };
    pw.addEventListener('input', paintMeter);
    for (const f of fields) {
      f.addEventListener('input', () => {
        if (!f.hasAttribute('aria-invalid')) return;
        unmark(f);
        hideError();
      });
    }
    for (const f of [pw, pw2]) {
      f.addEventListener('input', clearMatched);
      f.addEventListener('blur', () => {
        if (shownKey === null && mismatched()) showError('setup.mismatch', pw2);
      });
    }

    wireReveal(rev, [pw, pw2]);
    fillUsernames(ov);

    paintMeter();
    document.body.appendChild(ov);
    const open = () => {
      ov.showModal();
      pw.focus();
    };
    open();
    /* Escape must not dismiss this: there is nothing usable behind it, and Skip
       is the deliberate way past. */
    ov.addEventListener('cancel', e => e.preventDefault());
    /* Keep. A browser closes a modal on repeated Escape even when cancel is
       prevented, which leaves the dashboard without the prompt. */
    ov.addEventListener('close', () => {
      if (!done && ov.isConnected) {
        open();
        return;
      }
      ov.remove();
      resolve();
    });

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
      done = true;
      ov.close();
    };

    /** @param {HTMLElement | null} from */
    async function doSet(from) {
      setB.disabled = true;
      skip.disabled = true;
      for (const f of fields) unmark(f);
      hideError();
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
        const refusals = /** @type {string[]} */ (Object.values(REFUSAL_KEYS));
        const at = key === 'hostBlock.codeWrong' ? code : refusals.includes(key) ? pw : null;
        setB.disabled = false;
        skip.disabled = false;
        showError(key, at);
        (at ?? (from?.isConnected ? from : setB)).focus();
      }
    }
    q('form', ov).addEventListener('submit', e => {
      e.preventDefault();
      if (setB.disabled) return;
      const problem = firstProblem();
      if (problem) {
        const [key, at] = problem;
        showError(key, at);
        at.focus();
        return;
      }
      doSet(/** @type {HTMLElement | null} */ (document.activeElement));
    });
  });
}
