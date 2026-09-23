import { toast, apiGet, apiPost, reveal, swapContent } from '/js/admin-shared.js?v=e477e574';
import { pwStrength } from '/js/password-strength.js?v=42f45ac7';
import { t } from '/js/i18n.js?v=1f1ea9c1';
import {
  shouldWritePassword,
  settingsSaveBlocker,
  clearsStoredPassword,
  createDirtyTracker,
  BLOCK,
} from '/js/admin-logic.js?v=5356a1b3';
import { confirmText } from '/js/modal.js?v=11fa1eff';
import { el, inp, setUserText } from '/js/utils.js?v=01662438';
import { renderColorControl } from '/js/admin-color-control.js?v=ee39fb36';
import { BACKDROP } from '/js/background.js?v=09beead7';

/* Mirrors the server's rule: auth cannot be switched on with no password. */
let _passwordSet = false;
let _authEnabled = false;

/** @type {{ dirty: () => boolean, reset: (force?: boolean) => void } | null} */
let _srvTrack = null;
/** @type {{ dirty: () => boolean, reset: (force?: boolean) => void } | null} */
let _bgTrack = null;

const _val = (...ids) => {
  for (const id of ids) {
    const node = inp(id);
    if (node) return node.type === 'checkbox' ? String(node.checked) : node.value;
  }
  return '';
};
const _shown = id => {
  const node = el(id);
  return node && !node.classList.contains('is-ph') ? node.textContent : '';
};

/* Only what the header Save writes. The switches that save on change are left
   out. */
const readServerForm = () =>
  JSON.stringify([
    _val('srv-ip'),
    _val('srv-docker-en'),
    _val('srv-socket'),
    _val('srv-hide-healthy'),
    _val('log-level'),
    _val('lang-sel'),
    _val('sec-en'),
    _val('sec-pw'),
  ]);
const readWallpaperForm = () =>
  JSON.stringify([
    _val('bg-type'),
    _val('bg-br'),
    _val('bg-col-inp', 'bg-col'),
    _val('bg-url-inp', 'bg-url'),
    _val('bg-fit'),
    _val('bg-color-val'),
    _val('bg-apikey-inp', 'bg-apikey'),
  ]);

/** Disables `buttonId` while its section matches what was last saved. */
function trackSave(buttonId, read) {
  const btn = /** @type {HTMLButtonElement|null} */ (el(buttonId));
  const tr = createDirtyTracker(read);
  let touched = false;
  const sync = () => {
    if (btn) btn.disabled = !tr.dirty();
  };
  /* On the document, not the section: a picker's option list is attached to
     the body, and a choice made there must still enable Save. Deferred: pickers
     and inline editors update their value after the event. */
  for (const type of ['input', 'change', 'click', 'keyup', 'focusout'])
    document.addEventListener(type, () =>
      setTimeout(() => {
        if (tr.dirty()) touched = true;
        sync();
      }),
    );
  sync();
  return {
    dirty: tr.dirty,
    /* Do not re-baseline a touched form. The edit is swallowed and Save never
       lights again.
       @param {boolean} [force] */
    reset: (force = true) => {
      if (force || !touched) tr.reset();
      if (force) touched = false;
      sync();
    },
  };
}

/** Whether General or Appearance holds edits their Save has not written. */
export function settingsDirty() {
  return !!(_srvTrack?.dirty() || _bgTrack?.dirty());
}

/* Hint codes from the socket proxy probe. The server picks the code from the
   address shape; the wording lives here so it is translated. */
const SOCKET_HINTS = Object.freeze({
  'shared-network': 'toast.socketHintSharedNetwork',
  'publish-port': 'toast.socketHintPublishPort',
});

/* Both controls only mean anything while auth is on. Revoke also needs a stored
   password, which is what makes a session possible. */
function syncSessionRows(now = false) {
  const on = !!inp('sec-en')?.checked;
  el('sec-logout')?.classList.toggle('d-none', !on);
  const canRevoke = on && _passwordSet;
  reveal(el('sec-revoke-wrap'), canRevoke, now);
  reveal(el('revoke-tip-wrap'), canRevoke, now);
}

/* Rebuild on every load. The control takes its value at render time and has no
   setter, so reusing one shows a stale colour and saves it. */
