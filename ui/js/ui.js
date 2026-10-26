import { iconChain } from '/js/icons.js?v=5ac01d72';
import { widgetSrc, cardPreset, fixedAppearance, uniqueTitle, WIDGET_DESIGN } from '/js/widget-types.js?v=b0e8f76d';
import {
  mk,
  clr,
  inertAllBut,
  initial,
  isDashboardEmpty,
  renderEmptyState,
  mkWrap as _mkWrap,
  ICON_R,
  mountScaledWidget,
  pageDir,
  teardownWidgets,
  el,
  q,
  qa,
  setCentredText,
  setUserText,
} from '/js/utils.js?v=ab3cac1d';
import { t, currentLang } from '/js/i18n.js?v=ed7c5565';
import { toneForColor } from '/js/label-contrast.js?v=46ab91e5';
import { mobileMetrics, gridColumnWidth, gridCellCount, dockFit } from '/js/mobile-metrics.js?v=938a32a2';
import { smoothRectPath } from '/js/smooth-corner.js?v=b7dda7e1';
import { mkGlassRim, observeGlass } from '/js/glass-rim.js?v=3faec233';
import { fingerSpeed, rubberBand, settleMs, swipeSettle, SWIPE_LOCK_PX } from '/js/dashboard-logic.js?v=5fa66027';

const PHONE_W = 393;

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
const CB = () => _state.CB;
const st = () => _state;
const widgetReg = () => _state?.widgetReg || Object.create(null);
const mkWrap = (item, sz, r, isz, cls) => _mkWrap(item, sz, r, isz, cls, breg);

const folderName = f => (f.label ? t('type.folderNamed', { name: f.label }) : t('type.folder'));

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

function css(node, props) {
  for (const [k, v] of Object.entries(props)) node.style.setProperty(k, v);
  return node;
}

function mkMiniIcon(child, pointerEvents) {
  const bg = mk('div');
  bg.className = 'folder-mini-bg';
  const plate = clr(child.color);
  bg.style.background = plate;
  if (pointerEvents === 'none') bg.style.pointerEvents = 'none';
  if (child.iconUrl) {
    const srcs = iconChain(child.iconUrl);
    if (srcs.length) {
      const img = mk('img', { alt: '', loading: 'lazy', draggable: false });
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
      return bg;
    }
  }
  const s = mk('span');
  s.className = toneForColor(plate) === 'dark' ? 'folder-mini-fb fb-on-light' : 'folder-mini-fb';
  s.dir = 'ltr';
  if (pointerEvents === 'none') s.style.pointerEvents = 'none';
  s.textContent = initial(child.label);
  bg.appendChild(s);
  return bg;
}

/** The miniature icon grid a folder tile shows. @param {number} size */
export function mkFolderGlyph(folder, size) {
  const wrap = mk('div');
  wrap.className = 'dyn-fold-wrap glass-surface';
  css(wrap, {
    '--br': Math.round(size * ICON_R) + 'px',
    '--gap': Math.round(size * 0.04) + 'px',
    '--pad': Math.round(size * 0.1) + 'px',
  });
  (folder.children || [])
    .slice(0, 9)
    .map(id => items().find(i => i.id === id))
    .filter(Boolean)
    .forEach(child => {
      const cell = mk('div');
      cell.className = 'dyn-fold-cell';
      cell.appendChild(mkMiniIcon(child, 'none'));
      wrap.appendChild(cell);
    });
  return wrap;
}

export function mkFolder(item) {
  const showLabel = S().showLabels?.desktop !== false;
  const iw = showLabel ? 72 : 78;
  const a = mk('button');
  a.type = 'button';
  a.className = 'icon';
  a.setAttribute('aria-label', folderName(item));
  a.dataset.tileName = folderName(item);
  if (!showLabel) a.title = item.label || t('type.folder');
  a.onclick = () => {
    openFolderDesktop(item, a);
  };
  const box = mk('div');
  box.className = 'dyn-folder-box';
  css(box, { '--iw': iw + 'px' });
  const wrap = mk('div');
  wrap.className = 'folder-icon-grid glass-surface';
  wrap.appendChild(mkGlassRim(iw, iw, smoothRectPath(iw, iw, 16, 0)));
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
    setCentredText(l, item.label || t('type.folder'));
    a.appendChild(l);
  }
  return a;
}

