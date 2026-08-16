import { loadLocalIcons, iconChain } from '/js/icons.js?v=69c2b9bd';
import {
  WIDGET_HEIGHTS,
  WIDGET_DESIGN,
  WIDGET_COLS,
  WIDGET_ROWS,
  WIDGET_COST,
  widgetSrc,
  cardPreset,
} from '/js/widget-types.js?v=b81ceeea';
import {
  mk,
  mkWrap as _mkWrap,
  mountScaledWidget,
  teardownWidgets,
  sanitizeCssUrl,
  el,
  q,
  qi,
  qa,
  setUserText,
} from '/js/utils.js?v=b81f6875';
import { initSpotlight } from '/js/spotlight.js?v=4bb67d77';
import { html, setHtml, raw } from '/js/html.js?v=c71f8903';
import { initI18n, t, currentLang } from '/js/i18n.js?v=d056c9c5';
import { pwStrength, passwordMismatch } from '/js/password-strength.js?v=42f45ac7';
import { sanitizeItemLinks } from '/js/link-url.js?v=54adb40f';
import { initUI, mkFolder, openFolderDesktop, openFolderMobile, buildMobile } from '/js/ui.js?v=7522fffa';
import { badgeMinimum, badgeSignature, computeBadgeVisual, readBadgeUpdate } from '/js/badge-logic.js?v=e2857764';
import {
  configChanged,
  landingAfterSetup,
  readWallpaperCache,
  writeWallpaperCache,
  restorePage,
} from '/js/dashboard-logic.js?v=a0604f3b';
import { trapFocus } from '/js/dialog.js?v=05935547';
import { jitter } from '/js/jitter.js?v=4edf48f2';
import { isMobileLayout, onLayoutChange } from '/js/layout.js?v=28416a75';
import { startWakeLock } from '/js/wake-lock.js?v=6b9591cf';

/* Recomputed, never stored: the window can cross the breakpoint after load. */
let MOB = isMobileLayout();

const wCols = { d: WIDGET_COLS.desktop, m: WIDGET_COLS.mobile };
const wRows = { d: WIDGET_ROWS.desktop, m: WIDGET_ROWS.mobile };
const WH = { d: WIDGET_HEIGHTS };
/* An app icon's corner is 22.37% of its width. A fixed radius only lands on that
   at one icon size, and the grid draws two: 72 with a label under it, 78
   without. */
const ICON_R = 0.2237;
/* A widget tile's corner, at design size. WIDGET_DESIGN's small is 170 square
   against the reference's 165, so this is its 28 unchanged. */
const WIDGET_R = 28;
const wCost = { d: WIDGET_COST.desktop, m: WIDGET_COST.mobile };

const DCOLS = 6;
/* The design values the stylesheet's --tile-h and --row-gap ratios were derived
   from. Read gridMetrics() for the live sizes; these are only the fallback and
   the divisor that turns a live tile height back into a scale factor. */
const DESIGN_TILE = 152;
const DESIGN_ROW_GAP = 30;

/* The stylesheet owns the desktop scale, so it tracks a resize with no script.
   Reading it back here is what keeps pagination and widget heights on the same
   system. Do not reintroduce a second copy of these numbers.

   Measured off a real element, never with getPropertyValue: a custom property
   reads back as the text it was written as, so a min() or calc() comes out
   unresolved and parses as NaN. */
function gridMetrics() {
  const probe = document.createElement('div');
  probe.className = 'gm-probe';
  const gap = document.createElement('i');
  probe.appendChild(gap);
  document.body.appendChild(probe);
  const tile = probe.getBoundingClientRect().height || DESIGN_TILE;
  const rowGap = gap.getBoundingClientRect().height || DESIGN_ROW_GAP;
  probe.remove();
  return { tile, rowGap, scale: tile / DESIGN_TILE };
}
let gm = { tile: DESIGN_TILE, rowGap: DESIGN_ROW_GAP, scale: 1 };

