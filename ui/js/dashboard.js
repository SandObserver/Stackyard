import { loadLocalIcons, iconChain } from '/js/icons.js?v=5ac01d72';
import {
  WIDGET_HEIGHTS,
  WIDGET_DESIGN,
  WIDGET_COLS,
  WIDGET_ROWS,
  widgetSrc,
  cardPreset,
  fixedAppearance,
  uniqueTitle,
} from '/js/widget-types.js?v=b0e8f76d';
import {
  el,
  ICON_R,
  inertAllBut,
  isDashboardEmpty,
  loadImagesNow,
  mk,
  mkWrap as _mkWrap,
  mountScaledWidget,
  pageDir,
  renderEmptyState,
  q,
  qa,
  qi,
  scrollsSideways,
  setCentredText,
  storeGet,
  storeSet,
  teardownWidgets,
  rethemeTiles,
  titleWhenTruncated,
  within,
} from '/js/utils.js?v=14d4695d';
import { initFluidHover } from '/js/fluid-hover.js?v=eb6cc81c';
import { initSpotlight } from '/js/spotlight.js?v=e50cb331';
import { html, setHtml, raw } from '/js/html.js?v=c71f8903';
import { initI18n, isSupported, t, currentLang } from '/js/i18n.js?v=ed7c5565';
import { blockingScreenFor, showBlockingScreen } from '/js/config-recovery.js?v=c03e1465';
import { passwordMeter, passwordMismatch, contextWords, meterColor } from '/js/password-policy.js?v=0c0fd0af';
import { fillUsernames, wireReveal } from '/js/password-reveal.js?v=37f218b4';
import { setupErrorKey } from '/js/admin-error.js?v=0882cee9';
import { sanitizeItemLinks } from '/js/link-url.js?v=54adb40f';
import { DOCK_MAX } from '/js/limits.js?v=ea61a441';
import {
  initUI,
  mkFolder,
  openFolderDesktop,
  openFolderMobile,
  buildMobile,
  resetMobileChrome,
  mkFolderGlyph,
  swipePager,
} from '/js/ui.js?v=9d71ca16';
import {
  badgeMinimum,
  badgeSignature,
  computeBadgeVisual,
  folderLabelName,
  readBadgeUpdate,
} from '/js/badge-logic.js?v=6d99179d';
import { formatNumber } from '/js/format-number.js?v=abcd4ae4';
import { closeBadgePopover, wireBadgePopover } from '/js/badge-popover.js?v=652dd5df';
import { observeGlass } from '/js/glass-rim.js?v=3faec233';
import {
  configChanged,
  desktopCols,
  desktopPages,
  landingAfterSetup,
  restoreAction,
  restorePage,
  wheelPager,
} from '/js/dashboard-logic.js?v=3098e6b2';
import {
  applyBackground,
  BACKDROP,
  decoded,
  firstViewWait,
  rememberBackground,
  resolveBackground,
} from '/js/background.js?v=96567a38';
import { saveBootHint } from '/js/wallpaper-cache.js?v=cd968718';
import { creditPlacement, showPhotoCredit } from '/js/photo-credit.js?v=1801451c';
import { repeatJittered } from '/js/jitter.js?v=087a1fcf';
import { isMobileLayout, onLayoutChange } from '/js/layout.js?v=6680c0bf';
import { startWakeLock } from '/js/wake-lock.js?v=6b9591cf';
import {
  averageColor,
  applyLabelTones,
  loadSamplingImage,
  sampleImage,
  toneForColor,
} from '/js/label-contrast.js?v=7172d36f';
import { ensureSprite, iconSvg } from '/js/icon-set.js?v=b279fd98';
import { pageTheme, paletteColor } from '/js/palette.js?v=3fb8ae43';
import { THEME_KEY, applyTheme, prefersDark, readMode, resolveTheme } from '/js/theme.js?v=eeafa4b5';

ensureSprite();

if (!('GestureEvent' in window)) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport)
    viewport.setAttribute('content', `${viewport.getAttribute('content')},interactive-widget=resizes-content`);
}

/* Recomputed, never stored: the window can cross the breakpoint after load. */
let MOB = isMobileLayout(true);

const wCols = { d: WIDGET_COLS.desktop, m: WIDGET_COLS.mobile };
const wRows = { d: WIDGET_ROWS.desktop, m: WIDGET_ROWS.mobile };
const WH = { d: WIDGET_HEIGHTS };
/* A widget tile's corner, at design size. WIDGET_DESIGN's small is 170 square
   against the reference's 165, so this is its 28 unchanged. */
const WIDGET_R = 28;

/* The design values the stylesheet's --tile-h and --row-gap ratios were derived
   from. Read gridMetrics() for the live sizes; these are only the fallback. */
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
  const avail = document.createElement('b');
  probe.appendChild(avail);
  document.body.appendChild(probe);
  const tile = probe.getBoundingClientRect().height || DESIGN_TILE;
  const rowGap = gap.getBoundingClientRect().height || DESIGN_ROW_GAP;
  const width = avail.getBoundingClientRect().width || innerWidth;
  probe.remove();
  return { tile, rowGap, cols: desktopCols(width) };
}
let gm = { tile: DESIGN_TILE, rowGap: DESIGN_ROW_GAP, cols: 6 };

