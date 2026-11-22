import { wirePasswordStrength } from '/js/admin-auth.js?v=08792dd8';
import {
  applyHealthChecks,
  savedWallpaperUrl,
  showBgFields,
  showWallpaperFile,
  wireProxmox,
  wireUnsplashKey,
} from '/js/admin-settings.js?v=48b2de2a';
import {
  clearFieldError,
  errorText,
  initInlineEdit,
  responseError,
  reveal,
  showFieldError,
  toast,
} from '/js/admin-shared.js?v=0f28a237';
import { LANGUAGES, t } from '/js/i18n.js?v=82ba9da2';
import { createListbox } from '/js/listbox.js?v=c9cee787';
import { passwordMismatch } from '/js/password-policy.js?v=e16ebd1a';
import { fillUsernames, wireReveal } from '/js/password-reveal.js?v=bdd477f5';
import {
  applyTheme,
  prefersDark,
  readMode,
  readReduceTransparency,
  resolveTheme,
  THEME_KEY,
  TRANSPARENCY_KEY,
  watchSystemTheme,
  watchTransparency,
  writeMode,
  writeReduceTransparency,
} from '/js/theme.js?v=0bbd81e8';
import { el, inp, qa, setUserText } from '/js/utils.js?v=457d9918';

/* The pickers are built before the catalog loads, so each registers how to
   relabel itself. Without this their options read as raw keys. */
const relabels = [];
const relabel = fn => {
  relabels.push(fn);
  return fn;
};

/** Relabel every Settings picker from the loaded catalog and the saved values. */
export const syncPickerLabels = () => {
  relabels.forEach(fn => fn());
};

/* A typed password never shows in the row.
   @param {Element} valEl @param {string} value */
function renderSecret(valEl, value) {
  const saved = /** @type {HTMLElement} */ (valEl).dataset.saved;
  valEl.textContent = value ? t('widgetCfg.newValueSet') : saved || t('common.notSet');
  valEl.classList.toggle('is-ph', !value && !saved);
}

export function initPasswordRows() {
  const pw = inp('sec-pw');
  const pw2 = inp('sec-pw2');
  if (!pw || !pw2) return;
  const mismatched = () => pw.value !== '' && pw2.value !== '' && passwordMismatch(pw.value, pw2.value);
  const checkMatch = () => {
    clearFieldError(el('ie-pw2'));
    if (mismatched()) showFieldError(el('ie-pw2'), t('setup.mismatch'), { focus: false });
  };
  const settle = () => {
    el('sec-pw-bars')?.classList.add('d-none');
    el('sec-pw-hint')?.classList.add('d-none');
    checkMatch();
  };
  initInlineEdit('ie-pw', 'sec-pw', {
    type: 'password',
    placeholder: () => t('general.passwordPh'),
    fill: false,
    render: renderSecret,
    onCommit: settle,
    onCancel: settle,
  });
  initInlineEdit('ie-pw2', 'sec-pw2', {
    type: 'password',
    placeholder: () => t('setup.confirmPassword'),
    fill: false,
    render: renderSecret,
    onCommit: checkMatch,
    onCancel: checkMatch,
  });
  el('sec-pw-form')?.addEventListener('submit', e => e.preventDefault());
  pw.addEventListener('input', () => {
    reveal(el('ie-pw2-wrap'), pw.value !== '');
    if (!mismatched()) clearFieldError(el('ie-pw2'));
  });
  wireReveal(/** @type {HTMLButtonElement[]} */ (qa('#ie-pw .pw-reveal, #ie-pw2 .pw-reveal')), [pw, pw2]);
  fillUsernames();
}