/** Runs `fn` on a tap or a click. A touch that moved the pager's lock
    distance is a swipe and runs nothing.
    @param {HTMLElement} node @param {() => void} fn */
export function onTap(node, fn) {
  let x0 = 0,
    y0 = 0,
    moved = false;
  node.addEventListener(
    'touchstart',
    /** @param {TouchEvent} e */ e => {
      const touch = e.changedTouches[0];
      x0 = touch.clientX;
      y0 = touch.clientY;
      moved = e.touches.length > 1;
    },
    { passive: true },
  );
  node.addEventListener(
    'touchmove',
    /** @param {TouchEvent} e */ e => {
      const touch = e.changedTouches[0];
      if (touch && Math.hypot(touch.clientX - x0, touch.clientY - y0) >= SWIPE_LOCK_PX) moved = true;
    },
    { passive: true },
  );
  node.addEventListener(
    'touchend',
    /** @param {TouchEvent} e */ e => {
      /* Do not stop a swipe. The home pager never sees the lift and the strip stays between pages. */
      if (moved) return;
      e.preventDefault();
      e.stopPropagation();
      fn();
    },
    { passive: false },
  );
  node.addEventListener('click', () => {
    if (moved) moved = false;
    else fn();
  });
}

/** @typedef {{ down: (id: number|string, x: number, y: number, t: number) => void,
    move: (id: number|string, x: number, y: number, t: number) => void,
    up: (id: number|string, t: number, fling: boolean) => void,
    cancel: () => void }} SwipeFeed */

/** The returned handle takes touches from elsewhere, such as a widget frame,
    in this page's coordinates.

    @param {EventTarget|null} target where the touches land
    @param {HTMLElement} strip
    @param {{ width: () => number, page: () => number, total: () => number,
      turn: (n: number) => void, enabled?: () => boolean }} o
    @returns {SwipeFeed} */
export function swipePager(target, strip, o) {
  /** @type {number|string|null} */
  let id = null;
  let x0 = 0,
    y0 = 0,
    axis = '',
    from = 0,
    x = 0,
    speed = fingerSpeed();
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let done;
  const rest = n => -pageDir() * n * o.width();
  /** @type {SwipeFeed} */
  const feed = {
    down(pid, px, py, ts) {
      if (id !== null || (o.enabled && !o.enabled())) return;
      id = pid;
      x0 = px;
      y0 = py;
      axis = '';
      speed = fingerSpeed();
      speed.add(x0, ts);
    },
    move(pid, px, py, ts) {
      if (pid !== id || axis === 'y') return;
      if (!axis) {
        const dx = px - x0,
          dy = py - y0;
        if (Math.hypot(dx, dy) < SWIPE_LOCK_PX) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axis === 'y') return;
        clearTimeout(done);
        const m = getComputedStyle(strip).transform;
        from = m === 'none' ? 0 : new DOMMatrixReadOnly(m).m41;
        strip.style.transition = 'none';
        strip.style.willChange = 'transform';
        strip.classList.add('dragging');
      }
      speed.add(px, ts);
      const ends = [rest(0), rest(Math.max(0, o.total() - 1))];
      const lo = Math.min(...ends),
        hi = Math.max(...ends),
        raw = from + px - x0;
      x = raw > hi ? hi + rubberBand(raw - hi, o.width()) : raw < lo ? lo - rubberBand(lo - raw, o.width()) : raw;
      strip.style.transform = strip.style.webkitTransform = `translateX(${x}px)`;
    },
    up(pid, ts, fling) {
      if (id === null || pid !== id) return;
      release(fling ? speed.speed(ts) : 0, false);
    },
    cancel() {
      if (id !== null) release(0, true);
    },
  };
  /** @param {number} v @param {boolean} stay */
  function release(v, stay) {
    id = null;
    if (axis !== 'x') return;
    strip.classList.remove('dragging');
    const page = o.page();
    const n = stay
      ? page
      : swipeSettle({
          page,
          total: o.total(),
          offset: x - rest(page),
          speed: v,
          width: o.width(),
          dir: pageDir(),
        });
    const ms = settleMs(Math.abs(rest(n) - x), Math.sign(rest(n) - x) * v);
    strip.style.transition = `transform ${ms}ms var(--page-ease)`;
    o.turn(n);
    done = setTimeout(() => {
      strip.style.transition = '';
    }, ms);
  }
  if (!target) return feed;
  /** @param {TouchEvent} e */
  const find = e => Array.prototype.find.call(e.changedTouches, p => p.identifier === id);
  target.addEventListener(
    'touchstart',
    /** @param {TouchEvent} e */ e => {
      /* A handler that stops touchend leaves the old finger tracked forever. */
      if (id !== null && e.touches.length === e.changedTouches.length) feed.up(id, e.timeStamp, false);
      if (e.touches.length > 1) {
        feed.cancel();
        return;
      }
      const touch = e.changedTouches[0];
      feed.down(touch.identifier, touch.clientX, touch.clientY, e.timeStamp);
    },
    { passive: true },
  );
  target.addEventListener(
    'touchmove',
    /** @param {TouchEvent} e */ e => {
      const touch = find(e);
      if (touch) feed.move(touch.identifier, touch.clientX, touch.clientY, e.timeStamp);
    },
    { passive: true },
  );
  /** @param {boolean} fling */
  const lift = fling => /** @param {TouchEvent} e */ e => {
    const touch = find(e);
    if (touch) feed.up(touch.identifier, e.timeStamp, fling);
  };
  target.addEventListener('touchend', lift(true), { passive: true });
  target.addEventListener('touchcancel', lift(false), { passive: true });
  return feed;
}

