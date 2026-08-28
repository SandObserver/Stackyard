import { iconChain } from '/js/icons.js?v=69c2b9bd';
import { widgetSrc, cardPreset, uniqueTitle, WIDGET_DESIGN } from '/js/widget-types.js?v=6a5e1619';
import {
  mk,
  clr,
  mkWrap as _mkWrap,
  mountScaledWidget,
  teardownWidgets,
  el,
  q,
  qa,
  setUserText,
} from '/js/utils.js?v=b18c93ed';
import { t, currentLang } from '/js/i18n.js?v=d056c9c5';
import { trapFocus } from '/js/dialog.js?v=05935547';
import { mobileMetrics, gridColumnWidth, gridCellCount } from '/js/mobile-metrics.js?v=424d5d41';

let _state = null;
export function initUI(state) {
  _state = state;
}

const items = () => _state.items;
const S = () => _state.S;
const breg = (...a) => _state.breg(...a);
const bunreg = (...a) => _state.bunreg(...a);
const bupd = (...a) => _state.bupd(...a);
const BEL = () => _state.BEL;
const goTo = (...a) => _state.goTo(...a);
const CB = () => _state.CB;
const st = () => _state;
const widgetReg = () => _state?.widgetReg || Object.create(null);
const mkWrap = (item, sz, r, isz, cls) => _mkWrap(item, sz, r, isz, cls, breg);

/* A tap outside a widget lands in the parent document. Widgets expose
   window.__clearActive. */
function clearMobWidgets(exceptWin) {
  qa('.mob-widget-card iframe, .widget iframe').forEach(ifr => {
    try {
      const w = /** @type {HTMLIFrameElement} */ (ifr).contentWindow;
      if (w && w !== exceptWin && /** @type {any} */ (w).__clearActive) /** @type {any} */ (w).__clearActive();
    } catch {}
  });
}
/* A module-level guard, so a second import does not bind the listener twice. */
const _win = /** @type {any} */ (window);
if (!_win.__wActiveMsgBound) {
  _win.__wActiveMsgBound = true;
  window.addEventListener('message', e => {
    /* Widgets are same-origin iframes. Nothing else may drive the dashboard. */
    if (e.origin !== window.location.origin) return;
    if (e.data && e.data.type === 'widget-active') clearMobWidgets(e.source);
  });
}

function css(el, props) {
  for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v);
  return el;
}

function mkMiniIcon(child, pointerEvents) {
  const bg = mk('div');
  bg.className = 'folder-mini-bg';
  bg.style.background = clr(child.color);
  if (pointerEvents === 'none') bg.style.pointerEvents = 'none';
  if (child.iconUrl) {
    const srcs = iconChain(child.iconUrl);
    if (srcs.length) {
      const img = mk('img', { loading: 'lazy', draggable: false });
      img.className = 'folder-mini-img';
      if (pointerEvents === 'none') img.style.pointerEvents = 'none';
      let step = 0;
      img.onerror = () => {
        step++;
        if (step < srcs.length) img.src = srcs[step];
        else img.style.display = 'none';
      };
      img.src = srcs[0];
      bg.appendChild(img);
    } else {
      const s = mk('span');
      s.className = 'folder-mini-fb';
      if (pointerEvents === 'none') s.style.pointerEvents = 'none';
      s.textContent = (child.label || '?')[0].toUpperCase();
      bg.appendChild(s);
    }
  } else {
    const s = mk('span');
    s.className = 'folder-mini-fb';
    if (pointerEvents === 'none') s.style.pointerEvents = 'none';
    s.textContent = (child.label || '?')[0].toUpperCase();
    bg.appendChild(s);
  }
  return bg;
}