function initAllInlineEdits() {
  initInlineEdit('ie-ip', 'srv-ip', { placeholder: '192.168.1.100', plain: true });
  initInlineEdit('ie-socket', 'srv-socket', { placeholder: 'http://socket-proxy:2375', plain: true });
  initInlineEdit('ie-pve-url', 'srv-pve-url', { type: 'url', placeholder: 'https://192.168.1.10:8006', plain: true });
  initInlineEdit('ie-pve-token', 'srv-pve-token', { placeholder: 'stackyard@pve!dashboard', plain: true });
  initInlineEdit('ie-hosts', 'srv-hosts', {
    placeholder: () => t('general.allowedHostsNone'),
    empty: () => t('general.allowedHostsNone'),
    plain: true,
  });

  initPasswordRows();
  let meterWired = false;
  el('sec-pw')?.addEventListener('input', () => {
    el('sec-pw-bars')?.classList.remove('d-none');
    el('sec-pw-hint')?.classList.remove('d-none');
    if (meterWired) return;
    meterWired = true;
    wirePasswordStrength('sec-pw', 'sec-pw-bars', 'sec-pw-hint');
  });

  wireUnsplashKey();
  wireProxmox();

  const colInp = document.createElement('input');
  colInp.id = 'bg-col-inp';
  document.body.appendChild(colInp);
  initInlineEdit('ie-bgcol', 'bg-col-inp', { placeholder: 'AGVpqBZnzUE', plain: true });

  const urlInp = document.createElement('input');
  urlInp.id = 'bg-url-inp';
  urlInp.type = 'url';
  document.body.appendChild(urlInp);
  initInlineEdit('ie-bgurl', 'bg-url-inp', {
    placeholder: 'https://example.com/photo.jpg',
    plain: true,
    onCommit(v) {
      fetchWallpaperLink(v.trim());
    },
  });
}

function initSecToggle() {
  const en = inp('sec-en');
  if (!en) return;
  function apply(on, now = false) {
    reveal(el('ie-pw-wrap'), on, now);
    reveal(el('ie-pw2-wrap'), on && inp('sec-pw')?.value !== '', now);
    reveal(el('pw-hint-wrap'), on, now);
  }
  apply(en.checked, true);
  en.addEventListener('change', () => apply(en.checked));
}

function initHealthChecksToggle() {
  const en = inp('srv-hc-en');
  if (!en) return;
  applyHealthChecks(en.checked, true);
  en.addEventListener('change', () => applyHealthChecks(en.checked));
}

function initBgType() {
  const slot = el('bg-type-slot');
  const hidden = inp('bg-type');
  if (!slot || !hidden) return;
  const apply = val => {
    hidden.value = val;
    showBgFields(val);
  };
  const opts = () => [
    { value: 'unsplash', label: t('appearance.sourceUnsplash') },
    { value: 'url', label: t('appearance.sourceUrl') },
    { value: 'color', label: t('appearance.sourceColor') },
  ];
  const box = createListbox({
    id: 'bg-type',
    label: t('appearance.source'),
    options: opts(),
    value: hidden.value || 'unsplash',
    onChange: v => apply(String(v)),
  });
  slot.appendChild(box.el);
  relabel(() => {
    box.setLabel(t('appearance.source'));
    box.setOptions(opts(), hidden.value);
  });
  apply(hidden.value || 'unsplash');
}

function initBgFit() {
  const slot = el('bg-fit-slot');
  const hidden = inp('bg-fit');
  if (!slot || !hidden) return;
  const apply = val => {
    hidden.value = val;
  };
  const opts = () => [
    { value: 'fill', label: t('appearance.fitFill') },
    { value: 'fit', label: t('appearance.fitContain') },
  ];
  const box = createListbox({
    id: 'bg-fit',
    label: t('appearance.fit'),
    options: opts(),
    value: hidden.value || 'fill',
    onChange: v => apply(String(v)),
  });
  slot.appendChild(box.el);
  relabel(() => {
    box.setLabel(t('appearance.fit'));
    box.setOptions(opts(), hidden.value);
  });
  apply(hidden.value || 'fill');
}

/** @param {string} url an image this server holds @returns {void} */
function setWallpaperUrl(url) {
  const urlInp = inp('bg-url-inp');
  if (urlInp) urlInp.value = url;
  const rv = el('ie-bgurl-v');
  if (rv) {
    setUserText(rv, url);
    rv.classList.remove('is-ph');
  }
  showWallpaperFile(url);
  /* Keep this event. Save re-checks only on an edit, so without it an upload never enables Save. */
  (urlInp ?? document).dispatchEvent(new Event('input', { bubbles: true }));
}

function initWallpaperUpload() {
  const input = inp('bg-upload');
  const btn = /** @type {HTMLButtonElement} */ (el('bg-upload-lbl'));
  if (!input || !btn) return;
  input.onchange = async () => {
    const file = /** @type {HTMLInputElement} */ (input).files?.[0];
    if (!file) return;
    const orig = btn.textContent;
    btn.textContent = t('appearance.uploading');
    btn.disabled = true;
    try {
      const form = new FormData();
      form.append('wallpaper', file, file.name);
      const r = await fetch('/api/wallpaper/upload', { method: 'POST', body: form });
      if (!r.ok) throw await responseError(r);
      const d = await r.json();
      setWallpaperUrl(d.url);
      toast(t('toast.wallpaperStored'));
    } catch (e) {
      toast(t('toast.wallpaperFailed', { err: errorText(e) }), 'err');
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
      /** @type {HTMLInputElement} */ (input).value = '';
    }
  };
  btn.onclick = () => /** @type {HTMLInputElement} */ (input).click();
}