/** @param {HTMLDialogElement} ov @param {HTMLElement[]} parts
    @param {Element} [tile] @returns {() => void} */
function folderMotion(ov, parts, tile) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = 'cubic-bezier(.32,.72,0,1)';
  /** @param {HTMLElement} p */
  const intoTile = p => {
    const from = !still && tile?.isConnected ? tile.getBoundingClientRect() : null;
    if (!from?.width) return 'none';
    const r = p.getBoundingClientRect();
    const s = from.width / r.width;
    const dx = from.left + from.width / 2 - r.left - (r.width * s) / 2;
    const dy = from.top + from.height / 2 - r.top - (r.height * s) / 2;
    return `translate(${dx}px, ${dy}px) scale(${s})`;
  };
  for (const p of parts) p.style.transformOrigin = '0 0';
  const steps = [
    { el: ov, prop: 'opacity', shut: '0', open: '1' },
    ...parts.map(part => ({ el: part, prop: 'transform', shut: intoTile(part), open: 'none' })),
  ];
  /** @param {string} prop @param {boolean} opening */
  const timing = (prop, opening) =>
    still
      ? { duration: 150, easing: 'ease-out' }
      : prop === 'opacity'
        ? { duration: opening ? 120 : 250, easing: opening ? 'ease-out' : 'cubic-bezier(.6,0,1,1)' }
        : { duration: opening ? 300 : 250, easing: ease };
  let running = steps.map(s => s.el.animate({ [s.prop]: [s.shut, s.open] }, timing(s.prop, true)));
  return () => {
    if (ov.contains(document.activeElement)) /** @type {HTMLElement} */ (document.activeElement).blur();
    const now = steps.map(s => getComputedStyle(s.el)[s.prop]);
    steps.forEach((s, i) => s.el.style.setProperty(s.prop, now[i]));
    running.forEach(a => a.cancel());
    ov.style.opacity = '1';
    running = steps
      .slice(1)
      .flatMap((s, i) => [
        s.el.animate({ transform: [now[i + 1], s.shut] }, { ...timing('transform', false), fill: 'forwards' }),
        s.el.animate({ opacity: [now[0], 0] }, { ...timing('opacity', false), fill: 'forwards' }),
      ]);
    running[0].finished.then(
      () => ov.remove(),
      () => {},
    );
  };
}