function desktopSlots() {
  const ih = innerHeight;
  const top = Math.min(70, Math.max(44, ih * 0.04));
  const bottom = Math.min(160, Math.max(110, ih * 0.1));
  const rows = Math.max(1, Math.min(4, Math.floor((ih - top - bottom + gm.rowGap) / (gm.tile + gm.rowGap))));
  return DCOLS * rows;
}

const CB = { spotOpen: null, spotClose: null, mobPillBump: null };

const PAGE_STORE = 'dash_page',
  WALLPAPER_STORE = 'dash_wallpaper';

/** @param {string} key @returns {string|null} */
function storeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** @param {string} key @param {string} value */
function storeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

let items = [],
  pg = 0,
  totalPages = 0,
  S = {},
  _stateRef = null;
let _rev = null;
/* Null prototype. Keyed by values from config, so an inherited property must
   never answer a miss. */
let widgetReg = Object.create(null);
const _mobTsCleanup = null,
  _mobTeCleanup = null;

const badgeState = Object.create(null);
let _badgeFails = 0,
  _healthFails = 0,
  badgesStale = false,
  healthStale = false;
const BEL = new Map();
/* Last painted appearance per badge element. Without it the same values are
   rewritten thousands of times a session. */
const BSIG = new WeakMap();
function breg(id, el) {
  if (!BEL.has(id)) BEL.set(id, new Set());
  BEL.get(id).add(el);
}
function bunreg(id, el) {
  if (BEL.has(id)) BEL.get(id).delete(el);
}
function bupd(id) {
  const els = BEL.get(id);
  if (!els?.size) return;
  const item = items.find(i => i.id === id);
  const s = item?.type === 'folder' ? folderBadge(item) : badgeState[id] || {};
  const hideHealthy = S.server?.hideHealthyBadge !== false;
  const custom = item?.monitoring?.activity?.custom || {};
  const staticBdg = item?.monitoring?.staticBadge || {};
  const hasHC = !!(item?.monitoring?.healthcheck?.enabled || item?.container || item?.ping);

  const { cls, txt, bg, aria, color, title } = computeBadgeVisual({
    health: s.health,
    activity: s.activity,
    activityStale: !!s.activityStale,
    custom,
    staticBdg,
    hasHC,
    hideHealthy,
    badgesStale,
    healthStale,
    healthDetail: s.healthDetail,
    translate: t,
  });

  const sig = badgeSignature({ cls, txt, bg, aria, color, title });

  els.forEach(el => {
    if (BSIG.get(el) === sig) return;
    BSIG.set(el, sig);
    el.className = cls;
    el.textContent = txt;
    if (aria) {
      el.setAttribute('role', 'status');
      el.setAttribute('aria-label', aria);
    } else {
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
    }
    el.style.background = bg;
    el.style.color = color;
    /* Assigned, never interpolated. An upstream error string must not become
       markup. */
    if (title) el.title = title;
    else el.removeAttribute('title');
  });
}

function bset(id, type, val) {
  if (!badgeState[id]) badgeState[id] = { health: 0, activity: 0 };
  badgeState[id][type] = val;
  bupd(id);
  items.filter(i => i.type === 'folder' && (i.children || []).includes(id)).forEach(f => bupd(f.id));
}
function folderBadge(folder) {
  const children = (folder.children || []).map(id => items.find(i => i.id === id)).filter(Boolean);
  let actSum = 0,
    hasHealth = false;
  for (const c of children) {
    const s = badgeState[c.id] || {};
    if (s.health) hasHealth = true;
    /* A child whose own count is below its minimum shows no badge, so it must
       not raise the folder's either. */
    if (s.activity >= badgeMinimum(c.monitoring?.activity?.custom)) actSum += s.activity;
  }
  return { health: hasHealth, activity: actSum };
}

