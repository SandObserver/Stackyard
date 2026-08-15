import { toast, ag, ap } from '/js/admin-shared.js?v=bb36dbb3';
import { pwStrength } from '/js/password-strength.js?v=dab9978e';
import { t } from '/js/i18n.js?v=133a7aac';
import { shouldWritePassword, settingsSaveBlocker, clearsStoredPassword, BLOCK } from '/js/admin-logic.js?v=3c60f7b0';
import { el, inp, q, qa, setUserText } from '/js/utils.js?v=84d58686';

/* Mirrors the server's rule: auth cannot be switched on with no password. */
let _passwordSet = false;

/* Hint codes from the socket proxy probe. The server picks the code from the
   address shape; the wording lives here so it is translated. */
const SOCKET_HINTS = Object.freeze({
  'shared-network': 'toast.socketHintSharedNetwork',
  'publish-port': 'toast.socketHintPublishPort',
});

/* Both controls only mean anything while auth is on. Revoke also needs a stored
   password, which is what makes a session possible. */
function syncSessionRows() {
  const on = !!inp('sec-en')?.checked;
  el('sec-logout')?.classList.toggle('d-none', !on);
  const canRevoke = on && _passwordSet;
  el('sec-revoke-row')?.classList.toggle('d-none', !canRevoke);
  const revokeTip = el('revoke-tip');
  if (revokeTip) revokeTip.style.display = canRevoke ? '' : 'none';
}