let folderOverlay = null;
/** @param {any} folder @param {Element} [tile] */
export function openFolderDesktop(folder, tile) {
  if (folderOverlay) {
    folderOverlay.remove();
    folderOverlay = null;
    return;
  }
  const children = (folder.children || []).map(id => items().find(i => i.id === id)).filter(Boolean);
  const showLabel = S().showLabels?.desktop !== false;
  const ov = /** @type {HTMLDialogElement} */ (mk('dialog'));
  ov.className = 'folder-overlay';
  ov.setAttribute('aria-label', folderName(folder));
  ov.tabIndex = -1;
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
    a.dataset.tileName = child.label || child.id;
    if (!showLabel) a.title = child.label || child.id;
    a.onclick = () => {
      closeDesk();
    };
    a.appendChild(mkWrap(child, iw, 16, isz, 'iwrap'));
    if (showLabel) {
      const l = mk('div');
      l.className = 'ilabel';
      l.style.width = iw + 12 + 'px';
      setCentredText(l, child.label || child.id);
      a.appendChild(l);
    }
    grid.appendChild(a);
  });
  box.appendChild(grid);
  const registeredBadges = [];
  children.forEach(c => bupd(c.id));
  qa('.badge', grid).forEach(badge => registeredBadges.push(badge));
  function closeDesk() {
    ov.close();
  }
  /* Escape and the tile's own toggle arrive here alike, and a badge registered
     to an element that has gone keeps the dashboard repainting it. */
  let stopGlass = () => {};
  let shrink = () => ov.remove();
  ov.addEventListener('close', () => {
    stopGlass();
    registeredBadges.forEach(badge => BEL().forEach((_, id) => bunreg(id, badge)));
    shrink();
    folderOverlay = null;
  });
  /* The overlay is the scrim, so a click reported against it is a click
     outside the folder. */
  ov.onclick = e => {
    if (e.target === ov) closeDesk();
  };
  outer.append(title, box);
  ov.appendChild(outer);
  document.body.appendChild(ov);
  folderOverlay = ov;
  /* Not show(): only showModal makes the dashboard behind it inert, and the
     tiles under the scrim were reachable by Tab and by a screen reader. */
  ov.showModal();
  ov.focus();
  shrink = folderMotion(ov, [outer], tile);
  stopGlass = observeGlass(box, 28, 0.2);
}