/* The reserves mirror the .page padding in dashboard.css. Change one and the
   page breaks stop matching the box. The bottom reserve clears the page dots,
   which sit above the dock.

   @param {boolean} hasDock */
function desktopRows(hasDock) {
  const ih = innerHeight;
  const top = Math.min(70, Math.max(44, ih * 0.04));
  const bottom = hasDock ? 204 : 68;
  return Math.max(1, Math.min(4, Math.floor((ih - top - bottom + gm.rowGap) / (gm.tile + gm.rowGap))));
}

const CB = { spotOpen: null, spotClose: null, mobPillBump: null, homeSwipe: null };

/* A touch produces a compatibility mouse event after it. */
const COMPAT_POINTER_MS = 500;
let _lastTouch = 0;

/* A backend that accepts the connection and never answers would otherwise leave
   the boot veil up forever. Generous: this only has to beat a hang. */
const BOOT_TIMEOUT_MS = 15000;

const PAGE_STORE = 'dash_page';
const LANG_STORE = 'dash_lang';

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
function breg(id, badge) {
  if (!BEL.has(id)) BEL.set(id, new Set());
  BEL.get(id).add(badge);
  /* Paint on registration. A poll only reaches ids it returns, so a fixed label
     alone stays invisible, and a rebuild blanks every badge until the next
     poll. */
  bupd(id);
}
function bunreg(id, badge) {
  if (BEL.has(id)) BEL.get(id).delete(badge);
}
function bupd(id) {
  const els = BEL.get(id);
  if (!els?.size) return;
  const item = items.find(i => i.id === id);
  const s = item?.type === 'folder' ? folderBadge(item) : badgeState[id] || {};
  const hideHealthy = S.server?.hideHealthyBadge !== false;
  const custom = item?.monitoring?.activity?.custom || {};
  const staticBdg = item?.monitoring?.staticBadge || {};
  const hasHC =
    S.server?.healthChecks !== false && !!(item?.monitoring?.healthcheck?.enabled || item?.container || item?.ping);

  const act = item?.monitoring?.activity || {};
  const isFolder = item?.type === 'folder';
  const { cls, txt, num, unit, bg, aria, color, nextColor, popover, rows } = computeBadgeVisual({
    health: s.health,
    activity: s.activity,
    activityStale: !!s.activityStale,
    labels: isFolder ? s.labels : act.combine ? undefined : act.labels,
    values: s.values,
    custom,
    staticBdg,
    hasHC,
    hideHealthy,
    badgesStale,
    healthStale,
    healthDetail: s.healthDetail,
    translate: t,
    format: formatNumber,
    palette: name => paletteColor(name, pageTheme()),
  });

  const sig = badgeSignature({ cls, txt, unit, bg, aria, color, nextColor, rows });

  els.forEach(badge => {
    /* Before the signature check. A badge first paints before its tile holds
       it, and an unchanged repaint would never name the tile. */
    const tile = /** @type {HTMLElement|null} */ (badge.closest('a, button, [role="button"]'));
    const tileName = tile?.dataset.tileName;
    if (tile && tileName) tile.setAttribute('aria-label', aria ? `${tileName}, ${aria}` : tileName);
    if (BSIG.get(badge) === sig) return;
    BSIG.set(badge, sig);
    BEXIT.get(badge)?.cancel();
    BEXIT.delete(badge);
    const leaving = badge.classList.contains('on') && !cls.split(' ').includes('on') && badge.isConnected;
    if (leaving) {
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const exit = badge.animate(
        still
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { opacity: 1, transform: 'translateZ(0)' },
              { opacity: 0, transform: 'translateZ(0) scale(.6)' },
            ],
        { duration: 150, easing: 'ease-in', fill: 'forwards' },
      );
      BEXIT.set(badge, exit);
      exit.onfinish = () => {
        BEXIT.delete(badge);
        paintBadge(badge, { cls, num, unit, bg, color, nextColor, popover, rows });
        exit.cancel();
      };
      return;
    }
    paintBadge(badge, { cls, num, unit, bg, color, nextColor, popover, rows });
  });
}

const BEXIT = new WeakMap();

function paintBadge(badge, { cls, num, unit, bg, color, nextColor, popover, rows }) {
  badge.className = cls;
  let txtEl = badge.firstElementChild;
  let unitEl = txtEl?.nextElementSibling;
  if (!txtEl) {
    txtEl = document.createElement('span');
    txtEl.className = 'badge-txt';
    unitEl = document.createElement('span');
    unitEl.className = 'badge-unit';
    badge.append(txtEl, unitEl);
  }
  txtEl.textContent = num;
  unitEl.textContent = unit ? ' ' + unit : '';
  /* The badge belongs to its tile's name, not to a live region of its own.
       An explicit label on the anchor wins over everything inside it, so a
       badge left to speak for itself is never reached by a reader moving from
       tile to tile. A name change is silent, which is what a figure on a timer
       needs. */
  badge.setAttribute('aria-hidden', 'true');
  badge.removeAttribute('role');
  badge.removeAttribute('aria-label');
  /* Never the `background` shorthand. It resets background-clip, and the
       pill behind is painted from this same value. */
  if (bg) badge.style.setProperty('--badge-bg', bg);
  else badge.style.removeProperty('--badge-bg');
  badge.style.color = color;
  if (nextColor) badge.style.setProperty('--badge-next', nextColor);
  else badge.style.removeProperty('--badge-next');
  /* No title attribute. The popover carries the reason, and a badge that can
       be hovered would otherwise draw the browser's own tooltip beside it.
       Removed rather than skipped: one set by an earlier paint would persist. */
  badge.removeAttribute('title');
  wireBadgePopover(badge, popover ? rows : null);
}