const mkWrap = (item, sz, r, isz, cls) => _mkWrap(item, sz, r, isz, cls, breg);

function paginate() {
  const pl = 'd';
  const inFolder = new Set(
    items
      .filter(i => i.type === 'folder')
      .flatMap(f => f.children || [])
      .map(String),
  );
  const budget = desktopSlots();
  const pages = [];
  let cur = [],
    used = 0;
  for (const item of items) {
    if (item.dock) continue;
    if (item.hidden) continue;
    if (inFolder.has(String(item.id))) continue;
    const cost = item.type === 'widget' ? wCost[pl][item.widgetSize || 'medium'] : 1;
    if (used + cost > budget && cur.length) {
      pages.push([...cur]);
      cur = [];
      used = 0;
    }
    cur.push(item);
    used += cost;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

function mkIcon(item) {
  if (item.type === 'folder') return mkFolder(item);
  const showLabel = S.showLabels?.desktop !== false;
  const iw = Math.round((showLabel ? 72 : 78) * gm.scale),
    isz = Math.round((showLabel ? 50 : 56) * gm.scale);
  const a =
    item.system === 'settings'
      ? mk('a', { href: '/admin/' })
      : mk('a', { href: item.href, target: '_blank', rel: 'noreferrer noopener' });
  a.className = 'icon';
  a.setAttribute('aria-label', item.label || item.id);
  if (!showLabel) a.title = item.label || item.id;
  a.appendChild(mkWrap(item, iw, Math.round(iw * ICON_R), isz, 'iwrap'));
  if (showLabel) {
    const l = mk('div');
    l.className = 'ilabel';
    l.style.width = iw + 12 + 'px';
    setUserText(l, item.label || item.id);
    a.appendChild(l);
  }
  return a;
}

function widgetTitle(item) {
  if (item.widgetType === 'stats' && item.widgetConfig?.widgetSubType === 'disk-health')
    return item.label || t('status.diskHealth');
  return item.label || widgetReg[item.widgetType]?.label || t('type.widget');
}
function mkWidget(item) {
  const sz = item.widgetSize || 'medium';
  const cell = mk('div');
  let cls = `wc c${wCols.d[sz]}`;
  if (wRows.d[sz] >= 3) cls += ' r3';
  else if (wRows.d[sz] >= 2) cls += ' r2';
  cell.className = cls;
  const card = mk('div');
  card.className = 'widget';
  if (item.widgetType) card.dataset.wtype = item.widgetType;
  const preset = cardPreset(item, widgetReg);
  if (preset) card.dataset.card = preset;
  if (item.widgetConfig?.widgetSubType) card.dataset.wsubtype = item.widgetConfig.widgetSubType;
  const design = WIDGET_DESIGN[sz] || WIDGET_DESIGN.medium;
  card.style.height = Math.round(WH.d[sz] * gm.scale) + 'px';
  card.style.borderRadius = Math.round(WIDGET_R * gm.scale) + 'px';
  mountScaledWidget(card, {
    src: widgetSrc(item, widgetReg, { lang: currentLang() }),
    title: widgetTitle(item),
    design,
    iframeOpts: item.iframe,
  });
  cell.appendChild(card);
  return cell;
}

function mkDock(item) {
  const a =
    item.system === 'settings'
      ? mk('a', { href: '/admin/' })
      : mk('a', { href: item.href, target: '_blank', rel: 'noreferrer noopener' });
  a.className = 'di';
  a.setAttribute('aria-label', item.label || item.id);
  a.title = item.label || item.id;
  a.appendChild(mkWrap(item, 78, Math.round(78 * ICON_R), 50, 'dwrap'));
  return a;
}

/* A real <button>, not a styled div. A div is skipped by Tab and does nothing
   on Enter or Space.

   @param {number} i @param {number} total @param {number} current
   @param {(i:number)=>void} go */
function mkDot(i, total, current, go) {
  const d = mk('button');
  d.type = 'button';
  d.className = 'dot' + (i === current ? ' on' : '');
  d.setAttribute('aria-label', t('home.goToPage', { page: i + 1, total }));
  if (i === current) d.setAttribute('aria-current', 'true');
  d.onclick = () => go(i);
  return d;
}

function buildDesktop() {
  /* Removing the DOM does not stop the observers and timers the previous
     widgets started. */
  teardownWidgets();
  BEL.clear();
  /* Before paginate() and before any tile is built: both size against it. */
  gm = gridMetrics();
  const dock = items.filter(i => i.type === 'app' && i.dock && !i.hidden).slice(0, 4);
  const pages = paginate();
  totalPages = pages.length;
  const strip = el('pages');
  strip.innerHTML = '';
  pages.forEach(pageItems => {
    const p = mk('div');
    p.className = 'page';
    const g = mk('div');
    g.className = 'grid';
    for (const item of pageItems) g.appendChild(item.type === 'widget' ? mkWidget(item) : mkIcon(item));
    p.appendChild(g);
    strip.appendChild(p);
  });
  const dots = el('dots');
  dots.innerHTML = '';
  pages.forEach((_, i) => dots.appendChild(mkDot(i, pages.length, 0, goTo)));
  const dk = el('dock');
  dk.innerHTML = '';
  dock.forEach(item => dk.appendChild(mkDock(item)));
  const ct = el('ctrls');
  ct.innerHTML = '';
}

/* Every page is mounted at once, so widgets the user has swiped away from keep
   polling. Off-screen frames run at a fraction of their configured rate. */
const OFF_PAGE_RATE = 4;

function applyPollRates() {
  const strip = el('pages');
  if (!strip) return;
  Array.from(strip.children).forEach((page, i) => {
    const rate = i === pg ? 1 : OFF_PAGE_RATE;
    qa('iframe', /** @type {HTMLElement} */ (page)).forEach(ifr => {
      const frame = /** @type {HTMLIFrameElement} */ (ifr);
      /* A frame that has not loaded yet carries no toolbox to tell. */
      if (!frame.dataset.rateBound) {
        frame.dataset.rateBound = '1';
        frame.addEventListener('load', applyPollRates);
      }
      try {
        /** @type {any} */ (frame.contentWindow)?.__setPollRate?.(rate);
      } catch {
        /* A frame mid-navigation has no reachable window. */
      }
    });
  });
}

/* Announce user-initiated page changes only. Announcing polled health talks
   over whatever someone is doing every time a service flaps.

   @param {number} index @param {number} total */
function announcePage(index, total) {
  const live = el('page-live');
  if (!live) return;
  live.textContent = t('home.pageAnnounce', { page: index + 1, total });
}

function goTo(n, dotEls, announce = true) {
  const total = dotEls ? dotEls.length : totalPages;
  const was = pg;
  pg = Math.max(0, Math.min(total - 1, n));
  if (pg !== was && announce) announcePage(pg, total);
  if (_stateRef) _stateRef.pg = pg;
  storeSet(PAGE_STORE, String(pg));
  const strip = el('pages');
  const t = `translateX(-${pg * 100}vw)`;
  strip.style.transform = strip.style.webkitTransform = t;
  strip.style.willChange = 'transform';
  strip.addEventListener(
    'transitionend',
    () => {
      strip.style.willChange = 'auto';
    },
    { once: true },
  );
  (dotEls ?? document.querySelectorAll('.dot')).forEach((d, i) => {
    d.classList.toggle('on', i === pg);
    if (i === pg) d.setAttribute('aria-current', 'true');
    else d.removeAttribute('aria-current');
  });
  if (MOB && CB.mobPillBump) CB.mobPillBump(pg);
  applyPollRates();
}

/* ensureSpace can create overflow pages paginate() did not report, so sync the
   dots from the DOM. */
function syncMobPages() {
  const strip = el('pages');
  const domCount = strip ? strip.children.length : 0;
  if (domCount <= totalPages) return; /* no overflow pages, nothing to fix */
  totalPages = domCount;
  const dots = el('dots');
  dots.innerHTML = '';
  for (let i = 0; i < domCount; i++) dots.appendChild(mkDot(i, domCount, pg, goTo));
  const pillDots = q('.msp-dots');
  if (pillDots) {
    while (pillDots.children.length < domCount) {
      const d = document.createElement('div');
      d.className = 'msp-dot';
      pillDots.appendChild(d);
    }
    Array.from(pillDots.children).forEach((d, i) => d.classList.toggle('on', i === pg));
    const origBump = CB.mobPillBump;
    CB.mobPillBump = newPg => {
      if (origBump) origBump(newPg); /* runs the pillPaging animation */
      Array.from(pillDots.children).forEach((d, i) => d.classList.toggle('on', i === newPg));
    };
  }
}

async function applyBg() {
  const root = document.documentElement;
  try {
    const bg = S.background || {};
    if (bg.type === 'color' && bg.color) {
      const safeColor = String(bg.color).replace(/[^a-zA-Z0-9#(),.\s%]/g, '');
      root.style.setProperty('--bg-image', 'none');
      root.style.setProperty('--bg-color', safeColor);
      root.style.setProperty('--bg-brightness', '1');
    } else if (bg.type === 'url' && bg.url) {
      root.style.setProperty('--bg-image', `url('${sanitizeCssUrl(bg.url)}')`);
      root.style.setProperty('--bg-color', '#0d1117');
      root.style.setProperty('--bg-brightness', String(bg.brightness ?? 0.62));
    } else if (bg.type === 'unsplash') {
      let url = readWallpaperCache(storeGet(WALLPAPER_STORE), bg, Date.now());
      if (!url) {
        const r = await fetch('/api/wallpaper', { cache: 'no-store' });
        const d = await r.json();
        url = d.url || null;
        if (url) storeSet(WALLPAPER_STORE, writeWallpaperCache(url, bg, Date.now()));
      }
      if (url) {
        const shown = url;
        const img = new Image();
        img.onload = () => {
          root.style.setProperty('--bg-image', `url('${sanitizeCssUrl(shown)}')`);
          root.style.setProperty('--bg-color', '#0d1117');
          root.style.setProperty('--bg-brightness', String(bg.brightness ?? 0.62));
        };
        img.src = shown;
      }
    }
  } catch {}
}

function refreshBadges() {
  for (const id of BEL.keys()) bupd(id);
}
async function pollBadges() {
  try {
    const d = await (await fetch('/api/badges', { cache: 'no-store' })).json();
    for (const [id, v] of Object.entries(d)) {
      const { value, failed } = readBadgeUpdate(v);
      /* A failed item keeps its last value, marked stale. Overwriting it with
         zero reads as "nothing pending", which is not what happened. */
      bset(id, 'activityStale', failed);
      if (!failed) bset(id, 'activity', value);
    }
    _badgeFails = 0;
    if (badgesStale) {
      badgesStale = false;
      refreshBadges();
    }
  } catch {
    if (++_badgeFails >= 2 && !badgesStale) {
      badgesStale = true;
      refreshBadges();
    }
  }
}
async function pollHealth() {
  try {
    const d = await (await fetch('/api/health', { cache: 'no-store' })).json();
    for (const [id, v] of Object.entries(d)) {
      bset(id, 'healthDetail', v);
      bset(id, 'health', v.unhealthy ? 1 : 0);
    }
    _healthFails = 0;
    if (healthStale) {
      healthStale = false;
      refreshBadges();
    }
  } catch {
    if (++_healthFails >= 2 && !healthStale) {
      healthStale = true;
      refreshBadges();
    }
  }
}

const EYE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';

function showSetupPrompt() {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'setup-prompt';
    setHtml(
      ov,
      html`<div class="setup-card" role="dialog" aria-modal="true" aria-labelledby="setup-title"><p id="setup-title" class="setup-title">${t('setup.title')}</p><p class="setup-sub">${t('setup.sub')}</p><div class="setup-field"><input id="setup-pw" type="password" placeholder="${t('setup.newPassword')}" aria-label="${t('setup.newPassword')}" autocomplete="new-password" class="setup-pw"><button id="setup-reveal" type="button" class="setup-reveal" aria-pressed="false" aria-label="${t('common.showPassword')}" title="${t('common.showPassword')}">${raw(EYE)}</button></div><input id="setup-pw2" type="password" placeholder="${t('setup.confirmPassword')}" aria-label="${t('setup.confirmPassword')}" autocomplete="new-password" class="setup-pw"><div id="setup-bars" class="setup-bars"><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span></div><div id="setup-hint" class="setup-hint"></div><div id="setup-err" class="setup-err" role="alert"></div><div class="setup-btns"><button id="setup-skip" type="button" class="setup-btn setup-btn-skip">${t('setup.skip')}</button><button id="setup-set" type="button" class="setup-btn setup-btn-set" disabled>${t('setup.set')}</button></div></div>`,
    );
    document.body.appendChild(ov);

    const pw = qi('#setup-pw', ov);
    const pw2 = qi('#setup-pw2', ov);
    const rev = qi('#setup-reveal', ov);
    const bars = qa('.pwbar', ov);
    const hint = q('#setup-hint', ov);
    const err = q('#setup-err', ov);
    const setB = qi('#setup-set', ov);
    const skip = qi('#setup-skip', ov);
    const dim = 'rgba(255,255,255,.1)';

    /* A typo here locks the dashboard with no way back in. */
    const matches = () => pw2.value !== '' && !passwordMismatch(pw.value, pw2.value);
    const sync = () => {
      const { score, labelKey, color, ok } = pwStrength(pw.value);
      bars.forEach((b, i) => {
        b.style.background = pw.value && i < score ? color : dim;
      });
      hint.textContent = pw.value && labelKey ? t(labelKey) : '';
      hint.style.color = color;
      const mismatch = pw2.value !== '' && passwordMismatch(pw.value, pw2.value);
      err.textContent = mismatch ? t('setup.mismatch') : '';
      err.style.display = mismatch ? 'block' : 'none';
      setB.disabled = !ok || !matches();
    };
    pw.addEventListener('input', sync);
    pw2.addEventListener('input', sync);

    rev.onclick = () => {
      const show = pw.type === 'password';
      pw.type = pw2.type = show ? 'text' : 'password';
      rev.setAttribute('aria-pressed', String(show));
      const label = t(show ? 'common.hidePassword' : 'common.showPassword');
      rev.setAttribute('aria-label', label);
      rev.title = label;
    };

    let releaseTrap = trapFocus(ov, { closeOnEscape: false, initialFocus: pw });
    const close = () => {
      if (releaseTrap) {
        releaseTrap();
        releaseTrap = null;
      }
      ov.remove();
      resolve();
    };

    skip.onclick = async () => {
      skip.disabled = true;
      try {
        await fetch('/api/auth/dismiss-setup', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      } catch {}
      const to = landingAfterSetup(items);
      if (to) {
        location.href = to;
        return;
      }
      close();
    };

    async function doSet() {
      if (!pwStrength(pw.value).ok || !matches()) return;
      setB.disabled = true;
      skip.disabled = true;
      err.style.display = 'none';
      try {
        const r = await fetch('/api/auth/set-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw.value }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || t('setup.failed'));
        const to = landingAfterSetup(items);
        if (to) location.href = to;
        else location.reload();
      } catch (e) {
        err.textContent = e.message;
        err.style.display = 'block';
        setB.disabled = false;
        skip.disabled = false;
      }
    }
    setB.onclick = doSet;
    pw.onkeydown = pw2.onkeydown = e => {
      if (e.key === 'Enter' && !setB.disabled) doSet();
    };
    pw.focus();
  });
}

async function boot() {
  let authData = null;
  try {
    const authCheck = await fetch('/api/auth/check', { cache: 'no-store' });
    if (authCheck.status === 401) {
      window.location.href = '/admin/';
      return;
    }
    authData = await authCheck.json();
    if (authData.enabled && !authData.authenticated) {
      window.location.href = '/admin/';
      return;
    }
  } catch {
    /* API down, handled below */
  }

  let configFailed = false;
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const c = await res.json();
    /* Saving rejects these, but a config written earlier still reaches here.
       See ui/js/link-url.js. */
    items = sanitizeItemLinks(c.items || []);
    S = c.settings || {};
    _rev = c._rev ?? null;
    await initI18n(S.language || 'en');
  } catch (e) {
    console.error('[boot]', e);
    configFailed = true;
  }

  await loadLocalIcons();

  if (configFailed) {
    const msg = document.createElement('div');
    msg.className = 'api-error-screen';
    setHtml(
      msg,
      html`<p class="api-error-title">${t('home.apiDownTitle')}</p><p class="api-error-sub">${t('home.apiDownSub')}</p><button class="api-error-btn" type="button">${t('home.retry')}</button>`,
    );
    /* Not an inline onclick. The page's CSP refuses those. */
    msg.querySelector('.api-error-btn')?.addEventListener('click', () => location.reload());
    document.body.appendChild(msg);
    document.body.classList.add('ready');
    return;
  }

  if (authData && !authData.setupPrompted && !authData.passwordSet) {
    await showSetupPrompt();
  }

  try {
    const wr = await (await fetch('/api/widgets', { cache: 'no-store' })).json();
    widgetReg = Object.create(null);
    for (const w of wr.widgets || []) if (w && w.name) widgetReg[w.name] = w;
  } catch {
    widgetReg = Object.create(null);
  }

  const state = {
    items,
    S,
    CB,
    BEL,
    badgeState,
    breg,
    bunreg,
    bupd,
    folderBadge,
    paginate,
    goTo,
    pg: 0,
    _mobTsCleanup,
    _mobTeCleanup,
    widgetReg,
  };
  _stateRef = state;
  initUI(state);
  initSpotlight({ getItems: () => items, isMob: () => MOB, CB, iconChain, openFolderDesktop, openFolderMobile });

  /* Mobile measures the viewport as it builds, so it waits for layout. */
  const buildLayout = () => {
    if (MOB) {
      document.body.classList.add('is-mob');
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          buildMobile();
          syncMobPages();
          goTo(restorePage(storeGet(PAGE_STORE), totalPages), null, false);
        }),
      );
    } else {
      document.body.classList.remove('is-mob');
      buildDesktop();
      goTo(restorePage(storeGet(PAGE_STORE), totalPages), null, false);
    }
  };
  buildLayout();

  /* Attached once, not per layout: the window can cross the breakpoint later,
     and a listener added on every crossing would fire twice. */
  document.addEventListener('keydown', e => {
    if (MOB) return;
    if (el('spot').classList.contains('on')) return;
    if (e.key === 'ArrowRight') goTo(pg + 1);
    if (e.key === 'ArrowLeft') goTo(pg - 1);
  });
  let _dMx = 0,
    _dDragging = false;
  document.addEventListener('mousedown', e => {
    _dMx = e.clientX;
    _dDragging = false;
  });
  document.addEventListener('mousemove', e => {
    if (Math.abs(e.clientX - _dMx) > 8) _dDragging = true;
  });
  document.addEventListener('mouseup', e => {
    if (MOB || !_dDragging) return;
    const dx = e.clientX - _dMx;
    if (Math.abs(dx) > 60) goTo(pg + (dx < 0 ? 1 : -1));
    _dDragging = false;
  });
  let _dTx = 0;
  document.addEventListener(
    'touchstart',
    e => {
      _dTx = e.touches[0].clientX;
    },
    { passive: true },
  );
  /* The mobile layout has its own swipe, in ui.js. Both would advance two
     pages for one gesture. */
  document.addEventListener(
    'touchend',
    e => {
      if (MOB) return;
      const dx = e.changedTouches[0].clientX - _dTx;
      if (Math.abs(dx) > 50) goTo(pg + (dx < 0 ? 1 : -1));
    },
    { passive: true },
  );

  applyBg();

  onLayoutChange(mobile => {
    MOB = mobile;
    buildLayout();
  }, MOB);

  /* The platform reports its safe-area insets after the first paint, and again after a
     rotation. The probe is sized by them, so its box changing is the signal
     that the space the layout was measured against has moved. */
  if (typeof ResizeObserver === 'function') {
    const probe = document.createElement('div');
    probe.className = 'sa-probe';
    document.body.appendChild(probe);
    let _sat,
      _saH = -1,
      _saFirst = true;
    new ResizeObserver(entries => {
      const h = entries[0].contentRect.height;
      if (h === _saH) return;
      _saH = h;
      /* Observing delivers the current size at once, and the layout being built
         now already has it. */
      if (_saFirst) {
        _saFirst = false;
        return;
      }
      clearTimeout(_sat);
      _sat = setTimeout(() => {
        if (MOB) buildLayout();
      }, 100);
    }).observe(probe);
  }

  /* A rotation that does not cross the breakpoint still changes how much fits,
     and the mobile layout is measured. Debounced, and only while it is the
     layout in use: on a phone the keyboard opening resizes the viewport too. */
  let _rt;
  window.addEventListener(
    'orientationchange',
    () => {
      clearTimeout(_rt);
      _rt = setTimeout(() => {
        if (MOB) buildLayout();
      }, 150);
    },
    { passive: true },
  );

  /* The desktop tile size follows the viewport, so a resize can change how many
     rows fit. Rebuild only when the slot count actually moves, not on every
     pixel: a rebuild tears down and remounts every widget iframe. */
  let _dz,
    _slots = desktopSlots();
  window.addEventListener('resize', () => {
    if (MOB) return;
    clearTimeout(_dz);
    _dz = setTimeout(() => {
      if (MOB) return;
      gm = gridMetrics();
      const slots = desktopSlots();
      if (slots === _slots) return;
      _slots = slots;
      buildDesktop();
      goTo(Math.min(pg, totalPages - 1), null, false);
    }, 200);
  });

  /* Jittered, so several open clients do not poll on the same tick. */
  let _pollTimers = [];
  const _repeat = (fn, base) => {
    let h;
    const tick = async () => {
      try {
        await fn();
      } catch {}
      h = setTimeout(tick, jitter(base));
    };
    h = setTimeout(tick, Math.round(Math.random() * base));
    _pollTimers.push(() => clearTimeout(h));
  };

  const pollConfig = async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) return;
      const c = await res.json();
      sanitizeItemLinks(c.items || []);
      if (configChanged({ items, settings: S, _rev }, c)) location.reload();
    } catch {}
  };

  const startPolling = () => {
    _repeat(pollBadges, 20_000);
    _repeat(pollHealth, 30_000);
    _repeat(pollConfig, 15_000);
  };

  const stopPolling = () => {
    _pollTimers.forEach(clear => clear());
    _pollTimers = [];
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      pollBadges();
      pollHealth();
      startPolling();
    }
  });

  pollBadges();
  pollHealth();
  startPolling();

  /* A settings change reloads the page, so this is read once. */
  if (S.keepAwake === true) startWakeLock();

  document.body.classList.add('ready');
}

boot();