function renderBgColor(value) {
  const slot = el('bg-color-slot');
  if (!slot) return;
  slot.textContent = '';
  renderColorControl(slot, { value, idPrefix: 'bg-color', label: t('appearance.color') });
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
  }
  const llEl = inp('log-level');
  if (llEl) llEl.value = s.logLevel || 'info';
  const langEl = inp('lang-sel');
  if (langEl) langEl.value = s.language || 'en';
  /* The key itself is never included in /api/config. */
  const apiEl = inp('bg-apikey-inp') || inp('bg-apikey');
  if (apiEl) {
    apiEl.placeholder = '●●●●●●●●●● (configured)';
    apiGet('/api/settings/unsplash-key')
      .then(d => {
        const vEl = el('ie-apikey-v');
        if (!d.configured) {
          apiEl.placeholder = t('appearance.unsplashKeyPh');
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
  const brEl = inp('bg-br');
  const brVal = el('bg-br-val');
  function updateSliderFill(slider) {
    if (!slider) return;
    const min = parseFloat(slider.min) || 0.1,
      max = parseFloat(slider.max) || 1.0;
    const pct = ((parseFloat(slider.value) - min) / (max - min)) * 100;
    /* backgroundImage, never the background shorthand. The shorthand resets
       background-clip, which is what keeps the track thin inside the 44px touch
       target on a phone. */
    slider.style.backgroundImage = `linear-gradient(var(--slider-dir), var(--ac) 0%, var(--ac) ${pct}%, var(--bd-inner) ${pct}%, var(--bd-inner) 100%)`;
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
  _si('bg-fit', s.background?.fit === 'fit' ? 'fit' : 'fill');
  showWallpaperFile(s.background?.url || '');
  renderBgColor(s.background?.color || BACKDROP);
  _sv('ie-bgurl-v', s.background?.url, 'Image URL');

  const ipEl = inp('srv-ip');
  if (ipEl) ipEl.value = s.server?.hostIp || '';
  const dockerEnEl = inp('srv-docker-en');
  const dockerSubEl = el('srv-docker-sub');
  const socketEl = inp('srv-socket');
  const hideHealthyEl = inp('srv-hide-healthy');
  if (dockerEnEl) {
    dockerEnEl.checked = !!s.server?.socketProxyUrl;
    const applyDocker = (v, now = false) => {
      if (dockerSubEl) dockerSubEl.classList.toggle('open', v);
      reveal(el('srv-docker-rows'), v, now);
      reveal(el('socket-hint-wrap'), v, now);
    };
    applyDocker(dockerEnEl.checked, true);
    dockerEnEl.addEventListener('change', () => applyDocker(dockerEnEl.checked));
  }
  if (hideHealthyEl) hideHealthyEl.checked = s.server?.hideHealthyBadge !== false;
  if (socketEl) socketEl.value = s.server?.socketProxyUrl || '';
  el('srv-save').addEventListener('click', saveServer);

  const secEnEl = inp('sec-en');
  const secLogout = el('sec-logout');
  const secRevoke = inp('sec-revoke');
  secLogout?.addEventListener('click', async () => {
    await apiPost('/api/auth/logout', {}).catch(() => {});
    location.reload();
  });
  secRevoke?.addEventListener('click', async () => {
    const ok = await confirmText({
      title: t('general.signOutEverywhere'),
      text: t('confirm.revokeSessions'),
      confirmLabel: t('general.signOutEverywhereBtn'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    secRevoke.disabled = true;
    try {
      await apiPost('/api/auth/revoke-sessions', {});
      toast(t('toast.sessionsRevoked'), 'ok');
    } catch (e) {
      toast(e.message || t('toast.saveFailed'), 'err');
    } finally {
      secRevoke.disabled = false;
    }
  });
  secEnEl?.addEventListener('change', () => syncSessionRows());

  _srvTrack = trackSave('srv-save', readServerForm);
  _bgTrack = trackSave('bg-save', readWallpaperForm);
  syncAuthFromServer().then(() => _srvTrack?.reset(false));
}

async function syncAuthFromServer() {
  let d;
  try {
    d = await apiGet('/api/auth/check');
  } catch {
    return;
  }
  _passwordSet = !!d.passwordSet;
  _authEnabled = !!d.enabled;
  const secEnEl = inp('sec-en');
  if (secEnEl) {
    /* The effective state. Enabled with no password behaves as off. */
    secEnEl.checked = !!d.enabled;
    reveal(el('ie-pw-wrap'), !!d.enabled, true);
    reveal(el('pw-hint-wrap'), !!d.enabled, true);
  }
  const pwValEl = el('ie-pw-v');
  if (pwValEl) pwValEl.textContent = d.passwordSet ? t('common.configured') : t('common.notSet');
  syncSessionRows(true);
}
/** The stored wallpaper, named by its file rather than its full path.

    @param {string} url @returns {void} */
export function showWallpaperFile(url) {
  const node = el('bg-file-v');
  if (!node) return;
  const name = url ? decodeURIComponent(String(url).split('/').pop() || '') : '';
  if (name) {
    setUserText(node, name);
    node.classList.remove('is-ph');
  } else {
    node.textContent = t('appearance.noImage');
    node.classList.add('is-ph');
  }
}

export function showBgFields(type) {
  const host = el('bg-unsplash-fields')?.parentElement;
  swapContent(host, () => {
    ['unsplash', 'url', 'color'].forEach(kind => {
      const node = el(`bg-${kind}-fields`);
      if (node) node.classList.toggle('d-none', kind !== type);
    });
    const brRow = el('bg-brightness-row');
    if (brRow) brRow.classList.toggle('d-none', type === 'color');
    el('bgcol-hint')?.classList.toggle('d-none', type !== 'unsplash');
    el('bg-url-hint')?.classList.toggle('d-none', type !== 'url');
  });
}
/** @param {Event} [e] */
async function saveLabels(e) {
  const toggled = /** @type {HTMLInputElement|null} */ (e?.target ?? null);
  const wasChecked = toggled ? toggled.checked : false;
  try {
    const c = await apiGet('/api/config');
    c.settings = c.settings || {};
    c.settings.showLabels = { desktop: inp('set-lbl-d')?.checked !== false, ios: inp('set-lbl-m')?.checked || false };
    await apiPost('/api/config', c);
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
    const c = await apiGet('/api/config');
    c.settings = c.settings || {};
    c.settings.keepAwake = !!inp('set-awake')?.checked;
    await apiPost('/api/config', c);
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
      bg.fit = inp('bg-fit')?.value === 'fit' ? 'fit' : 'fill';
    } else if (type === 'color') {
      bg.color = inp('bg-color-val')?.value?.trim() || '';
    }
    const c = await apiGet('/api/config');
    c.settings = c.settings || {};
    c.settings.background = bg;
    await apiPost('/api/config', c);
    /* After the main config. GET /api/config strips the key, so a config write
       that follows would overwrite it with nothing. */
    if (type === 'unsplash') {
      const keyVal = (inp('bg-apikey-inp') || inp('bg-apikey'))?.value?.trim() || '';
      if (keyVal) await apiPost('/api/settings/unsplash-key', { apiKey: keyVal });
    }
    _bgTrack?.reset();
    toast(t('toast.saved'));
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
      probe = await apiPost('/api/docker/test', { url });
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
  if (clearsStoredPassword({ enabled, wasEnabled: _authEnabled, passwordSet: _passwordSet })) {
    const ok = await confirmText({
      title: t('general.passwordProtection'),
      text: t('confirm.clearPassword'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) {
      await syncAuthFromServer();
      return;
    }
  }

  try {
    const c = await apiGet('/api/config');
    c.settings = c.settings || {};
    const prevLang = c.settings.language || 'en';
    const dockerEnabled = inp('srv-docker-en')?.checked || false;
    const socketUrl = inp('srv-socket')?.value?.trim() || '';
    c.settings.server = {
      ...c.settings.server,
      hostIp: inp('srv-ip')?.value?.trim() || '',
      socketProxyUrl: dockerEnabled ? socketUrl : '',
      hideHealthyBadge: inp('srv-hide-healthy')?.checked !== false,
    };
    c.settings.logLevel = inp('log-level')?.value || 'info';
    c.settings.language = inp('lang-sel')?.value || 'en';
    const langChanged = c.settings.language !== prevLang;

    await apiPost('/api/config', c);

    if (shouldWritePassword({ enabled, newPassword: pw })) {
      await apiPost('/api/auth/set-password', { password: pw });
      const pwEl = inp('sec-pw');
      if (pwEl) {
        pwEl.value = '';
        pwEl.placeholder = '●●●●●●●●●● (configured)';
      }
    }
    await apiPost('/api/auth/toggle', { enabled });
    if (!enabled) {
      const pwEl = inp('sec-pw');
      if (pwEl) {
        pwEl.placeholder = '';
        /* Whatever was typed was not stored. */
        pwEl.value = '';
      }
    }
    _srvTrack?.reset();
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