function bset(id, type, val) {
  if (!badgeState[id]) badgeState[id] = { health: 0, activity: 0 };
  badgeState[id][type] = val;
  bupd(id);
  items.filter(i => i.type === 'folder' && (i.children || []).includes(id)).forEach(f => bupd(f.id));
}
/** A folder's badge, from the badges of the apps inside it. A labelled child
    contributes its labels; the rest add into a total. */
function folderBadge(folder) {
  const children = (folder.children || []).map(id => items.find(i => i.id === id)).filter(Boolean);
  let actSum = 0,
    hasHealth = false,
    stale = false;
  const labels = [],
    values = [];
  for (const c of children) {
    const s = badgeState[c.id] || {};
    if (s.health) hasHealth = true;
    const ca = c.monitoring?.activity;
    if (s.activityStale) stale = true;
    const own = !ca?.combine && Array.isArray(ca?.labels) && ca.labels.length ? ca.labels : null;
    if (own && Array.isArray(s.values)) {
      own.forEach((l, n) => {
        if (!l || typeof l.path !== 'string' || !l.path) return;
        labels.push({ ...l, name: folderLabelName(c.label || c.id, l) });
        values.push(s.values[n]);
      });
      continue;
    }
    /* A child whose own count is below its minimum shows no badge, so it must
       not raise the folder's either. */
    if (s.activity >= badgeMinimum(ca?.custom)) actSum += s.activity;
  }
  return { health: hasHealth, activity: actSum, labels, values, activityStale: stale };
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
  const rows = desktopRows(items.some(i => i.type === 'app' && i.dock && !i.hidden));
  const bare = isDashboardEmpty(items);
  const tiles = items.filter(
    item => !(bare && item.system) && !item.dock && !item.hidden && !inFolder.has(String(item.id)),
  );
  /** @returns {[number, number]} */
  const span = item => {
    if (item.type !== 'widget') return [1, 1];
    const sz = item.widgetSize || 'medium';
    return [wCols[pl][sz], wRows[pl][sz]];
  };
  return desktopPages(tiles, span, gm.cols, rows);
}

function mkIcon(item) {
  if (item.type === 'folder') return mkFolder(item);
  const showLabel = S.showLabels?.desktop !== false;
  const iw = showLabel ? 72 : 78,
    isz = showLabel ? 50 : 56;
  const a =
    item.system === 'settings'
      ? mk('a', { href: '/admin/' })
      : mk('a', { href: item.href, target: '_blank', rel: 'noreferrer noopener' });
  a.className = 'icon';
  a.setAttribute('aria-label', item.label || item.id);
  a.dataset.tileName = item.label || item.id;
  if (!showLabel) a.title = item.label || item.id;
  a.appendChild(mkWrap(item, iw, Math.round(iw * ICON_R), isz, 'iwrap'));
  if (showLabel) {
    const l = mk('div');
    l.className = 'ilabel';
    l.style.width = iw + 12 + 'px';
    setCentredText(l, item.label || item.id);
    a.appendChild(l);
  }
  return a;
}

/* Reset per build: the names must stay stable across a rebuild. */
let usedWidgetTitles = new Set();
function widgetTitle(item) {
  return uniqueTitle(item.label || widgetReg[item.widgetType]?.label || t('type.widget'), usedWidgetTitles);
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
  if (fixedAppearance(item, widgetReg)) card.dataset.appearance = 'dark';
  const design = WIDGET_DESIGN[sz] || WIDGET_DESIGN.medium;
  if (wRows.d[sz] >= 2) {
    card.style.minHeight = WH.d[sz] + 'px';
    card.style.height = '100%';
  } else card.style.height = WH.d[sz] + 'px';
  card.style.borderRadius = WIDGET_R + 'px';
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
  a.dataset.tileName = item.label || item.id;
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
  d.setAttribute('aria-label', t('home.goToPage', { page: formatNumber(i + 1), total: formatNumber(total) }));
  if (i === current) d.setAttribute('aria-current', 'true');
  d.onclick = () => go(i);
  return d;
}