export function mkFolder(item) {
  const showLabel = S().showLabels?.desktop !== false;
  const iw = showLabel ? 72 : 78;
  const a = mk('a');
  a.className = 'icon';
  a.style.cursor = 'pointer';
  a.href = '#';
  a.setAttribute('role', 'button');
  a.setAttribute('aria-label', (item.label || t('type.folder')) + ' folder');
  if (!showLabel) a.title = item.label || t('type.folder');
  a.onclick = e => {
    e.preventDefault();
    openFolderDesktop(item);
  };
  const box = mk('div');
  box.className = 'dyn-folder-box';
  css(box, { '--iw': iw + 'px' });
  const wrap = mk('div');
  wrap.className = 'folder-icon-grid';
  const g = mk('div');
  g.className = 'folder-icon-grid-sheen';
  wrap.appendChild(g);
  (item.children || [])
    .slice(0, 9)
    .map(id => items().find(i => i.id === id))
    .filter(Boolean)
    .forEach(child => {
      const cell = mk('div');
      cell.className = 'folder-mini-cell';
      cell.appendChild(mkMiniIcon(child, null));
      wrap.appendChild(cell);
    });
  box.appendChild(wrap);
  const fb_ = mk('div');
  fb_.className = 'badge';
  box.appendChild(fb_);
  breg(item.id, fb_);
  a.appendChild(box);
  if (showLabel) {
    const l = mk('div');
    l.className = 'ilabel';
    l.style.width = iw + 12 + 'px';
    setUserText(l, item.label || t('type.folder'));
    a.appendChild(l);
  }
  return a;
}

let folderOverlay = null;
export function openFolderDesktop(folder) {
  if (folderOverlay) {
    folderOverlay.remove();
    folderOverlay = null;
    return;
  }
  const children = (folder.children || []).map(id => items().find(i => i.id === id)).filter(Boolean);
  const showLabel = S().showLabels?.desktop !== false;
  const ov = mk('div');
  ov.className = 'folder-overlay';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', (folder.label || t('type.folder')) + ' folder');
  ov.tabIndex = -1;
  const _prevFocus = /** @type {HTMLElement} */ (document.activeElement);
  let releaseDeskTrap = null;
  const outer = mk('div');
  outer.className = 'folder-outer';
  const title = mk('div');
  title.className = 'folder-title-desktop';
  setUserText(title, folder.label || t('type.folder'));
  const box = mk('div');
  box.className = 'folder-box-desktop';
  const iw = showLabel ? 72 : 78,
    isz = showLabel ? 50 : 56;
  const grid = mk('div');
  grid.className = 'dyn-grid';
  css(grid, { '--iw': iw + 'px' });
  children.forEach(child => {
    const a = mk('a', { href: child.href, target: '_blank', rel: 'noreferrer noopener' });
    a.className = 'folder-icon-link';
    a.style.width = iw + 'px';
    a.setAttribute('aria-label', child.label || child.id);
    if (!showLabel) a.title = child.label || child.id;
    a.onclick = () => {
      closeDesk();
    };
    a.appendChild(mkWrap(child, iw, 16, isz, 'iwrap'));
    if (showLabel) {
      const l = mk('div');
      l.className = 'ilabel';
      l.style.width = iw + 12 + 'px';
      setUserText(l, child.label || child.id);
      a.appendChild(l);
    }
    grid.appendChild(a);
  });
  box.appendChild(grid);
  const registeredBadges = [];
  children.forEach(c => bupd(c.id));
  qa('.badge', grid).forEach(el => registeredBadges.push(el));
  function closeDesk() {
    registeredBadges.forEach(el => BEL().forEach((_, id) => bunreg(id, el)));
    document.removeEventListener('keydown', escDesk);
    if (releaseDeskTrap) {
      releaseDeskTrap();
      releaseDeskTrap = null;
    }
    ov.remove();
    folderOverlay = null;
    if (_prevFocus && _prevFocus.focus) _prevFocus.focus();
  }
  ov.onclick = e => {
    if (e.target === ov) closeDesk();
  };
  const escDesk = e => {
    if (e.key === 'Escape') {
      closeDesk();
      document.removeEventListener('keydown', escDesk);
    }
  };
  document.addEventListener('keydown', escDesk);
  outer.append(title, box);
  ov.appendChild(outer);
  document.body.appendChild(ov);
  folderOverlay = ov;
  /* The dashboard behind stays focusable while covered, so the overlay needs a
     Tab trap. Attach it after the overlay is in the document. */
  releaseDeskTrap = trapFocus(ov, { closeOnEscape: false, onClose: closeDesk, initialFocus: ov });
}