/** Downloads a pasted link to this server. The page's content policy refuses an
    image from any other origin.

    @param {string} url @returns {Promise<void>} */
async function fetchWallpaperLink(url) {
  if (!url || url.startsWith('/icons/')) return;
  try {
    const r = await fetch('/api/wallpaper/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) throw await responseError(r);
    const d = await r.json();
    setWallpaperUrl(d.url);
    toast(t('toast.wallpaperStored'));
  } catch (e) {
    /* A link that failed must not replace the wallpaper already saved. */
    setWallpaperUrl(savedWallpaperUrl());
    toast(t('toast.wallpaperFailed', { err: errorText(e) }), 'err');
  }
}

function initLogLevel() {
  const slot = el('log-level-slot');
  const hidden = inp('log-level');
  if (!slot || !hidden) return;
  const opts = () => [
    { value: 'debug', label: t('general.logDebug') },
    { value: 'info', label: t('general.logInfo') },
    { value: 'error', label: t('general.logError') },
  ];
  const box = createListbox({
    id: 'log-level',
    label: t('general.loggingLevel'),
    options: opts(),
    value: hidden.value || 'info',
    onChange: v => {
      hidden.value = String(v);
    },
  });
  slot.appendChild(box.el);
  relabel(() => {
    box.setLabel(t('general.loggingLevel'));
    box.setOptions(opts(), hidden.value);
  });
  hidden.value = hidden.value || 'info';
}

function initLanguage() {
  const slot = el('lang-slot');
  const hidden = inp('lang-sel');
  if (!slot || !hidden) return;
  const box = createListbox({
    id: 'lang',
    label: t('common.language'),
    options: LANGUAGES.map(l => ({ value: l.code, label: l.name, lang: l.code })),
    value: hidden.value || 'en',
    onChange: v => {
      hidden.value = String(v);
    },
  });
  slot.appendChild(box.el);
  relabel(() => {
    box.setLabel(t('common.language'));
    box.setValue(hidden.value);
  });
  hidden.value = hidden.value || 'en';
}

const THEME_LABEL_KEYS = {
  system: 'appearance.displaySystem',
  light: 'appearance.displayLight',
  dark: 'appearance.displayDark',
};

function initTheme() {
  const slot = el('theme-slot');
  const hidden = inp('theme-sel');
  if (!slot || !hidden) return;
  const opts = () => [
    { value: 'system', label: t(THEME_LABEL_KEYS.system) },
    { value: 'light', label: t(THEME_LABEL_KEYS.light) },
    { value: 'dark', label: t(THEME_LABEL_KEYS.dark) },
  ];
  const box = createListbox({
    id: 'theme',
    label: t('appearance.displayMode'),
    options: opts(),
    value: readMode(),
    onChange: v => {
      hidden.value = writeMode(String(v));
      box.setValue(hidden.value);
    },
  });
  slot.appendChild(box.el);
  relabel(() => {
    box.setLabel(t('appearance.displayMode'));
    box.setOptions(opts(), hidden.value);
  });
  hidden.value = writeMode(readMode());
  box.setValue(hidden.value);
  watchSystemTheme(() => hidden.value);
  const solid = inp('dev-transparency');
  if (solid) {
    solid.checked = readReduceTransparency();
    solid.addEventListener('change', () => writeReduceTransparency(solid.checked));
  }
  watchTransparency();
  addEventListener('storage', e => {
    if (solid && e.key === TRANSPARENCY_KEY) solid.checked = readReduceTransparency();
    if (e.key !== THEME_KEY) return;
    hidden.value = readMode();
    box.setValue(hidden.value);
    applyTheme(resolveTheme(hidden.value, prefersDark()));
  });
}

/** Wire every Settings control that is not a list: the inline-edit rows, the
    password rows, the switches that open rows, the pickers and the wallpaper
    upload. */
export function initSettingsControls() {
  initAllInlineEdits();
  initSecToggle();
  initHealthChecksToggle();
  initBgType();
  initBgFit();
  initWallpaperUpload();
  initLogLevel();
  initLanguage();
  initTheme();
}