function buildDesktop() {
  /* Removing the DOM does not stop the observers and timers the previous
     widgets started. */
  teardownWidgets();
  closeBadgePopover();
  BEL.clear();
  usedWidgetTitles = new Set();
  resetMobileChrome();
  /* Before paginate() and before any tile is built: both size against it. */
  gm = gridMetrics();
  document.documentElement.style.setProperty('--cols', String(gm.cols));
  const dock = items.filter(i => i.type === 'app' && i.dock && !i.hidden).slice(0, DOCK_MAX);
  document.body.classList.toggle('no-dock', !dock.length);
  const pages = paginate();
  totalPages = pages.length;
  const strip = el('pages');
  strip.replaceChildren();
  pages.forEach(pageItems => {
    const p = mk('div');
    p.className = 'page';
    const g = mk('div');
    g.className = 'grid';
    for (const item of pageItems) g.appendChild(item.type === 'widget' ? mkWidget(item) : mkIcon(item));
    p.appendChild(g);
    strip.appendChild(p);
  });
  renderEmptyState(items);
  const dots = el('dots');
  dots.style.cssText = '';
  dots.replaceChildren();
  pages.forEach((_, i) => dots.appendChild(mkDot(i, pages.length, 0, goTo)));
  dots.hidden = pages.length < 2;
  const dk = el('dock');
  dk.replaceChildren();
  dock.forEach(item => dk.appendChild(mkDock(item)));
  dk.hidden = !dock.length;
  observeGlass(dk, 38, 0.6);
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
  live.textContent = t('home.pageAnnounce', { page: formatNumber(index + 1), total: formatNumber(total) });
}

/* A page that has scrolled off is still in the DOM and still focusable, so Tab
   walks out of the visible page into tiles nobody can see and the pager does
   not follow. inert takes them out of the tab order and the accessibility tree
   together. */
/** @param {number} current */
function syncPageInert(current) {
  const strip = el('pages');
  if (strip) inertAllBut(strip, current);
}

function goTo(n, dotEls, announce = true) {
  const total = dotEls ? dotEls.length : totalPages;
  const was = pg;
  pg = Math.max(0, Math.min(total - 1, n));
  if (pg !== was && announce) announcePage(pg, total);
  if (_stateRef) _stateRef.pg = pg;
  storeSet(PAGE_STORE, String(pg));
  const strip = el('pages');
  syncPageInert(pg);
  const shift = `translateX(${-pageDir() * pg * 100}vw)`;
  strip.style.transform = strip.style.webkitTransform = shift;
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
  syncPager(total);
  applyPollRates();
}

/** @param {number} total */
function syncPager(total) {
  const pager = /** @type {HTMLInputElement|null} */ (el('mob-pager'));
  if (!pager) return;
  pager.hidden = !MOB || total < 2;
  pager.max = String(Math.max(1, total));
  pager.value = String(pg + 1);
  pager.setAttribute(
    'aria-valuetext',
    t('home.pageAnnounce', { page: formatNumber(pg + 1), total: formatNumber(total) }),
  );
}

/* ensureSpace can create overflow pages paginate() did not report, so sync the
   dots from the DOM. */