function mFolder(item, cw, rh, isz, ir, im, sc) {
  const showLabel = S().showLabels?.ios === true;
  const eff = showLabel ? Math.round(isz * 0.85) : isz;
  const a = document.createElement('button');
  a.type = 'button';
  a.className = 'dyn-mob-btn';
  a.setAttribute('aria-label', folderName(item));
  a.dataset.tileName = folderName(item);
  css(a, { '--rh': rh + 'px' });
  let _opening = false;
  function _openFolder() {
    if (_opening) return;
    _opening = true;
    setTimeout(() => {
      _opening = false;
    }, 500);
    openFolderMobile(item, isz, ir, im, sc, a);
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
  const wrap = mkFolderGlyph(item, eff);
  wrap.appendChild(mkGlassRim(eff, eff, smoothRectPath(eff, eff, Math.round(eff * ICON_R), 0)));
  box.appendChild(wrap);
  const fb_ = mk('div');
  fb_.className = 'badge';
  box.appendChild(fb_);
  breg(item.id, fb_);
  a.appendChild(box);
  if (showLabel) {
    const l = mk('div');
    l.className = 'dyn-fold-label';
    css(l, { '--lfs': Math.max(11, Math.round(12 * sc)) + 'px', '--lw': cw - 4 + 'px' });
    setCentredText(l, item.label || t('type.folder'));
    a.appendChild(l);
  }
  return a;
}

let folderOverlayMob = null;
/* The widest phone viewport. Matches the cap in mobile-metrics.js. */
export const FOLDER_MAX_VW = 430;
/** @param {any} folder @param {number} isz @param {number} _ir @param {number} _im
    @param {number} sc @param {Element} [tile] */
export function openFolderMobile(folder, isz, _ir, _im, sc, tile) {
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
  const ov = /** @type {HTMLDialogElement} */ (mk('dialog'));
  ov.className = 'folder-overlay-mobile';
  ov.setAttribute('aria-label', folderName(folder));
  ov.tabIndex = -1;

  function closeMob() {
    ov.close();
  }
  /* A badge registered to an element that has gone keeps the dashboard
     repainting it. */
  let shrink = () => ov.remove();
  ov.addEventListener('close', () => {
    qa('.badge', ov).forEach(badge => BEL().forEach((_, id) => bunreg(id, badge)));
    shrink();
    folderOverlayMob = null;
  });

  /* Phone size on every window. A wider window centres the folder instead of
     enlarging it. */
  const ptScale = Math.min(vw, FOLDER_MAX_VW) / 393;
  const margin = Math.round(34 * ptScale),
    boxW = Math.min(vw, FOLDER_MAX_VW) - margin * 2,
    boxLeft = Math.round((vw - boxW) / 2);
  const padH = Math.round(20 * ptScale),
    padVT = Math.round(24 * ptScale),
    padVB = Math.round(22 * ptScale);
  const innerW = boxW - padH * 2,
    gap = Math.round(14 * ptScale);
  const folderIconW = Math.min(Math.floor((innerW - gap * 2) / 3), isz);
  const folderIr = Math.round(folderIconW * ICON_R),
    folderIm = Math.round(folderIconW * 0.64);
  const gridInnerW = folderIconW * 3 + gap * 2,
    gridH = folderIconW * 3 + gap * 2;
  /* A badge sits 11px outside its icon corner. Without this inset the outer
     icons' badges cross into the next page and the viewport shows them. */
  const badgeOvh = Math.min(Math.ceil(11 * (sc || 1)), padH, padVT, padVB);
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
  const titleLeft = boxLeft + padH + Math.round(6 * ptScale);

  const titleEl = mk('div');
  titleEl.className = 'folder-title-mobile dyn-title-mob';
  css(titleEl, {
    '--tfs': titleFs + 'px',
    'inset-inline-start': titleLeft + 'px',
    width: boxW - padH + 'px',
    top: boxTop - titleRendH - titleGap + Math.round(8 * ptScale) + 'px',
  });
  setUserText(titleEl, folder.label || t('type.folder'));

  const box = mk('div');
  box.className = 'dyn-box-mob glass-surface';
  css(box, {
    '--left': boxLeft + 'px',
    '--bw': boxW + 'px',
    '--bh': boxH + 'px',
    '--top': boxTop + 'px',
    '--br': boxR + 'px',
    '--pt': padVT - badgeOvh + 'px',
    '--ph': padH - badgeOvh + 'px',
    '--pb': padVB - badgeOvh + 'px',
  });
  const boxD = smoothRectPath(boxW, boxH, boxR, 0.2);
  box.style.clipPath = `path('${boxD}')`;
  box.appendChild(mkGlassRim(boxW, boxH, boxD));

  const clipW = mk('div');
  clipW.className = 'dyn-clip';
  css(clipW, { '--gw': pageW + 'px', '--gh': pageH + 'px' });
  const strip = mk('div');
  strip.className = 'dyn-strip';
  css(strip, { '--gh': pageH + 'px', width: pages.length * pageW + 'px' });

  let dotEls = [];
  function gotoPage(n) {
    curPage = Math.max(0, Math.min(pages.length - 1, n));
    strip.style.transform = strip.style.webkitTransform = `translateX(${-pageDir() * curPage * pageW}px)`;
    dotEls.forEach((d, j) => d.classList.toggle('on', j === curPage));
    inertAllBut(strip, curPage);
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
        a.dataset.tileName = child.label || child.id;
        a.onclick = e => {
          e.stopPropagation();
          closeMob();
        };
        a.appendChild(mkWrap(child, folderIconW, folderIr, folderIm, 'iwrap'));
        if (showLabel) {
          const l = mk('div');
          l.className = 'dyn-fold-inner-label';
          css(l, { '--lfs': Math.max(11, Math.round(11 * ptScale)) + 'px', '--fiw': folderIconW + 'px' });
          setCentredText(l, child.label || child.id);
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
      gap: Math.max(dotSz + 2, Math.min(24, Math.floor(pageW / pages.length))) - dotSz + 'px',
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

  if (pages.length > 1)
    swipePager(box, strip, { width: () => pageW, page: () => curPage, total: () => pages.length, turn: gotoPage });
  for (const type of ['touchstart', 'touchmove', 'touchend'])
    box.addEventListener(type, e => e.stopPropagation(), { passive: true });
  ov.appendChild(titleEl);
  ov.appendChild(box);
  ov.onclick = e => {
    if (e.target === ov) closeMob();
  };
  ov.addEventListener(
    'touchend',
    e => {
      const touch = e.changedTouches[0],
        rb = box.getBoundingClientRect();
      if (touch.clientX < rb.left || touch.clientX > rb.right || touch.clientY < rb.top || touch.clientY > rb.bottom) {
        e.preventDefault();
        e.stopPropagation();
        closeMob();
      }
    },
    { passive: false },
  );
  document.body.appendChild(ov);
  folderOverlayMob = ov;
  ov.showModal();
  ov.focus();
  shrink = folderMotion(ov, [titleEl, box], tile);
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
  const dock = items()
    .filter(i => i.type === 'app' && i.dock && !i.hidden)
    .slice(0, 4);
  const { sc, sm, dh, pillH, pillGap, dz } = mobileMetrics(vw, dock.length > 0, vh);
  document.body.classList.toggle('no-dock', !dock.length);
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
  strip.replaceChildren();

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
     instead would take a value the platform has not reported yet.

     Clear the width first. The grid is sized by --mgw, so a rebuild would
     otherwise measure the width it was given last time rather than the space
     it now has, and a reserve that grew would never be taken. */
  css(document.body, { '--mgw': '' });
  const firstPage = mkPage();
  strip.appendChild(firstPage.page);
  const gridBox = firstPage.grid.getBoundingClientRect();
  const { cols: COLS, rows: ROWS } = gridCellCount({
    gridW: gridBox.width,
    gridH: gridBox.height,
    sc,
    vw,
    labels: S().showLabels?.ios === true,
  });
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
  const ir = Math.round(isz * ICON_R),
    im = Math.round(isz * 0.64);
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
  const bare = isDashboardEmpty(items());
  const gridItems = items().filter(i => !i.dock && !i.hidden && !inFolder.has(String(i.id)) && !(bare && i.system));

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
    const er = Math.round(eff * ICON_R),
      em = Math.round(eff * 0.64);
    const a =
      item.system === 'settings'
        ? mk('a', { href: '/admin/' })
        : mk('a', { href: item.href, target: '_blank', rel: 'noreferrer noopener' });
    a.className = 'dyn-mob-icon';
    a.setAttribute('aria-label', item.label || item.id);
    a.dataset.tileName = item.label || item.id;
    css(a, { '--cw': '100%', '--rh': rh2 + 'px' });
    a.appendChild(mkWrap(item, eff, er, em, ''));
    if (showLabel) {
      const l = mk('div');
      l.className = 'dyn-mob-label';
      css(l, { '--lfs': Math.max(11, Math.round(12 * sc)) + 'px', '--lw': '100%' });
      setCentredText(l, item.label || item.id);
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
    if (fixedAppearance(item, _state.widgetReg)) card.dataset.appearance = 'dark';
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
      swipe: () => CB().homeSwipe,
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
  renderEmptyState(items());

  const dw = el('dots');
  dw.style.cssText = 'display:none';
  dw.replaceChildren();

  const dk = el('dock');
  dk.className = 'mdock';
  const maxDockW = vw - Math.round(18 * sc);
  const dockIconSz = Math.round(Math.min(isz, ((maxDockW - Math.round(28 * sc)) / 4) * 0.85));
  const dockIr = Math.round(dockIconSz * ICON_R),
    dockIm = Math.round(dockIconSz * 0.64);
  const dockGap = Math.round(9 * sc);
  const fit = dockFit({ iconSz: dockIconSz, sc });
  const dockPad = Math.round(14 * sc * fit);
  const dockH = Math.round(dh * fit);
  const dockW = Math.min(maxDockW, Math.round((PHONE_W - 18) * sc * fit));
  const spare = dockW - dockPad * 2 - dock.length * dockIconSz;
  const maxIconGap = Math.round(22 * sc);
  const dockIconGap = dock.length > 1 ? Math.max(0, Math.min(maxIconGap, Math.floor(spare / (dock.length - 1)))) : 0;
  dk.hidden = !dock.length;
  dk.style.cssText = `position:fixed;left:50%;bottom:${dockGap}px;transform:translateX(-50%);width:${dockW}px;height:${dockH}px;padding:0 ${dockPad}px;gap:${dockIconGap}px;z-index:400;`;
  dk.replaceChildren();
  observeGlass(dk, Math.round(38 * sc), 0.6);
  dock.forEach(item => {
    const a =
      item.system === 'settings'
        ? mk('a', { href: '/admin/' })
        : mk('a', { href: item.href, target: '_blank', rel: 'noreferrer noopener' });
    a.className = 'dyn-dock-icon';
    const nm = item.label || item.id;
    a.setAttribute('aria-label', nm);
    a.dataset.tileName = nm;
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
  pill.style.cssText = `position:fixed;left:50%;bottom:${dockGap + dockH + pillGap}px;transform:translateX(-50%);width:${pillSearchW}px;height:${pillH}px;display:${bare ? 'none' : 'flex'};z-index:500;`;

  const pillNew = /** @type {HTMLElement} */ (pill.cloneNode(true));
  const pillNewDots = q('.msp-dots', pillNew);
  pillNewDots.replaceChildren();
  const pillDotEls = pages.map((_, i) => {
    const d = document.createElement('div');
    d.className = 'msp-dot' + (i === 0 ? ' on' : '');
    pillNewDots.appendChild(d);
    return d;
  });
  pill.parentNode.replaceChild(pillNew, pill);
  onTap(pillNew, () => {
    if (CB().spotOpen) CB().spotOpen('');
  });
  pillNew.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    if (CB().spotOpen) CB().spotOpen('');
  };

  let _pillIdleTimer = null;
  let _pillClipTimer = 0;
  let pillShownW = pillSearchW;
  function pillPaging(on) {
    pillNew.classList.toggle('paging', on);
    const to = on ? pillDotsW : pillSearchW;
    const from = pillShownW;
    pillShownW = to;
    clearTimeout(_pillClipTimer);
    if (from === to) return;
    const wide = Math.max(from, to);
    const inset = w => `inset(0 ${(wide - w) / 2}px round 999px)`;
    pillNew.style.transition = 'none';
    pillNew.style.width = wide + 'px';
    pillNew.style.clipPath = inset(from);
    pillNew.getBoundingClientRect();
    pillNew.style.transition = '';
    pillNew.style.clipPath = inset(to);
    _pillClipTimer = setTimeout(() => {
      pillNew.style.transition = 'none';
      pillNew.style.width = to + 'px';
      pillNew.style.clipPath = '';
      pillNew.getBoundingClientRect();
      pillNew.style.transition = '';
    }, 260);
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
  st()._mobTsCleanup = null;
  st()._mobTeCleanup = () => {
    clearMobWidgets(); /* tap on the home background dismisses any active sled */
  };
  document.addEventListener('touchend', st()._mobTeCleanup, { passive: true });
}

/* The desktop build shares the dock and pill elements with buildMobile, which
   styles them inline. */
export function resetMobileChrome() {
  const dk = el('dock');
  dk.className = '';
  dk.style.cssText = '';
  const pill = el('mob-search-pill');
  pill.style.cssText = '';
  pill.classList.remove('paging');
  CB().mobPillBump = null;
  const { _mobTsCleanup, _mobTeCleanup } = st();
  if (_mobTsCleanup) document.removeEventListener('touchstart', _mobTsCleanup);
  if (_mobTeCleanup) document.removeEventListener('touchend', _mobTeCleanup);
  st()._mobTsCleanup = null;
  st()._mobTeCleanup = null;
}