function mFolder(item, cw, rh, isz, ir, im, sc) {
  const showLabel = S().showLabels?.ios === true;
  const eff = showLabel ? Math.round(isz * 0.85) : isz;
  const a = document.createElement('button');
  a.type = 'button';
  a.className = 'dyn-mob-btn';
  a.setAttribute('aria-label', (item.label || t('type.folder')) + ' folder');
  css(a, { '--rh': rh + 'px' });
  let _opening = false;
  function _openFolder() {
    if (_opening) return;
    _opening = true;
    setTimeout(() => {
      _opening = false;
    }, 500);
    openFolderMobile(item, isz, ir, im, sc);
  }
  let _tStarted = false,
    _tMoved = false,
    _tSX = 0,
    _tSY = 0;
  a.addEventListener(
    'touchstart',
    e => {
      e.preventDefault();
      _tStarted = true;
      _tMoved = false;
      _tSX = e.touches[0].clientX;
      _tSY = e.touches[0].clientY;
    },
    { passive: false },
  );
  a.addEventListener(
    'touchmove',
    e => {
      if (!_tStarted) return;
      if (Math.abs(e.touches[0].clientX - _tSX) > 10 || Math.abs(e.touches[0].clientY - _tSY) > 10) _tMoved = true;
    },
    { passive: true },
  );
  a.addEventListener(
    'touchend',
    e => {
      e.preventDefault();
      if (!_tStarted || _tMoved) {
        _tStarted = false;
        _tMoved = false;
        return;
      }
      _tStarted = false;
      _tMoved = false;
      _openFolder();
    },
    { passive: false },
  );
  a.onclick = () => _openFolder();
  const box = mk('div');
  box.className = 'dyn-sz dyn-box';
  css(box, { '--sz': eff + 'px' });
  box.style.pointerEvents = 'none';
  const wrap = mk('div');
  const pad = Math.round(eff * 0.1),
    gap = Math.round(eff * 0.04);
  wrap.className = 'dyn-fold-wrap';
  css(wrap, { '--br': Math.round(eff * 0.24) + 'px', '--gap': gap + 'px', '--pad': pad + 'px' });
  const sheen = mk('div');
  sheen.className = 'dyn-fold-sheen';
  wrap.appendChild(sheen);
  (item.children || [])
    .slice(0, 9)
    .map(id => items().find(i => i.id === id))
    .filter(Boolean)
    .forEach(child => {
      const cell = mk('div');
      cell.className = 'dyn-fold-cell';
      cell.appendChild(mkMiniIcon(child, 'none'));
      wrap.appendChild(cell);
    });
  box.appendChild(wrap);
  const fb_ = mk('div');
  fb_.className = 'badge';
  box.appendChild(fb_);
  breg(item.id, fb_);
  a.appendChild(box);
  if (showLabel) {
    const l = mk('div');
    l.className = 'dyn-fold-label';
    css(l, { '--lfs': Math.max(9, Math.round(9 * sc)) + 'px', '--lw': cw - 4 + 'px' });
    setUserText(l, item.label || t('type.folder'));
    a.appendChild(l);
  }
  return a;
}

