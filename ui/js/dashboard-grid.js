import { closeBadgePopover } from '/js/badge-popover.js?v=578d337c';
import { desktopCols, desktopPages } from '/js/dashboard-logic.js?v=b4828b62';
import { formatNumber } from '/js/format-number.js?v=263fa390';
import { currentLang, t } from '/js/i18n.js?v=82ba9da2';
import { DEFAULT_WIDGET_SIZE, DOCK_MAX } from '/js/limits.js?v=ff61256e';
import { closeFolders, mkFolder, resetMobileChrome } from '/js/ui.js?v=bc665c94';
import {
  mkWrap as _mkWrap,
  el,
  ICON_R,
  isDashboardEmpty,
  mk,
  renderEmptyState,
  setCentredText,
} from '/js/utils.js?v=457d9918';
import { mountScaledWidget, teardownWidgets } from '/js/widget-frame.js?v=8e76d79b';
import {
  cardPreset,
  fixedAppearance,
  uniqueTitle,
  WIDGET_COLS,
  WIDGET_DESIGN,
  WIDGET_HEIGHTS,
  WIDGET_ROWS,
  widgetSrc,
} from '/js/widget-types.js?v=afec2dab';

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

/** @param {any} i */
const inDock = i => i.type === 'app' && i.dock && !i.hidden;
/** @param {any[]} items */
const hasDock = items => items.some(inDock);

/** @param {{
      dash: import('/js/dashboard-state.js?v=51013727').DashboardState,
      badges: import('/js/dashboard-badges.js?v=a6f982e9').Badges,
      goTo: (i: number) => void,
    }} deps */
export function createDesktopGrid({ dash, badges, goTo }) {
  let gm = { tile: DESIGN_TILE, rowGap: DESIGN_ROW_GAP, cols: 6 };
  /* Reset per build: the names must stay stable across a rebuild. */
  let usedWidgetTitles = new Set();
  const mkWrap = (item, sz, r, isz, cls) => _mkWrap(item, sz, r, isz, cls, badges.breg);

  /* The reserves mirror the .page padding in dashboard.css. Change one and the
     page breaks stop matching the box. The bottom reserve clears the page dots,
     which sit above the dock.

     @param {boolean} dock */
  function desktopRows(dock) {
    const ih = innerHeight;
    const top = Math.min(70, Math.max(44, ih * 0.04));
    const bottom = dock ? 204 : 68;
    return Math.max(1, Math.min(4, Math.floor((ih - top - bottom + gm.rowGap) / (gm.tile + gm.rowGap))));
  }

  function paginate() {
    const { items } = dash;
    const inFolder = new Set(
      items
        .filter(i => i.type === 'folder')
        .flatMap(f => f.children || [])
        .map(String),
    );
    const rows = desktopRows(hasDock(items));
    const bare = isDashboardEmpty(items);
    const tiles = items.filter(
      item => !(bare && item.system) && !item.dock && !item.hidden && !inFolder.has(String(item.id)),
    );
    /** @returns {[number, number]} */
    const span = item => {
      if (item.type !== 'widget') return [1, 1];
      const sz = item.widgetSize || DEFAULT_WIDGET_SIZE;
      return [WIDGET_COLS.desktop[sz], WIDGET_ROWS.desktop[sz]];
    };
    return desktopPages(tiles, span, gm.cols, rows);
  }

  function mkIcon(item) {
    if (item.type === 'folder') return mkFolder(item);
    const showLabel = dash.S.showLabels?.desktop !== false;
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

  function widgetTitle(item) {
    return uniqueTitle(item.label || dash.widgetReg[item.widgetType]?.label || t('type.widget'), usedWidgetTitles);
  }
  function mkWidget(item) {
    const { widgetReg } = dash;
    const sz = item.widgetSize || DEFAULT_WIDGET_SIZE;
    const cell = mk('div');
    const rows = WIDGET_ROWS.desktop[sz];
    let cls = `wc c${WIDGET_COLS.desktop[sz]}`;
    if (rows >= 3) cls += ' r3';
    else if (rows >= 2) cls += ' r2';
    cell.className = cls;
    const card = mk('div');
    card.className = 'widget';
    if (item.widgetType) card.dataset.wtype = item.widgetType;
    const preset = cardPreset(item, widgetReg);
    if (preset) card.dataset.card = preset;
    if (fixedAppearance(item, widgetReg)) card.dataset.appearance = 'dark';
    const design = WIDGET_DESIGN[sz] || WIDGET_DESIGN.medium;
    if (rows >= 2) {
      card.style.minHeight = WIDGET_HEIGHTS[sz] + 'px';
      card.style.height = '100%';
    } else card.style.height = WIDGET_HEIGHTS[sz] + 'px';
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

  /** @returns {number} the page count */
  function buildDesktop() {
    const { items } = dash;
    /* Removing the DOM does not stop the observers and timers the previous
       widgets started. */
    closeFolders();
    teardownWidgets();
    closeBadgePopover();
    badges.BEL.clear();
    usedWidgetTitles = new Set();
    resetMobileChrome();
    /* Before paginate() and before any tile is built: both size against it. */
    measure();
    const dock = items.filter(inDock).slice(0, DOCK_MAX);
    document.body.classList.toggle('no-dock', !dock.length);
    const pages = paginate();
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
    return pages.length;
  }

  function measure() {
    gm = gridMetrics();
    document.documentElement.style.setProperty('--cols', String(gm.cols));
  }

  const slots = () => desktopRows(hasDock(dash.items)) * gm.cols;

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

  return { buildDesktop, measure, slots };
}

/** @typedef {ReturnType<typeof createDesktopGrid>} DesktopGrid */

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