export function loadSettings(c) {
  const s = c.settings || {};
  const ld = inp('set-lbl-d');
  const lm = inp('set-lbl-m');
  if (ld) {
    ld.checked = s.showLabels?.desktop !== false;
    ld.addEventListener('change', saveLabels);
  }
  if (lm) {
    lm.checked = s.showLabels?.ios === true;
    lm.addEventListener('change', saveLabels);
  }
  const aw = inp('set-awake');
  if (aw) {
    aw.checked = s.keepAwake === true;
    aw.addEventListener('change', saveKeepAwake);
  }
  const bg = s.background || { type: 'unsplash', brightness: 0.62 };
  const typeEl = inp('bg-type');
  if (typeEl) {
    typeEl.value = bg.type || 'unsplash';
    showBgFields(bg.type || 'unsplash');
    const btn = el('bg-type-btn');
    const labels = { unsplash: 'Unsplash', url: 'Image URL', color: 'Solid color' };
    if (btn) {
      const tn = btn.childNodes[0];
      if (tn && tn.nodeType === 3) tn.textContent = labels[typeEl.value] || typeEl.value;
    }
    qa('#bg-type-list li', document).forEach(li =>
      li.setAttribute('aria-selected', String(li.dataset.val === typeEl.value)),
    );
  }
  const llEl = inp('log-level');
  if (llEl) {
    llEl.value = s.logLevel || 'info';
    const llBtn = el('log-level-btn');
    const llLabels = { debug: 'Debug', info: 'Info', error: 'Errors' };
    if (llBtn) {
      const tn = llBtn.childNodes[0];
      if (tn && tn.nodeType === 3) tn.textContent = llLabels[llEl.value] || llEl.value;
    }
    qa('#log-level-list li', document).forEach(li =>
      li.setAttribute('aria-selected', String(li.dataset.val === llEl.value)),
    );
  }
  const langEl = inp('lang-sel');
  if (langEl) {
    langEl.value = s.language || 'en';
    const laBtn = el('lang-btn');
    const laLi = q(`#lang-list li[data-val="${langEl.value}"]`);
    if (laBtn) {
      const tn = laBtn.childNodes[0];
      if (tn && tn.nodeType === 3) tn.textContent = laLi ? laLi.textContent : langEl.value;
    }
    qa('#lang-list li', document).forEach(li =>
      li.setAttribute('aria-selected', String(li.dataset.val === langEl.value)),
    );
  }
  /* The key itself is never included in /api/config. */
  const apiEl = inp('bg-apikey-inp') || inp('bg-apikey');
  if (apiEl) {
    apiEl.placeholder = '●●●●●●●●●● (configured)';
    ag('/api/settings/unsplash-key')
      .then(d => {
        const vEl = el('ie-apikey-v');
        if (!d.configured) {
          apiEl.placeholder = 'Paste your Unsplash API key';
          if (vEl) vEl.textContent = t('common.notSet');
        } else {
          if (vEl) vEl.textContent = t('common.configured');
        }
      })
      .catch(() => {});
  }
  const colEl = inp('bg-col');
  if (colEl) colEl.value = bg.collection || '';
  const urlEl = inp('bg-url');
  if (urlEl) urlEl.value = bg.url || '';
  const colorEl = inp('bg-color');
  if (colorEl) colorEl.value = bg.color || '';
  const brEl = inp('bg-br');
  const brVal = el('bg-br-val');
  function updateSliderFill(el) {
    if (!el) return;
    const min = parseFloat(el.min) || 0.1,
      max = parseFloat(el.max) || 1.0;
    const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
    /* backgroundImage, never the background shorthand. The shorthand resets
       background-clip, which is what keeps the track thin inside the 44px touch
       target on a phone. */
    el.style.backgroundImage = `linear-gradient(to right, var(--ac) 0%, var(--ac) ${pct}%, var(--bd-inner) ${pct}%, var(--bd-inner) 100%)`;
  }
  if (brEl) {
    brEl.value = bg.brightness ?? 0.62;
    if (brVal) brVal.textContent = parseFloat(brEl.value).toFixed(2);
    updateSliderFill(brEl);
    brEl.addEventListener('input', () => {
      updateSliderFill(brEl);
      if (brVal) brVal.textContent = parseFloat(brEl.value).toFixed(2);
    });
  }
  el('bg-save').addEventListener('click', saveWallpaper);

  const _sv = (id, v, ph = '') => {
    const node = el(id);
    if (!node) return;
    if (v) {
      setUserText(node, v);
      node.classList.remove('is-ph');
    } else {
      setUserText(node, ph);
      node.classList.add('is-ph');
    }
  };
  _sv('ie-title-v', s.title || 'Stackyard', 'Stackyard');
  _sv(
    'ie-desc-v',
    s.description || 'Stackyard · self-hosted homelab dashboard',
    'Stackyard · self-hosted homelab dashboard',
  );
  _sv('ie-ip-v', s.server?.hostIp, '192.168.1.100');
  _sv('ie-socket-v', s.server?.socketProxyUrl, 'http://socket-proxy:2375');
  _sv('ie-pw-v', '', t('common.notSet')); /* set below after auth check */
  const _si = (id, v) => {
    const node = inp(id);
    if (node && v != null) node.value = v;
  };
  _si('srv-ip', s.server?.hostIp || '');
  _si('srv-socket', s.server?.socketProxyUrl || '');
  _sv('ie-bgcol-v', s.background?.collection, 'Collection ID');
  _si('bg-col-inp', s.background?.collection || '');
  _si('bg-url-inp', s.background?.url || '');
  _si('bg-color-inp', s.background?.color || '');
  _sv('ie-bgurl-v', s.background?.url, 'Image URL');
  _sv('ie-bgcolor-v', s.background?.color, '#rrggbb or any CSS color');

  const ipEl = inp('srv-ip');
  if (ipEl) ipEl.value = s.server?.hostIp || '';
  const dockerEnEl = inp('srv-docker-en');
  const dockerSubEl = el('srv-docker-sub');
  const socketEl = inp('srv-socket');
  const hideHealthyRowEl = el('srv-hide-healthy-row');
  const hideHealthyEl = inp('srv-hide-healthy');
  if (dockerEnEl) {
    dockerEnEl.checked = !!s.server?.socketProxyUrl;
    const applyDocker = v => {
      if (dockerSubEl) dockerSubEl.classList.toggle('open', v);
      if (hideHealthyRowEl) hideHealthyRowEl.classList.toggle('d-none', !v);
      const socketRow = el('ie-socket');
      if (socketRow) socketRow.classList.toggle('d-none', !v);
      const socketHint = el('socket-hint');
      if (socketHint) socketHint.style.display = v ? '' : 'none';
    };
    applyDocker(dockerEnEl.checked);
    dockerEnEl.addEventListener('change', () => applyDocker(dockerEnEl.checked));
  }
  if (hideHealthyEl) hideHealthyEl.checked = s.server?.hideHealthyBadge !== false;
  if (socketEl) socketEl.value = s.server?.socketProxyUrl || '';
  el('srv-save').addEventListener('click', saveServer);

  const secEnEl = inp('sec-en');
  const secLogout = el('sec-logout');
  const secRevoke = inp('sec-revoke');
  secLogout?.addEventListener('click', async () => {
    await ap('/api/auth/logout', {}).catch(() => {});
    location.reload();
  });
  secRevoke?.addEventListener('click', async () => {
    if (!confirm(t('confirm.revokeSessions'))) return;
    secRevoke.disabled = true;
    try {
      await ap('/api/auth/revoke-sessions', {});
      toast(t('toast.sessionsRevoked'), 'ok');
    } catch (e) {
      toast(e.message || t('toast.saveFailed'), 'err');
    } finally {
      secRevoke.disabled = false;
    }
  });
  secEnEl?.addEventListener('change', syncSessionRows);

  syncAuthFromServer();
}