function syncMobPages() {
  const strip = el('pages');
  const domCount = strip ? strip.children.length : 0;
  if (domCount <= totalPages) return; /* no overflow pages, nothing to fix */
  totalPages = domCount;
  const dots = el('dots');
  dots.replaceChildren();
  for (let i = 0; i < domCount; i++) dots.appendChild(mkDot(i, domCount, pg, goTo));
  dots.hidden = domCount < 2;
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

/* Matches --bg-base in tokens.css. It shows wherever a fitted wallpaper does
   not reach. */

/* A sampled wallpaper grid, or one tone for a solid colour. Null on both leaves
   the labels as they are. */
let bgTone = { grid: null, tone: null };

const CREDIT_EDGE = 20;

function placeCredit() {
  const credit = el('photo-credit');
  if (!credit || credit.hidden) return;
  if (document.body.classList.contains('is-mob')) {
    credit.removeAttribute('data-place');
    credit.style.removeProperty('max-width');
    return;
  }
  const dock = document.body.classList.contains('no-dock') ? null : el('dock').getBoundingClientRect();
  const { place, maxWidth } = creditPlacement(
    window.innerWidth,
    dock,
    document.documentElement.dir === 'rtl',
    CREDIT_EDGE,
  );
  credit.dataset.place = place;
  credit.style.maxWidth = `${maxWidth}px`;
}

function retone() {
  requestAnimationFrame(() => {
    placeCredit();
    applyLabelTones(bgTone);
    /* Same frame: both need the layout the build produced, and both re-run on a
       rebuild and a resize for the same reason. */
    titleWhenTruncated();
  });
}

/* Held so a resize re-samples without fetching the image again. */
let _bgSample = null;

async function sampleWallpaper(url, brightness, fit, call) {
  const img = await loadSamplingImage(url);
  if (call !== _bgCall) return;
  _bgSample = img ? { img, brightness, fit } : null;
  resampleBg();
  if (img) saveBootHint({ color: averageColor(img, brightness) });
}

/* The wallpaper is sized against the viewport, so a resize moves which part of
   it each label sits on. */
const themeTone = () => (pageTheme() === 'light' ? 'dark' : 'light');

function resampleBg() {
  if (!_bgSample) return retone();
  bgTone = {
    grid: sampleImage(
      _bgSample.img,
      window.innerWidth,
      window.innerHeight,
      _bgSample.brightness,
      _bgSample.fit,
      BACKDROP,
    ),
    tone: themeTone(),
  };
  retone();
}

let _shownWallpaper = '';
let _bgCall = 0;

function liftVeil() {
  document.body.classList.add('ready');
}

function showApiDown() {
  if (document.body.classList.contains('api-down')) return;
  document.documentElement.style.removeProperty('--boot-bg');
  const msg = document.createElement('div');
  msg.className = 'api-error-screen';
  msg.setAttribute('role', 'alert');
  setHtml(
    msg,
    html`<h2 class="api-error-title">${t('home.apiDownTitle')}</h2><p class="api-error-sub">${t('home.apiDownSub')}</p><button class="api-error-btn" type="button">${t('home.retry')}</button>`,
  );
  /* Not an inline onclick. The page's CSP refuses those. */
  msg.querySelector('.api-error-btn')?.addEventListener('click', () => location.reload());
  for (const child of document.body.children) /** @type {HTMLElement} */ (child).inert = true;
  document.body.classList.add('api-down');
  document.body.appendChild(msg);
}

/** @param {HTMLElement} root @param {any} bg @param {number} call */
async function showWallpaper(root, bg, call) {
  const prev = _shownWallpaper;
  await decoded(bg.url);
  if (call !== _bgCall) return;
  _shownWallpaper = bg.url;
  const style = root.style;
  if (prev) {
    for (const k of ['image', 'size', 'brightness'])
      style.setProperty(`--bg-prev-${k}`, style.getPropertyValue(`--bg-${k}`));
  }
  applyBackground(root, bg);
  root.classList.remove('wall-in', 'wall-swap');
  if (!prev && !document.body.classList.contains('ready')) return;
  const cls = prev ? 'wall-swap' : 'wall-in';
  void root.offsetWidth;
  root.classList.add(cls);
  if (prev) setTimeout(() => root.classList.remove('wall-swap'), 450);
}

async function applyBg() {
  const call = ++_bgCall;
  const root = document.documentElement;
  bgTone = { grid: null, tone: themeTone() };
  retone();
  let bg = null;
  try {
    bg = await resolveBackground(S.background || {});
  } catch {}
  if (call !== _bgCall) return;
  if (!bg) {
    root.style.removeProperty('--boot-bg');
    if (_shownWallpaper) return resampleBg();
    rememberBackground(S.background, null);
    showPhotoCredit(el('photo-credit'), null);
    return;
  }
  rememberBackground(S.background, bg);
  showPhotoCredit(el('photo-credit'), bg.credit ?? null);
  if (bg.url && bg.url !== _shownWallpaper) await showWallpaper(root, bg, call);
  else applyBackground(root, bg);
  if (call !== _bgCall) return;
  if (bg.url) {
    sampleWallpaper(bg.url, Number(bg.brightness), bg.fit, call);
    return;
  }
  bgTone = { grid: null, tone: toneForColor(bg.color) ?? themeTone() };
  retone();
}

function refreshBadges() {
  for (const id of BEL.keys()) bupd(id);
}
async function pollBadges() {
  try {
    const res = await fetch('/api/badges', { cache: 'no-store' });
    if (!res.ok) throw new Error(`badges ${res.status}`);
    const d = await res.json();
    for (const [id, v] of Object.entries(d)) {
      const { value, failed } = readBadgeUpdate(v);
      /* A failed item keeps its last value, marked stale. Overwriting it with
         zero reads as "nothing pending", which is not what happened. */
      bset(id, 'activityStale', failed);
      if (!failed) {
        bset(id, 'values', Array.isArray(v?.values) ? v.values.map(Number) : null);
        bset(id, 'activity', value);
      }
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
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) throw new Error(`health ${res.status}`);
    const d = await res.json();
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

const EYE = iconSvg('eye', 18);

function showSetupPrompt() {
  return new Promise(resolve => {
    const ov = /** @type {HTMLDialogElement} */ (document.createElement('dialog'));
    ov.className = 'setup-prompt';
    ov.setAttribute('aria-labelledby', 'setup-title');
    setHtml(
      ov,
      html`<form class="setup-card" method="post" novalidate><input type="text" name="username" autocomplete="username" hidden><p id="setup-title" class="setup-title">${t('setup.title')}</p><p class="setup-sub">${t('setup.sub')}</p><div class="setup-field"><input id="setup-pw" type="password" placeholder="${t('setup.newPassword')}" aria-label="${t('setup.newPassword')}" aria-describedby="setup-hint" autocomplete="new-password" class="setup-pw"><button id="setup-reveal" type="button" class="setup-reveal" aria-pressed="false" aria-label="${t('common.showPassword')}" title="${t('common.showPassword')}">${raw(EYE)}</button></div><input id="setup-pw2" type="password" placeholder="${t('setup.confirmPassword')}" aria-label="${t('setup.confirmPassword')}" autocomplete="new-password" class="setup-pw"><div id="setup-bars" class="setup-bars" aria-hidden="true"><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span><span class="pwbar"></span></div><div id="setup-hint" class="setup-hint" role="status"></div><div id="setup-err" class="setup-err" role="alert"></div><div class="setup-btns"><button id="setup-skip" type="button" class="setup-btn setup-btn-skip">${t('setup.skip')}</button><button id="setup-set" type="submit" class="setup-btn setup-btn-set" disabled>${t('setup.set')}</button></div></form>`,
    );
    const pw = qi('#setup-pw', ov);
    const pw2 = qi('#setup-pw2', ov);
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
      setB.disabled = !ok || !matches();
    };
    pw.addEventListener('input', sync);
    pw2.addEventListener('input', sync);

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
      const to = landingAfterSetup(items);
      if (to) {
        location.href = to;
        return;
      }
      close();
    };

    async function doSet() {
      if (!passwordMeter(pw.value, words).ok || !matches()) return;
      setB.disabled = true;
      skip.disabled = true;
      err.style.display = 'none';
      try {
        const r = await fetch('/api/auth/set-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw.value }),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => null);
          throw Object.assign(new Error(`HTTP ${r.status}`), { kind: body?.kind, code: body?.code });
        }
        const to = landingAfterSetup(items);
        if (to) location.href = to;
        else location.reload();
      } catch (e) {
        err.textContent = t(setupErrorKey(e));
        err.style.display = 'block';
        setB.disabled = false;
        skip.disabled = false;
      }
    }
    q('form', ov).addEventListener('submit', e => {
      e.preventDefault();
      if (!setB.disabled) doSet();
    });
    pw.focus();
  });
}

async function boot() {
  const settled = p =>
    p.then(
      v => ({ v }),
      e => ({ e }),
    );
  const configReq = settled(fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(BOOT_TIMEOUT_MS) }));
  const loadWidgets = () =>
    settled(
      fetch('/api/widgets', { cache: 'no-store' }).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    );
  let widgetsReq = loadWidgets();
  const iconsReq = loadLocalIcons();

  let authData = null;
  try {
    const authCheck = await fetch('/api/auth/check', {
      cache: 'no-store',
      signal: AbortSignal.timeout(BOOT_TIMEOUT_MS),
    });
    if (authCheck.status === 401) {
      window.location.href = '/admin/';
      return;
    }
    authData = await authCheck.json();
    const screen = authCheck.ok ? null : blockingScreenFor(authData);
    if (screen) {
      await showBlockingScreen(screen);
      return;
    }
    if (authData.enabled && !authData.authenticated) {
      window.location.href = '/admin/';
      return;
    }
  } catch {
    /* API down, handled below */
  }

  let apiFailed = false;
  try {
    const got = await configReq;
    if (got.e) throw got.e;
    const res = got.v;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const c = await res.json();
    /* Saving rejects these, but a config written earlier still reaches here.
       See ui/js/link-url.js. */
    items = sanitizeItemLinks(c.items || []);
    S = c.settings || {};
    _rev = c._rev ?? null;
    storeSet(LANG_STORE, await initI18n(S.language || 'en'));
    saveBootHint({ lang: currentLang() });
  } catch (e) {
    console.error('[boot]', e);
    apiFailed = true;
  }

  await iconsReq;

  /* Without the list every widget renders as a blank frame. */
  if (!apiFailed && (await widgetsReq).e) widgetsReq = loadWidgets();
  if (!apiFailed && (await widgetsReq).e) {
    console.error('[boot]', (await widgetsReq).e);
    apiFailed = true;
  }

  if (apiFailed) {
    /* The catalog is loaded as the last step of the fetch that just failed, so
       without this the only screen left renders its own keys. nginx serves this
       file, the API served the config, so it is still reachable. */
    const lastLang = storeGet(LANG_STORE);
    await initI18n(isSupported(lastLang) ? lastLang : 'en');
    showApiDown();
    liftVeil();
    return;
  }

  if (authData && !authData.setupPrompted && !authData.passwordSet) {
    await showSetupPrompt();
    /* A password set in the prompt refuses a request that was still open. */
    if ((await widgetsReq).e) widgetsReq = loadWidgets();
  }

  widgetReg = Object.create(null);
  const wr = (await widgetsReq).v;
  for (const w of Array.isArray(wr?.widgets) ? wr.widgets : []) if (w && w.name) widgetReg[w.name] = w;

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
  initFluidHover();
  initSpotlight({
    getItems: () => items,
    isMob: () => MOB,
    typeToOpen: () => S.typeToSearch !== false,
    CB,
    iconChain,
    openFolderDesktop,
    openFolderMobile,
    folderGlyph: mkFolderGlyph,
  });

  /* One rotation fires several of the events below. Rebuild only when the
     space moved since the last build: each rebuild reloads every widget. */
  let _mw = innerWidth;
  let _saAt = '';
  /** @type {HTMLElement|null} */
  let saProbe = null;
  const saSize = () => {
    if (!saProbe) return '';
    const r = saProbe.getBoundingClientRect();
    return `${r.width}x${r.height}`;
  };
  const spaceMoved = () => innerWidth !== _mw || saSize() !== _saAt;
  /* Mobile measures the viewport as it builds, so it waits for layout. */
  const loadVisibleIcons = () => {
    loadImagesNow(el('dock'));
    loadImagesNow(el('pages').children[pg]);
  };
  /** @type {() => void} */
  let firstBuilt = () => {};
  const firstBuild = new Promise(resolve => {
    firstBuilt = () => resolve(undefined);
  });
  const buildLayout = () => {
    _mw = innerWidth;
    _saAt = saSize();
    if (MOB) {
      document.body.classList.add('is-mob');
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          buildMobile();
          syncMobPages();
          goTo(restorePage(storeGet(PAGE_STORE), totalPages), null, false);
          loadVisibleIcons();
          retone();
          firstBuilt();
        }),
      );
    } else {
      document.body.classList.remove('is-mob');
      buildDesktop();
      goTo(restorePage(storeGet(PAGE_STORE), totalPages), null, false);
      loadVisibleIcons();
      retone();
      firstBuilt();
    }
  };
  buildLayout();

  if (S.background?.type === 'unsplash') screen.orientation?.addEventListener('change', applyBg);

  /* Attached once, not per layout: the window can cross the breakpoint later,
     and a listener added on every crossing would fire twice. */
  /* A pointer or a key must reach the pager on both layouts. The phone layout is
     what a narrow window gets, and there its own swipe is the only pager, so a
     mouse and a keyboard cannot leave page one. */
  const pager = /** @type {HTMLInputElement} */ (el('mob-pager'));
  pager.addEventListener('input', () => goTo(Number(pager.value) - 1, null, false));
  document.addEventListener('keydown', e => {
    if (e.target === pager) return;
    if (el('spot').hasAttribute('open')) return;
    /* The overlay covers the page it would scroll behind. */
    if (document.querySelector('.folder-overlay[open]')) return;
    if (e.key === 'ArrowRight') goTo(pg + pageDir());
    if (e.key === 'ArrowLeft') goTo(pg - pageDir());
  });
  /* A trackpad swipe or a thumb wheel turns one page per gesture. Widget frames
     hand their wheel to the card, so this also runs over widgets. */
  const wheelStep = wheelPager();
  document.addEventListener(
    'wheel',
    e => {
      if (e.ctrlKey) return;
      if (el('spot').hasAttribute('open')) return;
      if (document.querySelector('.folder-overlay[open], .folder-overlay-mobile[open]')) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
      const dx = e.deltaX * unit,
        dy = e.deltaY * unit;
      if (Math.abs(dx) <= Math.abs(dy) || scrollsSideways(e.target, dx)) return;
      /* Unhandled, a sideways swipe is the browser's back and forward gesture. */
      e.preventDefault();
      const step = wheelStep(dx, dy, e.timeStamp);
      if (step) goTo(pg + step * pageDir());
    },
    { passive: false },
  );
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
    if (!_dDragging) return;
    _dDragging = false;
    /* A swipe is followed by a compatibility mouse event. Acting on both pages
       twice for one gesture. */
    if (Date.now() - _lastTouch < COMPAT_POINTER_MS) return;
    const dx = e.clientX - _dMx;
    if (Math.abs(dx) > 60) goTo(pg + (dx < 0 ? 1 : -1) * pageDir());
  });
  document.addEventListener(
    'touchstart',
    () => {
      _lastTouch = Date.now();
    },
    { passive: true },
  );
  document.addEventListener(
    'touchend',
    () => {
      _lastTouch = Date.now();
    },
    { passive: true },
  );
  const strip = el('pages');
  CB.homeSwipe = swipePager(document, strip, {
    width: () => innerWidth,
    page: () => pg,
    total: () => strip.children.length,
    turn: n => goTo(n),
    enabled: () =>
      !el('spot').hasAttribute('open') &&
      !document.querySelector('.folder-overlay[open], .folder-overlay-mobile[open]'),
  });

  const wallpaperShown = applyBg();

  const retheme = () => {
    applyTheme(resolveTheme(readMode(), prefersDark()));
    rethemeTiles();
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        /** @type {any} */ (frame.contentWindow)?.__applyHostTheme?.();
      } catch {
        /* A cross-origin page keeps its own theme. */
      }
    }
    refreshBadges();
    applyBg();
  };
  let themeWaits = false;
  const onTheme = () => {
    /* A hidden page skips a view transition. Run it when the page is seen. */
    if (document.hidden) {
      if (themeWaits) return;
      themeWaits = true;
      document.addEventListener(
        'visibilitychange',
        () => {
          themeWaits = false;
          onTheme();
        },
        { once: true },
      );
      return;
    }
    const doc = /** @type {any} */ (document);
    if (typeof doc.startViewTransition === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches)
      doc.startViewTransition(retheme);
    else retheme();
  };
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (readMode() === 'system') onTheme();
    });
  } catch {}
  window.addEventListener('storage', e => {
    if (e.key === THEME_KEY) onTheme();
  });

  onLayoutChange(
    mobile => {
      MOB = mobile;
      buildLayout();
    },
    MOB,
    true,
  );

  /* The platform reports its safe-area insets after the first paint, and again after a
     rotation. The probe is sized by them, so its box changing is the signal
     that the space the layout was measured against has moved. */
  if (typeof ResizeObserver === 'function') {
    const probe = document.createElement('div');
    probe.className = 'sa-probe';
    document.body.appendChild(probe);
    saProbe = probe;
    let _sat,
      _saH = -1,
      _saW = -1,
      _saFirst = true;
    new ResizeObserver(entries => {
      const { width: w, height: h } = entries[0].contentRect;
      if (h === _saH && w === _saW) return;
      _saH = h;
      _saW = w;
      /* Observing delivers the current size at once, and the layout being built
         now already has it. */
      if (_saFirst) {
        _saFirst = false;
        return;
      }
      clearTimeout(_sat);
      _sat = setTimeout(() => {
        if (MOB && spaceMoved()) buildLayout();
      }, 100);
    }).observe(probe);
  }

  /* A rotation that does not cross the breakpoint still changes how much fits,
     and the mobile layout is measured. Debounced, and only while it is the
     layout in use: on a phone the keyboard opening resizes the viewport too. */
  let _rt;
  screen.orientation.addEventListener('change', () => {
    clearTimeout(_rt);
    _rt = setTimeout(() => {
      if (MOB && spaceMoved()) buildLayout();
      resampleBg();
    }, 150);
  });

  /* The desktop tile size follows the viewport, so a resize can change how many
     rows fit. Rebuild only when the slot count actually moves, not on every
     pixel: a rebuild tears down and remounts every widget iframe. */
  const hasDock = () => items.some(i => i.type === 'app' && i.dock && !i.hidden);
  let _dz,
    _slots = desktopRows(hasDock()) * gm.cols;
  /* The phone layout rebuilds on a width change only. A phone keyboard changes
     the height, and a rebuild then would close it. */
  let _rs;
  window.addEventListener('resize', () => {
    clearTimeout(_rs);
    _rs = setTimeout(() => {
      resampleBg();
      if (MOB && innerWidth !== _mw) buildLayout();
    }, 200);
    if (MOB) return;
    clearTimeout(_dz);
    _dz = setTimeout(() => {
      if (MOB) return;
      gm = gridMetrics();
      document.documentElement.style.setProperty('--cols', String(gm.cols));
      const slots = desktopRows(hasDock()) * gm.cols;
      if (slots === _slots) return;
      _slots = slots;
      buildDesktop();
      goTo(Math.min(pg, totalPages - 1), null, false);
      retone();
    }, 200);
  });

  /* Jittered, so several open clients do not poll on the same tick. */
  let _pollTimers = [];
  const _repeat = (fn, base) => _pollTimers.push(repeatJittered(fn, base));

  /** @param {any} c a fetched config */
  const differs = c => {
    sanitizeItemLinks(c.items || []);
    return configChanged({ items, settings: S, _rev }, c);
  };

  const pollConfig = async () => {
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (!res.ok) return;
      if (differs(await res.json())) location.reload();
    } catch {}
  };

  const stopPolling = () => {
    _pollTimers.forEach(clear => clear());
    _pollTimers = [];
  };

  /* A tab that boots hidden starts here and again when first shown. */
  const startPolling = () => {
    stopPolling();
    _repeat(pollBadges, 20_000);
    _repeat(pollHealth, 30_000);
    _repeat(pollConfig, 15_000);
  };

  /* Keep. Without it Safari leaves the tile scaled after a new tab opens. */
  document.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    const a = e.target.closest(
      'a[target="_blank"]:is(.icon, .di, .folder-icon-link, .dyn-mob-icon, .dyn-dock-icon, .dyn-fold-anchor)',
    );
    if (!a) return;
    a.classList.add('settled');
    a.addEventListener('pointerleave', () => a.classList.remove('settled'), { once: true });
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      pollBadges();
      pollHealth();
      startPolling();
    }
  });

  /* Keep the veil until both checks finish. A restored page holds its old
     contents, including after a sign-out. */
  window.addEventListener('pagehide', e => {
    if (e.persisted) document.body.classList.remove('ready');
  });
  window.addEventListener('pageshow', async e => {
    if (!e.persisted) return;
    const signal = AbortSignal.timeout(BOOT_TIMEOUT_MS);
    /** @param {string} url @returns {Promise<import('/js/dashboard-logic.js?v=3098e6b2').RestoreCheck>} */
    const check = async url => {
      try {
        const r = await fetch(url, { cache: 'no-store', redirect: 'manual', signal });
        return { status: r.status, body: r.ok ? await r.json().catch(() => undefined) : undefined };
      } catch {
        return null;
      }
    };
    const [auth, config] = await Promise.all([check('/api/auth/check'), check('/api/config')]);
    const action = restoreAction(auth, config, differs);
    if (action === 'reload' || (action === 'show' && document.body.classList.contains('api-down'))) {
      location.reload();
      return;
    }
    if (action === 'offline') {
      showApiDown();
      return;
    }
    pollBadges();
    pollHealth();
    startPolling();
    liftVeil();
  });

  pollBadges();
  pollHealth();
  startPolling();

  /* A settings change reloads the page, so this is read once. */
  if (S.keepAwake === true) startWakeLock();

  await within(
    firstBuild.then(() => wallpaperShown),
    firstViewWait(),
  );
  liftVeil();
}

boot();