let folderOverlayMob = null;
export function openFolderMobile(folder, isz, _ir, _im, sc) {
  if (folderOverlayMob) {
    folderOverlayMob.remove();
    folderOverlayMob = null;
  }
  const children = (folder.children || []).map(id => items().find(i => i.id === id)).filter(Boolean);
  const showLabel = S().showLabels?.ios === true;
  const pages = [];
  for (let i = 0; i < children.length; i += 9) pages.push(children.slice(i, i + 9));
  let curPage = 0;
  const vw = innerWidth,
    vh = innerHeight;
  const ov = mk('div');
  ov.className = 'folder-overlay-mobile';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-modal', 'true');
  ov.setAttribute('aria-label', (folder.label || t('type.folder')) + ' folder');
  ov.tabIndex = -1;

  let releaseMobTrap = null;
  function closeMob() {
    qa('.badge', ov).forEach(el => BEL().forEach((_, id) => bunreg(id, el)));
    if (releaseMobTrap) {
      releaseMobTrap();
      releaseMobTrap = null;
    }
    ov.remove();
    folderOverlayMob = null;
  }

  const ptScale = vw / 393;
  const margin = Math.round(34 * ptScale),
    boxW = vw - margin * 2;
  const padH = Math.round(20 * ptScale),
    padVT = Math.round(24 * ptScale),
    padVB = Math.round(22 * ptScale);
  const innerW = boxW - padH * 2,
    gap = Math.round(14 * ptScale);
  const folderIconW = Math.min(Math.floor((innerW - gap * 2) / 3), isz);
  const folderIr = Math.round(folderIconW * 0.22),
    folderIm = Math.round(folderIconW * 0.64);
  const gridInnerW = folderIconW * 3 + gap * 2,
    gridH = folderIconW * 3 + gap * 2;
  /* A badge sits 7px outside its icon corner. Without this inset the outer
     icons' badges cross into the next page and the viewport shows them. */
  const badgeOvh = Math.min(Math.ceil(7 * (sc || 1)), padH, padVT, padVB);
  const pageW = gridInnerW + badgeOvh * 2,
    pageH = gridH + badgeOvh * 2;
  const dotSz = Math.round(7 * ptScale);
  const dotsZoneH = pages.length > 1 ? Math.round(26 * ptScale) : 0;
  const boxH = padVT + gridH + padVB + dotsZoneH;
  const sbPx = Math.round(50 * ptScale),
    clearBottom = Math.round(165 * ptScale);
  const availH = vh - sbPx - clearBottom;
  const boxTop = Math.max(sbPx, Math.round(sbPx + (availH - boxH) / 2 + availH * 0.08));
  const boxR = Math.round(32 * ptScale);
  const titleFs = Math.round(30 * ptScale),
    titleGap = Math.round(40 * ptScale);
  const titleRendH = Math.ceil(titleFs * 1.05) + Math.round(4 * ptScale);
  const titleLeft = margin + padH + Math.round(6 * ptScale);

  const titleEl = mk('div');
  titleEl.className = 'folder-title-mobile dyn-title-mob';
  css(titleEl, {
    '--tfs': titleFs + 'px',
    left: titleLeft + 'px',
    width: boxW - padH + 'px',
    top: boxTop - titleRendH - titleGap + Math.round(8 * ptScale) + 'px',
  });
  setUserText(titleEl, folder.label || t('type.folder'));

  const box = mk('div');
  box.className = 'folder-box-mobile dyn-box-mob';
  css(box, {
    '--left': margin + 'px',
    '--bw': boxW + 'px',
    '--bh': boxH + 'px',
    '--top': boxTop + 'px',
    '--br': boxR + 'px',
    '--pt': padVT - badgeOvh + 'px',
    '--ph': padH - badgeOvh + 'px',
    '--pb': padVB - badgeOvh + 'px',
  });

  const clipW = mk('div');
  clipW.className = 'dyn-clip';
  css(clipW, { '--gw': pageW + 'px', '--gh': pageH + 'px' });
  const strip = mk('div');
  strip.className = 'dyn-strip';
  css(strip, { '--gh': pageH + 'px', width: pages.length * pageW + 'px' });

  let dotEls = [];
  function gotoPage(n) {
    curPage = Math.max(0, Math.min(pages.length - 1, n));
    strip.style.transform = strip.style.webkitTransform = `translateX(-${curPage * pageW}px)`;
    dotEls.forEach((d, j) => d.classList.toggle('on', j === curPage));
    /* A page that has scrolled off stays focusable, so Tab would leave the
       visible page for tiles nobody can see. */
    [...strip.children].forEach((page, j) => {
      if (j === curPage) page.removeAttribute('inert');
      else page.setAttribute('inert', '');
    });
  }

  function buildPage(apps) {
    const p = mk('div');
    p.className = 'dyn-page-grid';
    css(p, {
      '--gw': pageW + 'px',
      '--gh': pageH + 'px',
      '--gap': gap + 'px',
      '--fiw': folderIconW + 'px',
      '--ovh': badgeOvh + 'px',
    });
    for (let i = 0; i < 9; i++) {
      const child = apps[i];
      if (child) {
        const a = mk('a', { href: child.href, target: '_blank', rel: 'noreferrer noopener' });
        a.className = 'dyn-fold-anchor';
        a.setAttribute('aria-label', child.label || child.id);
        a.onclick = e => {
          e.stopPropagation();
          closeMob();
        };
        a.appendChild(mkWrap(child, folderIconW, folderIr, folderIm, 'iwrap'));
        if (showLabel) {
          const l = mk('div');
          l.className = 'dyn-fold-inner-label';
          css(l, { '--lfs': Math.max(11, Math.round(11 * ptScale)) + 'px', '--fiw': folderIconW + 'px' });
          setUserText(l, child.label || child.id);
          a.appendChild(l);
        }
        p.appendChild(a);
      } else {
        p.appendChild(mk('div'));
      }
    }
    return p;
  }

  let dotsEl = null;
  if (pages.length > 1) {
    dotsEl = mk('div');
    dotsEl.className = 'folder-dots dyn-dots-row';
    css(dotsEl, {
      padding: `${Math.max(0, Math.round(18 * ptScale) - badgeOvh)}px 0 ${Math.round(4 * ptScale)}px`,
      gap: Math.round(7 * ptScale) + 'px',
    });
    dotEls = pages.map((_, i) => {
      const d = mk('div');
      d.className = 'folder-dot dyn-dot';
      css(d, { '--dsz': dotSz + 'px' });
      d.onclick = () => gotoPage(i);
      return d;
    });
    dotEls.forEach(d => dotsEl.appendChild(d));
    gotoPage(0);
  }

  pages.forEach(pg => strip.appendChild(buildPage(pg)));
  clipW.appendChild(strip);
  box.appendChild(clipW);
  if (dotsEl) box.appendChild(dotsEl);
  children.forEach(c => bupd(c.id));

  let tx0 = 0,
    ty0 = 0,
    swiping = false;
  box.addEventListener(
    'touchstart',
    e => {
      tx0 = e.touches[0].clientX;
      ty0 = e.touches[0].clientY;
      swiping = false;
      e.stopPropagation();
    },
    { passive: false },
  );
  box.addEventListener(
    'touchmove',
    e => {
      const dx = Math.abs(e.touches[0].clientX - tx0),
        dy = Math.abs(e.touches[0].clientY - ty0);
      if (dx > dy && dx > 8) swiping = true;
      e.stopPropagation();
      e.preventDefault();
    },
    { passive: false },
  );
  box.addEventListener(
    'touchend',
    e => {
      e.stopPropagation();
      if (!swiping) return;
      swiping = false;
      const dx = e.changedTouches[0].clientX - tx0;
      if (Math.abs(dx) > Math.round(30 * ptScale)) gotoPage(curPage + (dx < 0 ? 1 : -1));
    },
    { passive: false },
  );
  ov.appendChild(titleEl);
  ov.appendChild(box);
  ov.addEventListener(
    'touchend',
    e => {
      const t = e.changedTouches[0],
        rb = box.getBoundingClientRect();
      if (t.clientX < rb.left || t.clientX > rb.right || t.clientY < rb.top || t.clientY > rb.bottom) {
        e.preventDefault();
        e.stopPropagation();
        closeMob();
      }
    },
    { passive: false },
  );
  document.body.appendChild(ov);
  folderOverlayMob = ov;
  releaseMobTrap = trapFocus(ov, { onClose: closeMob, initialFocus: ov });
}