async function syncAuthFromServer() {
  let d;
  try {
    d = await ag('/api/auth/check');
  } catch {
    return;
  }
  _passwordSet = !!d.passwordSet;
  const secEnEl = inp('sec-en');
  if (secEnEl) {
    /* The effective state. Enabled with no password behaves as off. */
    secEnEl.checked = !!d.enabled;
    const pwRow = el('ie-pw');
    const pwHint = el('pw-hint-static');
    if (pwRow) pwRow.classList.toggle('d-none', !d.enabled);
    if (pwHint) pwHint.style.display = d.enabled ? '' : 'none';
  }
  const pwValEl = el('ie-pw-v');
  if (pwValEl) pwValEl.textContent = d.passwordSet ? t('common.configured') : t('common.notSet');
  syncSessionRows();
}
export function showBgFields(type) {
  ['unsplash', 'url', 'color'].forEach(t => {
    const node = el(`bg-${t}-fields`);
    if (node) node.classList.toggle('d-none', t !== type);
  });
  const brRow = el('bg-brightness-row');
  if (brRow) brRow.classList.toggle('d-none', type === 'color');
}
/** @param {Event} [e] */
async function saveLabels(e) {
  const toggled = /** @type {HTMLInputElement|null} */ (e?.target ?? null);
  const wasChecked = toggled ? toggled.checked : false;
  try {
    const c = await ag('/api/config');
    c.settings = c.settings || {};
    c.settings.showLabels = { desktop: inp('set-lbl-d')?.checked !== false, ios: inp('set-lbl-m')?.checked || false };
    await ap('/api/config', c);
    toast(t('toast.saved'));
  } catch (err) {
    /* Put the box back on a failure, or it shows a setting the server was never
       given. Assigning `checked` fires no event, so this does not loop. */
    if (toggled) toggled.checked = !wasChecked;
    toast(t('toast.saveFailed', { err: err.message }), 'err');
  }
}
async function saveKeepAwake(e) {
  const toggled = /** @type {HTMLInputElement|null} */ (e?.target ?? null);
  const wasChecked = toggled ? toggled.checked : false;
  try {
    const c = await ag('/api/config');
    c.settings = c.settings || {};
    c.settings.keepAwake = !!inp('set-awake')?.checked;
    await ap('/api/config', c);
    toast(t('toast.saved'));
  } catch (err) {
    /* Put the box back on a failure, or it shows a setting the server was never
       given. Assigning `checked` fires no event, so this does not loop. */
    if (toggled) toggled.checked = !wasChecked;
    toast(t('toast.saveFailed', { err: err.message }), 'err');
  }
}
async function saveWallpaper() {
  try {
    const type = inp('bg-type')?.value || 'unsplash';
    const br = parseFloat(inp('bg-br')?.value || '0.62');
    const bg = { type, brightness: br };
    if (type === 'unsplash') {
      bg.collection = (inp('bg-col-inp') || inp('bg-col'))?.value?.trim() || '';
    } else if (type === 'url') {
      bg.url = (inp('bg-url-inp') || inp('bg-url'))?.value?.trim() || '';
    } else if (type === 'color') {
      bg.color = (inp('bg-color-inp') || inp('bg-color'))?.value?.trim() || '';
    }
    const c = await ag('/api/config');
    c.settings = c.settings || {};
    c.settings.background = bg;
    await ap('/api/config', c);
    /* After the main config. GET /api/config strips the key, so a config write
       that follows would overwrite it with nothing. */
    if (type === 'unsplash') {
      const keyVal = (inp('bg-apikey-inp') || inp('bg-apikey'))?.value?.trim() || '';
      if (keyVal) await ap('/api/settings/unsplash-key', { apiKey: keyVal });
    }
    toast(t('toast.wallpaperSaved'));
  } catch (e) {
    toast(t('toast.saveFailed', { err: e.message }), 'err');
  }
}
async function saveServer() {
  const pw = inp('sec-pw')?.value || '';
  const enabled = inp('sec-en')?.checked || false;
  let socketWarning = '';

  /* Ask every rule that can refuse this save before the first request. */
  const blocker = settingsSaveBlocker({
    enabled,
    passwordSet: _passwordSet,
    newPassword: pw,
    strength: pwStrength(pw),
  });
  if (blocker) {
    if (blocker.reason === BLOCK.NEEDS_PASSWORD) toast(t('toast.authNeedsPassword'), 'err');
    else toast(t('toast.pwWeak', { label: t(blocker.labelKey) }), 'err');
    return;
  }

  /* Asked with the other refusals, so a wrong address never reaches the
     config. */
  if (inp('srv-docker-en')?.checked) {
    const url = inp('srv-socket')?.value?.trim() || '';
    if (!url) {
      toast(t('toast.socketUrlMissing'), 'err');
      return;
    }
    let probe;
    try {
      probe = await ap('/api/docker/test', { url });
    } catch (e) {
      toast(t('toast.saveFailed', { err: e.message }), 'err');
      return;
    }
    /* The error and the hint are both needed: "connection refused" for an IP is
       exactly what a proxy published on the host's loopback looks like from
       inside a container. */
    const hint = SOCKET_HINTS[probe.hint] ? ` ${t(SOCKET_HINTS[probe.hint])}` : '';
    if (!probe.ok && probe.fatal) {
      toast(t('toast.socketUrlBad', { reason: probe.error }) + hint, 'err');
      return;
    }
    /* Not answering yet is not the same as wrong. A proxy still starting would
       otherwise block a save that is correct. */
    if (!probe.ok) socketWarning = t('toast.socketUrlUnverified', { reason: probe.error }) + hint;
  }

  /* Switching protection off deletes the stored password. Ask before anything
     is written. */
  if (clearsStoredPassword({ enabled, passwordSet: _passwordSet }) && !confirm(t('confirm.clearPassword'))) {
    await syncAuthFromServer();
    return;
  }

  try {
    const c = await ag('/api/config');
    c.settings = c.settings || {};
    const prevLang = c.settings.language || 'en';
    const dockerEnabled = inp('srv-docker-en')?.checked || false;
    const socketUrl = inp('srv-socket')?.value?.trim() || '';
    /* A greyed placeholder (.is-ph) means empty, so it is not saved. */
    const titleEl = el('ie-title-v');
    const descEl = el('ie-desc-v');
    const titleV = titleEl && !titleEl.classList.contains('is-ph') ? titleEl.textContent.trim() : '';
    const descV = descEl && !descEl.classList.contains('is-ph') ? descEl.textContent.trim() : '';
    if (titleV) c.settings.title = titleV;
    if (descV) c.settings.description = descV;
    c.settings.server = {
      ...c.settings.server,
      hostIp: inp('srv-ip')?.value?.trim() || '',
      socketProxyUrl: dockerEnabled ? socketUrl : '',
      hideHealthyBadge: inp('srv-hide-healthy')?.checked !== false,
    };
    c.settings.logLevel = inp('log-level')?.value || 'info';
    c.settings.language = inp('lang-sel')?.value || 'en';
    const langChanged = c.settings.language !== prevLang;

    await ap('/api/config', c);

    if (shouldWritePassword({ enabled, newPassword: pw })) {
      await ap('/api/auth/set-password', { password: pw });
      const pwEl = inp('sec-pw');
      if (pwEl) {
        pwEl.value = '';
        pwEl.placeholder = '●●●●●●●●●● (configured)';
      }
    }
    await ap('/api/auth/toggle', { enabled });
    if (!enabled) {
      const pwEl = inp('sec-pw');
      if (pwEl) {
        pwEl.placeholder = '';
        /* Whatever was typed was not stored. */
        pwEl.value = '';
      }
    }
    toast(socketWarning || t('toast.saved'), socketWarning ? 'err' : 'ok');
    if (langChanged) {
      location.reload();
      return;
    }
    /* Read back from the server, never inferred from what was asked for. */
    await syncAuthFromServer();
  } catch (e) {
    toast(t('toast.saveFailed', { err: e.message }), 'err');
    await syncAuthFromServer();
  }
}