/* Cells per widget size on the 4x6 home grid. */
const MOB_FOOTPRINT = { small: [2, 2], medium: [4, 2], large: [4, 4], xlarge: [4, 6] };

export function buildMobile() {
  /* The previous widgets' observers and timers outlive their DOM. Stop them
     before it is replaced. */
  teardownWidgets();
  st().BEL.clear();
  const vw = innerWidth,
    vh = innerHeight;
  const { sc, sm, dh, pillH, pillGap, dz } = mobileMetrics(vw);
  const gap = Math.round(sm * 0.5);
  css(document.body, {
    '--sc': String(sc),
    '--sm': sm + 'px',
    '--dh': dh + 'px',
    '--dz': dz + 'px',
    '--gap': gap + 'px',
    '--pgh': vh + 'px',
  });
  /* ── Mobile layout: single-pass grid bin-packing ──
     Footprints in cells: icon/folder 1×1, small 2×2, medium 4×2, large 4×4,
     xlarge 4×6. A footprint is a physical size, so it does not change with the
     column count: a wider box gets more columns, not larger widgets. */
  const strip = el('pages');
  strip.innerHTML = '';

  function mkPage() {
    const p = mk('div');
    p.className = 'mob-page';
    const g = mk('div');
    g.className = 'mob-grid';
    p.appendChild(g);
    return { page: p, grid: g };
  }

  /* Every size below comes from this box, so the safe-area insets reach the
     layout as the space the stylesheet already reserved. Reading the insets
     instead would take a value the platform has not reported yet. */
  const firstPage = mkPage();
  strip.appendChild(firstPage.page);
  const gridBox = firstPage.grid.getBoundingClientRect();
  const { cols: COLS, rows: ROWS } = gridCellCount({ gridW: gridBox.width, gridH: gridBox.height, sc });
  css(document.body, { '--mcols': String(COLS), '--mrows': String(ROWS) });
  const rh = gridBox.height / ROWS;
  const rh2 = (gridBox.height - gap * (ROWS - 1)) / ROWS; /* exact row height incl. gaps */
  /* One column width for the whole grid, narrow enough that every widget shape
     present fits its rows. Fitting each card to its own cell instead would make
     a card's width stop matching its column span, and two small widgets would
     no longer measure the same as one medium. */
  const cw2 = gridColumnWidth({
    gridW: gridBox.width,
    rowH: rh2,
    gap,
    cols: COLS,
    footprints: [
      ...new Set(
        items()
          .filter(i => i.type === 'widget' && !i.hidden)
          .map(i => i.widgetSize || 'medium'),
      ),
    ].map(sz => ({
      design: WIDGET_DESIGN[sz] || WIDGET_DESIGN.medium,
      span: MOB_FOOTPRINT[sz] || MOB_FOOTPRINT.medium,
    })),
  });
  const gridW = cw2 * COLS + gap * (COLS - 1);
  const cw = gridW / COLS;
  css(document.body, { '--mgw': Math.round(gridW) + 'px' });
  const maxIsz = Math.round(74 * sc);
  const isz = Math.round(Math.min(cw * 0.9, rh * 0.8, maxIsz));
  const ir = Math.round(isz * 0.225),
    im = Math.round(isz * 0.64);
  const dock = items()
    .filter(i => i.type === 'app' && i.dock && !i.hidden)
    .slice(0, 4);
  const showLabel = S().showLabels?.ios === true;
  /* The reference draws a 66 icon and a 28 widget corner, so a widget's corner
     is 0.424 of the icon it sits beside. */
  const wBR = Math.round(isz * 0.424);

  const fp = it => (it.type !== 'widget' ? [1, 1] : MOB_FOOTPRINT[it.widgetSize] || MOB_FOOTPRINT.medium);

  const inFolder = new Set(
    items()
      .filter(i => i.type === 'folder')
      .flatMap(f => f.children || [])
      .map(String),
  );
  const gridItems = items().filter(i => !i.dock && !i.hidden && !inFolder.has(String(i.id)));

  function packMobile(list) {
    const pages = [];
    let grid, placements;
    const newPage = () => {
      grid = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
      placements = [];
      pages.push(placements);
    };
    const fits = (r, c, w, h) => {
      if (c + w > COLS || r + h > ROWS) return false;
      for (let i = r; i < r + h; i++) for (let j = c; j < c + w; j++) if (grid[i][j]) return false;
      return true;
    };
    const mark = (r, c, w, h) => {
      for (let i = r; i < r + h; i++) for (let j = c; j < c + w; j++) grid[i][j] = true;
    };
    const tryPlace = (it, w, h) => {
      for (let r = 0; r <= ROWS - h; r++)
        for (let c = 0; c <= COLS - w; c++)
          if (fits(r, c, w, h)) {
            mark(r, c, w, h);
            placements.push({ item: it, c, r, w, h });
            return true;
          }
      return false;
    };
    newPage();
    for (const it of list) {
      const [w, h] = fp(it);
      if (!tryPlace(it, w, h)) {
        newPage();
        tryPlace(it, w, h);
      }
    }
    return pages;
  }
  const pages = packMobile(gridItems);

  /* Scoped to this build, so the names stay stable across a rebuild. */
  const usedWidgetTitles = new Set();
  function widgetTitle(item) {
    return uniqueTitle(item.label || widgetReg()[item.widgetType]?.label || t('type.widget'), usedWidgetTitles);
  }

  function mIcon(item) {
    const eff = showLabel ? Math.round(isz * 0.82) : isz;
    const er = Math.round(eff * 0.225),
      em = Math.round(eff * 0.64);
    const a =
      item.system === 'settings'
        ? mk('a', { href: '/admin/' })
        : mk('a', { href: item.href, target: '_blank', rel: 'noreferrer noopener' });
    a.className = 'dyn-mob-icon';
    a.setAttribute('aria-label', item.label || item.id);
    css(a, { '--cw': '100%', '--rh': rh2 + 'px' });
    a.appendChild(mkWrap(item, eff, er, em, ''));
    if (showLabel) {
      const l = mk('div');
      l.className = 'dyn-mob-label';
      css(l, { '--lfs': Math.max(9, Math.round(9 * sc)) + 'px', '--lw': '100%' });
      setUserText(l, item.label || item.id);
      a.appendChild(l);
    }
    return a;
  }

  function makeWidgetCard(item) {
    const card = mk('div');
    const sz = item.widgetSize || 'medium';
    const design = WIDGET_DESIGN[sz] || WIDGET_DESIGN.medium;
    const wtype = item.widgetType || '';
    card.className = 'mob-widget-card';
    if (wtype) card.dataset.wtype = wtype;
    const preset = cardPreset(item, _state.widgetReg);
    if (preset) card.dataset.card = preset;
    /* Same aspect as desktop, so the widget renders identically. */
    card.style.cssText =
      `aspect-ratio:${design[0]}/${design[1]};width:100%;max-width:100%;max-height:100%;` +
      `flex-shrink:0;border-radius:${wBR}px;overflow:hidden;position:relative;`;
    /* An iframe swallows the touch, so the home pager never sees the swipe
       without the transparent layer. */
    const overlayHref = item.url || item.href || item.widgetConfig?.scrutinyHref || item.widgetConfig?.linkUrl || null;
    mountScaledWidget(card, {
      src: widgetSrc(item, widgetReg(), { mobile: true, lang: currentLang() }),
      title: widgetTitle(item),
      design,
      iframeOpts: item.iframe,
      overlayHref,
      mobile: true,
      onSwipe: dir => goTo(st().pg + dir),
    });
    return card;
  }

  function makeIconEl(item) {
    return item.type === 'folder' ? mFolder(item, cw, rh2, isz, ir, im, sc) : mIcon(item);
  }

  pages.forEach((placements, i) => {
    /* The first page is already in the document: it is what was measured. */
    const { page, grid } = i === 0 ? firstPage : mkPage();
    placements.forEach(({ item, c, r, w, h }) => {
      const cell = mk('div');
      cell.className = 'mob-cell';
      css(cell, { 'grid-column': `${c + 1}/span ${w}`, 'grid-row': `${r + 1}/span ${h}` });
      cell.appendChild(item.type === 'widget' ? makeWidgetCard(item) : makeIconEl(item));
      grid.appendChild(cell);
    });
    if (i > 0) strip.appendChild(page);
  });
  /* Nothing was placed, so the measuring page would show as a blank first
     page. */
  if (!pages.length) firstPage.page.remove();

  const dw = el('dots');
  dw.style.cssText = 'display:none';
  dw.innerHTML = '';

  const dk = el('dock');
  dk.className = 'mdock';
  const maxDockW = vw - Math.round(18 * sc);
  const dockPad = Math.round(14 * sc);
  const dockIconSz = Math.round(Math.min(isz, ((maxDockW - Math.round(28 * sc)) / 4) * 0.85));
  const dockIr = Math.round(dockIconSz * 0.225),
    dockIm = Math.round(dockIconSz * 0.64);
  const dockGap = Math.round(9 * sc);
  /* Sized to what it holds, not to the window. The grid gains columns on a wide
     screen while the dock keeps four icons, and a stretched bar reads as empty
     rather than as a dock. */
  const dockContentW = dock.length
    ? dock.length * dockIconSz + (dock.length - 1) * Math.round(22 * sc) + dockPad * 2
    : maxDockW;
  const dockW = Math.min(maxDockW, dockContentW);
  dk.style.cssText = `position:fixed;left:50%;bottom:${dockGap}px;-webkit-transform:translateX(-50%);transform:translateX(-50%);width:${dockW}px;height:${dh}px;padding:0 ${dockPad}px;border-radius:${Math.round(44 * sc)}px;z-index:400;`;
  dk.innerHTML = '';
  dock.forEach(item => {
    const a = mk('a', { href: item.href, target: '_blank', rel: 'noreferrer noopener' });
    a.className = 'dyn-dock-icon';
    const nm = item.label || item.id;
    a.setAttribute('aria-label', nm);
    a.title = nm; /* dock icons never show a label */
    a.appendChild(mkWrap(item, dockIconSz, dockIr, dockIm, ''));
    dk.appendChild(a);
  });

  const pillSearchW = Math.round(96 * sc);
  const _pdotSz = Math.round(8 * sc),
    _pdotGap = Math.round(5 * sc),
    _pdotPad = Math.round(14 * sc);
  const pillDotsW = pages.length * (_pdotSz + _pdotGap) - _pdotGap + _pdotPad * 2;
  const pill = el('mob-search-pill');
  pill.style.cssText = `position:fixed;left:50%;bottom:${dockGap + dh + pillGap}px;-webkit-transform:translateX(-50%);transform:translateX(-50%);width:${pillSearchW}px;height:${pillH}px;display:-webkit-flex;display:flex;z-index:500;`;

  const pillNew = /** @type {HTMLElement} */ (pill.cloneNode(true));
  const pillNewDots = q('.msp-dots', pillNew);
  pillNewDots.innerHTML = '';
  const pillDotEls = pages.map((_, i) => {
    const d = document.createElement('div');
    d.className = 'msp-dot' + (i === 0 ? ' on' : '');
    pillNewDots.appendChild(d);
    return d;
  });
  pill.parentNode.replaceChild(pillNew, pill);
  pillNew.addEventListener(
    'touchend',
    e => {
      e.preventDefault();
      e.stopPropagation();
      if (CB().spotOpen) CB().spotOpen('');
    },
    { passive: false },
  );
  pillNew.onclick = () => {
    if (CB().spotOpen) CB().spotOpen('');
  };

  let _pillIdleTimer = null;
  function pillPaging(on) {
    pillNew.classList.toggle('paging', on);
    pillNew.style.width = (on ? pillDotsW : pillSearchW) + 'px';
  }
  function pillBump(newPg) {
    pillPaging(true);
    pillDotEls.forEach((d, i) => d.classList.toggle('on', i === newPg));
    clearTimeout(_pillIdleTimer);
    _pillIdleTimer = setTimeout(() => pillPaging(false), 1500);
  }
  CB().mobPillBump = pillBump;

  const { _mobTsCleanup, _mobTeCleanup } = st();
  if (_mobTsCleanup) document.removeEventListener('touchstart', _mobTsCleanup);
  if (_mobTeCleanup) document.removeEventListener('touchend', _mobTeCleanup);
  let tx = 0,
    txOpenedWithFolder = false;
  st()._mobTsCleanup = e => {
    tx = e.touches[0].clientX;
    txOpenedWithFolder = !!folderOverlayMob;
  };
  st()._mobTeCleanup = e => {
    clearMobWidgets(); /* tap on the home background dismisses any active sled */
    if (txOpenedWithFolder || folderOverlayMob) return;
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 40) goTo(st().pg + (dx < 0 ? 1 : -1));
  };
  document.addEventListener('touchstart', st()._mobTsCleanup, { passive: true });
  document.addEventListener('touchend', st()._mobTeCleanup, { passive: true });
}
