import { iconChain } from '/js/icons.js?v=36';
import { widgetSrc, WIDGET_DESIGN, WIDGET_TYPES } from '/js/widget-types.js?v=39';
import { mk, clr, mkWrap as _mkWrap, mountScaledWidget } from '/js/utils.js?v=40';
import { mobileMetrics } from '/js/mobile-metrics.js?v=1';

let _state = null;
export function initUI(state) { _state = state; }

const items    = () => _state.items;
const S        = () => _state.S;
const breg     = (...a) => _state.breg(...a);
const bunreg   = (...a) => _state.bunreg(...a);
const bupd     = (...a) => _state.bupd(...a);
const BEL      = () => _state.BEL;
const goTo     = (...a) => _state.goTo(...a);
const CB       = () => _state.CB;
const st       = () => _state;
const mkWrap   = (item, sz, r, isz, cls) => _mkWrap(item, sz, r, isz, cls, breg);

/* Dismiss any "active" interior state (e.g. a tapped disk-health sled) on mobile.
   Widgets expose window.__clearActive; taps outside a widget land in the parent
   document, so the parent must tell the widgets to reset. */
function clearMobWidgets(exceptWin){
  document.querySelectorAll('.mob-widget-card iframe, .widget iframe').forEach(ifr => {
    try { const w = ifr.contentWindow; if (w && w !== exceptWin && w.__clearActive) w.__clearActive(); } catch {}
  });
}
if (!window.__wActiveMsgBound){
  window.__wActiveMsgBound = true;
  window.addEventListener('message', e => { if (e.data && e.data.type === 'widget-active') clearMobWidgets(e.source); });
}

/* css(): set multiple CSS custom properties on an element at once */
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
      const img = mk('img', { loading:'lazy', draggable:false });
      img.className = 'folder-mini-img';
      if (pointerEvents === 'none') img.style.pointerEvents = 'none';
      let step = 0;
      img.onerror = () => { step++; if (step < srcs.length) img.src = srcs[step]; else img.style.display = 'none'; };
      img.src = srcs[0]; bg.appendChild(img);
    } else {
      const s = mk('span'); s.className = 'folder-mini-fb';
      if (pointerEvents === 'none') s.style.pointerEvents = 'none';
      s.textContent = (child.label||'?')[0].toUpperCase(); bg.appendChild(s);
    }
  } else {
    const s = mk('span'); s.className = 'folder-mini-fb';
    if (pointerEvents === 'none') s.style.pointerEvents = 'none';
    s.textContent = (child.label||'?')[0].toUpperCase(); bg.appendChild(s);
  }
  return bg;
}

export function mkFolder(item) {
  const showLabel = S().showLabels?.desktop !== false;
  const iw = showLabel ? 72 : 78;
  const a = mk('a'); a.className = 'icon'; a.style.cursor = 'pointer';
  a.href = '#'; a.setAttribute('role','button');
  a.setAttribute('aria-label', (item.label||'Folder') + ' folder');
  if (!showLabel) a.title = item.label || 'Folder';
  a.onclick = e => { e.preventDefault(); openFolderDesktop(item); };
  const box = mk('div');
  box.className = 'dyn-folder-box';
  css(box, { '--iw': iw + 'px' });
  const wrap = mk('div'); wrap.className = 'folder-icon-grid';
  const g = mk('div'); g.className = 'folder-icon-grid-sheen';
  wrap.appendChild(g);
  (item.children||[]).slice(0,9).map(id => items().find(i => i.id === id)).filter(Boolean).forEach(child => {
    const cell = mk('div'); cell.className = 'folder-mini-cell';
    cell.appendChild(mkMiniIcon(child, null)); wrap.appendChild(cell);
  });
  box.appendChild(wrap);
  const fb_ = mk('div'); fb_.className = 'badge'; box.appendChild(fb_); breg(item.id, fb_);
  a.appendChild(box);
  if (showLabel) {
    const l = mk('div'); l.className = 'ilabel'; l.style.width = (iw+12)+'px';
    l.textContent = item.label||'Folder'; a.appendChild(l);
  }
  return a;
}

let folderOverlay = null;
export function openFolderDesktop(folder) {
  if (folderOverlay) { folderOverlay.remove(); folderOverlay = null; return; }
  const children = (folder.children||[]).map(id => items().find(i => i.id === id)).filter(Boolean);
  const showLabel = S().showLabels?.desktop !== false;
  const ov = mk('div'); ov.className = 'folder-overlay';
  ov.setAttribute('role','dialog'); ov.setAttribute('aria-modal','true');
  ov.setAttribute('aria-label', (folder.label||'Folder') + ' folder');
  const _prevFocus = document.activeElement;
  const outer = mk('div'); outer.className = 'folder-outer';
  const title = mk('div'); title.className = 'folder-title-desktop'; title.textContent = folder.label||'Folder';
  const box = mk('div'); box.className = 'folder-box-desktop';
  const iw = showLabel ? 72 : 78, isz = showLabel ? 50 : 56;
  const grid = mk('div');
  grid.className = 'dyn-grid';
  css(grid, { '--iw': iw + 'px' });
  children.forEach(child => {
    const a = mk('a', { href:child.href, target:'_blank', rel:'noreferrer noopener' });
    a.className = 'folder-icon-link'; a.style.width = iw+'px';
    a.setAttribute('aria-label', child.label||child.id);
    if (!showLabel) a.title = child.label || child.id;
    a.onclick = () => { closeDesk(); };
    a.appendChild(mkWrap(child, iw, 16, isz, 'iwrap'));
    if (showLabel) {
      const l = mk('div'); l.className = 'ilabel'; l.style.width = (iw+12)+'px';
      l.textContent = child.label||child.id; a.appendChild(l);
    }
    grid.appendChild(a);
  });
  box.appendChild(grid);
  const registeredBadges = [];
  children.forEach(c => bupd(c.id));
  grid.querySelectorAll('.badge').forEach(el => registeredBadges.push(el));
  function closeDesk() {
    registeredBadges.forEach(el => BEL().forEach((_, id) => bunreg(id, el)));
    document.removeEventListener('keydown', escDesk);
    ov.remove(); folderOverlay = null;
    if (_prevFocus && _prevFocus.focus) _prevFocus.focus();
  }
  ov.onclick = e => { if (e.target === ov) closeDesk(); };
  const escDesk = e => { if (e.key === 'Escape') { closeDesk(); document.removeEventListener('keydown', escDesk); } };
  document.addEventListener('keydown', escDesk);
  outer.append(title, box); ov.appendChild(outer); document.body.appendChild(ov); folderOverlay = ov;
}

function mFolder(item, cw, rh, isz, ir, im, sc) {
  const showLabel = S().showLabels?.ios === true;
  const eff = showLabel ? Math.round(isz*.85) : isz;
  const a = document.createElement('button'); a.type = 'button';
  a.className = 'dyn-mob-btn';
  a.setAttribute('aria-label', (item.label||'Folder') + ' folder');
  css(a, { '--rh': rh + 'px' });
  let _opening = false;
  function _openFolder() {
    if (_opening) return; _opening = true;
    setTimeout(() => { _opening = false; }, 500);
    openFolderMobile(item, isz, ir, im, sc);
  }
  let _tStarted = false, _tMoved = false, _tSX = 0, _tSY = 0;
  a.addEventListener('touchstart', e => {
    e.preventDefault(); _tStarted = true; _tMoved = false;
    _tSX = e.touches[0].clientX; _tSY = e.touches[0].clientY;
  }, { passive:false });
  a.addEventListener('touchmove', e => {
    if (!_tStarted) return;
    if (Math.abs(e.touches[0].clientX-_tSX) > 10 || Math.abs(e.touches[0].clientY-_tSY) > 10) _tMoved = true;
  }, { passive:true });
  a.addEventListener('touchend', e => {
    e.preventDefault();
    if (!_tStarted || _tMoved) { _tStarted = false; _tMoved = false; return; }
    _tStarted = false; _tMoved = false; _openFolder();
  }, { passive:false });
  a.onclick = () => _openFolder();
  const box = mk('div');
  box.className = 'dyn-sz dyn-box';
  css(box, { '--sz': eff + 'px' });
  box.style.pointerEvents = 'none';
  const wrap = mk('div');
  const pad = Math.round(eff*.10), gap = Math.round(eff*.04);
  wrap.className = 'dyn-fold-wrap';
  css(wrap, { '--br': Math.round(eff*.24)+'px', '--gap': gap+'px', '--pad': pad+'px' });
  const sheen = mk('div'); sheen.className = 'dyn-fold-sheen';
  wrap.appendChild(sheen);
  (item.children||[]).slice(0,9).map(id => items().find(i => i.id === id)).filter(Boolean).forEach(child => {
    const cell = mk('div'); cell.className = 'dyn-fold-cell';
    cell.appendChild(mkMiniIcon(child, 'none')); wrap.appendChild(cell);
  });
  box.appendChild(wrap);
  const fb_ = mk('div'); fb_.className = 'badge'; box.appendChild(fb_); breg(item.id, fb_);
  a.appendChild(box);
  if (showLabel) {
    const l = mk('div'); l.className = 'dyn-fold-label';
    css(l, { '--lfs': Math.max(9,Math.round(9*sc))+'px', '--lw': (cw-4)+'px' });
    l.textContent = item.label||'Folder'; a.appendChild(l);
  }
  return a;
}

let folderOverlayMob = null;
export function openFolderMobile(folder, isz, _ir, _im, _sc) {
  if (folderOverlayMob) { folderOverlayMob.remove(); folderOverlayMob = null; }
  const children = (folder.children||[]).map(id => items().find(i => i.id === id)).filter(Boolean);
  const showLabel = S().showLabels?.ios === true;
  const pages = []; for (let i = 0; i < children.length; i += 9) pages.push(children.slice(i, i+9));
  let curPage = 0;
  const vw = innerWidth, vh = innerHeight;
  const ov = mk('div'); ov.className = 'folder-overlay-mobile';
  ov.setAttribute('role','dialog'); ov.setAttribute('aria-modal','true');
  ov.setAttribute('aria-label', (folder.label||'Folder') + ' folder');

  function closeMob() {
    ov.querySelectorAll('.badge').forEach(el => BEL().forEach((_, id) => bunreg(id, el)));
    ov.remove(); folderOverlayMob = null;
  }

  const ptScale = vw/393;
  const margin = Math.round(34*ptScale), boxW = vw - margin*2;
  const padH = Math.round(20*ptScale), padVT = Math.round(24*ptScale), padVB = Math.round(22*ptScale);
  const innerW = boxW - padH*2, gap = Math.round(14*ptScale);
  const folderIconW = Math.min(Math.floor((innerW - gap*2) / 3), isz);
  const folderIr = Math.round(folderIconW * 0.22), folderIm = Math.round(folderIconW * 0.64);
  const gridInnerW = folderIconW*3 + gap*2, gridH = folderIconW*3 + gap*2;
  const dotSz = Math.round(7*ptScale);
  const dotsZoneH = pages.length > 1 ? Math.round(26*ptScale) : 0;
  const boxH = padVT + gridH + padVB + dotsZoneH;
  const sbPx = Math.round(50*ptScale), clearBottom = Math.round(165*ptScale);
  const availH = vh - sbPx - clearBottom;
  const boxTop = Math.max(sbPx, Math.round(sbPx + (availH - boxH) / 2 + availH * 0.08));
  const boxR = Math.round(32*ptScale);
  const titleFs = Math.round(30*ptScale), titleGap = Math.round(40*ptScale);
  const titleRendH = Math.ceil(titleFs * 1.05) + Math.round(4*ptScale);
  const titleLeft = margin + padH + Math.round(6*ptScale);

  const titleEl = mk('div'); titleEl.className = 'folder-title-mobile dyn-title-mob';
  css(titleEl, { '--tfs': titleFs+'px', 'left': titleLeft+'px', 'width': (boxW-padH)+'px', 'top': (boxTop-titleRendH-titleGap+Math.round(8*ptScale))+'px' });
  titleEl.textContent = folder.label||'Folder';

  const box = mk('div');
  box.className = 'folder-box-mobile dyn-box-mob';
  css(box, { '--left': margin+'px', '--bw': boxW+'px', '--bh': boxH+'px', '--top': boxTop+'px', '--br': boxR+'px', '--pt': padVT+'px', '--ph': padH+'px', '--pb': padVB+'px' });

  const clipW = mk('div'); clipW.className = 'dyn-clip';
  css(clipW, { '--gw': gridInnerW+'px', '--gh': gridH+'px' });
  const strip = mk('div'); strip.className = 'dyn-strip';
  css(strip, { '--gh': gridH+'px', 'width': (pages.length*gridInnerW)+'px' });

  let dotEls = [];
  function gotoPage(n) {
    curPage = Math.max(0, Math.min(pages.length-1, n));
    strip.style.transform = strip.style.webkitTransform = `translateX(-${curPage*gridInnerW}px)`;
    dotEls.forEach((d, j) => d.classList.toggle('on', j === curPage));
  }

  function buildPage(apps) {
    const p = mk('div'); p.className = 'dyn-page-grid';
    css(p, { '--gw': gridInnerW+'px', '--gh': gridH+'px', '--gap': gap+'px', '--fiw': folderIconW+'px' });
    for (let i = 0; i < 9; i++) {
      const child = apps[i];
      if (child) {
        const a = mk('a', { href:child.href, target:'_blank', rel:'noreferrer noopener' });
        a.className = 'dyn-fold-anchor';
        a.setAttribute('aria-label', child.label||child.id);
        a.onclick = e => { e.stopPropagation(); closeMob(); };
        a.appendChild(mkWrap(child, folderIconW, folderIr, folderIm, 'iwrap'));
        if (showLabel) {
          const l = mk('div'); l.className = 'dyn-fold-inner-label';
          css(l, { '--lfs': Math.max(11,Math.round(11*ptScale))+'px', '--fiw': folderIconW+'px' });
          l.textContent = child.label||child.id; a.appendChild(l);
        }
        p.appendChild(a);
      } else { p.appendChild(mk('div')); }
    }
    return p;
  }

  let dotsEl = null;
  if (pages.length > 1) {
    dotsEl = mk('div'); dotsEl.className = 'folder-dots dyn-dots-row';
    css(dotsEl, { 'padding': `${Math.round(18*ptScale)}px 0 ${Math.round(4*ptScale)}px`, 'gap': Math.round(7*ptScale)+'px' });
    dotEls = pages.map((_, i) => {
      const d = mk('div'); d.className = 'folder-dot dyn-dot';
      css(d, { '--dsz': dotSz+'px' });
      d.onclick = () => gotoPage(i); return d;
    });
    dotEls.forEach(d => dotsEl.appendChild(d));
    gotoPage(0);
  }

  pages.forEach(pg => strip.appendChild(buildPage(pg)));
  clipW.appendChild(strip); box.appendChild(clipW);
  if (dotsEl) box.appendChild(dotsEl);
  children.forEach(c => bupd(c.id));

  let tx0 = 0, ty0 = 0, swiping = false;
  box.addEventListener('touchstart', e => { tx0 = e.touches[0].clientX; ty0 = e.touches[0].clientY; swiping = false; e.stopPropagation(); }, { passive:false });
  box.addEventListener('touchmove', e => {
    const dx = Math.abs(e.touches[0].clientX-tx0), dy = Math.abs(e.touches[0].clientY-ty0);
    if (dx > dy && dx > 8) swiping = true;
    e.stopPropagation(); e.preventDefault();
  }, { passive:false });
  box.addEventListener('touchend', e => {
    e.stopPropagation(); if (!swiping) return; swiping = false;
    const dx = e.changedTouches[0].clientX - tx0;
    if (Math.abs(dx) > Math.round(30*ptScale)) gotoPage(curPage + (dx < 0 ? 1 : -1));
  }, { passive:false });
  ov.appendChild(titleEl); ov.appendChild(box);
  ov.addEventListener('touchend', e => {
    const t = e.changedTouches[0], rb = box.getBoundingClientRect();
    if (t.clientX < rb.left || t.clientX > rb.right || t.clientY < rb.top || t.clientY > rb.bottom) { e.preventDefault(); e.stopPropagation(); closeMob(); }
  }, { passive:false });
  document.body.appendChild(ov); folderOverlayMob = ov;
}


export function buildMobile() {
  st().BEL.clear();
  const vw = innerWidth, vh = innerHeight;
  const { sc, sm, sb, safe, dh, pillH, pillGap, dz, avail, rh, cw } = mobileMetrics(vw, vh);
  document.body.style.setProperty('--sc', String(sc));
  const maxIsz = Math.round(74*sc);
  const isz = Math.round(Math.min(cw*.90, rh*.80, maxIsz));
  const ir = Math.round(isz*.225), im = Math.round(isz*.64);
  const dock = items().filter(i => i.type === 'app' && i.dock && !i.hidden).slice(0,4);
  /* ── Mobile layout: single-pass true 4×6 grid bin-packing ──
     Replaces the previous two-system approach (paginate() cost model +
     buildMobile row-flow with ensureSpace overflow), which disagreed and
     could strand half-rows / push a widget that fits onto a new page.
     Footprints in grid cells: icon/folder 1×1, small 2×2, medium 4×2, large 4×4, xlarge 4×6. */
  const strip = document.getElementById('pages'); strip.innerHTML = '';
  const COLS = 4, ROWS = 6;
  const gap = Math.round(sm * 0.5);
  const rh2 = (avail - gap * (ROWS - 1)) / ROWS;   /* exact row height incl. gaps */
  const showLabel = S().showLabels?.ios === true;
  const wBR = Math.round(ir * 1.3);

  const fp = it => it.type !== 'widget' ? [1, 1]
    : (it.widgetSize === 'xlarge' ? [4, 6]
    :  it.widgetSize === 'large' ? [4, 4]
    :  it.widgetSize === 'small' ? [2, 2]
    :  [4, 2]);

  const inFolder = new Set(items().filter(i => i.type === 'folder').flatMap(f => f.children || []).map(String));
  const gridItems = items().filter(i => !i.dock && !i.hidden && !inFolder.has(String(i.id)));

  /* First-fit, row-major packer → pages, each a list of {item,c,r,w,h}. */
  function packMobile(list) {
    const pages = [];
    let grid, placements;
    const newPage = () => { grid = Array.from({ length: ROWS }, () => Array(COLS).fill(false)); placements = []; pages.push(placements); };
    const fits = (r, c, w, h) => { if (c + w > COLS || r + h > ROWS) return false; for (let i = r; i < r + h; i++) for (let j = c; j < c + w; j++) if (grid[i][j]) return false; return true; };
    const mark = (r, c, w, h) => { for (let i = r; i < r + h; i++) for (let j = c; j < c + w; j++) grid[i][j] = true; };
    const tryPlace = (it, w, h) => { for (let r = 0; r <= ROWS - h; r++) for (let c = 0; c <= COLS - w; c++) if (fits(r, c, w, h)) { mark(r, c, w, h); placements.push({ item: it, c, r, w, h }); return true; } return false; };
    newPage();
    for (const it of list) { const [w, h] = fp(it); if (!tryPlace(it, w, h)) { newPage(); tryPlace(it, w, h); } }
    return pages;
  }
  const pages = packMobile(gridItems);

  function widgetTitle(item) {
    if (item.widgetType === 'stats' && item.widgetConfig?.widgetSubType === 'disk-health') return item.label || 'Disk health';
    return item.label || WIDGET_TYPES[item.widgetType]?.label || 'Widget';
  }

  function mIcon(item) {
    const eff = showLabel ? Math.round(isz * .82) : isz;
    const er = Math.round(eff * .225), em = Math.round(eff * .64);
    const a = item.system === 'settings'
      ? mk('a', { href: '/admin/' })
      : mk('a', { href: item.href, target: '_blank', rel: 'noreferrer noopener' });
    a.className = 'dyn-mob-icon';
    a.setAttribute('aria-label', item.label || item.id);
    css(a, { '--cw': '100%', '--rh': rh2 + 'px' });
    a.appendChild(mkWrap(item, eff, er, em, ''));
    if (showLabel) {
      const l = mk('div'); l.className = 'dyn-mob-label';
      css(l, { '--lfs': Math.max(9, Math.round(9 * sc)) + 'px', '--lw': '100%' });
      l.textContent = item.label || item.id; a.appendChild(l);
    }
    return a;
  }

  function makeWidgetCard(item) {
    const card = mk('div');
    const sz = item.widgetSize || 'medium';
    const design = WIDGET_DESIGN[sz] || WIDGET_DESIGN.medium;
    const wtype = item.widgetType || '', wsub = item.widgetConfig?.widgetSubType || '';
    const bg = wtype === 'duplicati'                        ? 'rgba(0,0,0,.08)'
             : wtype === 'github'                           ? 'rgba(0,0,0,.25)'
             : wtype === 'stats' && wsub === 'disk-health'  ? 'rgba(18,18,20,0.82)'
             : 'rgba(0,0,0,.30)';
    card.className = 'mob-widget-card';
    /* Aspect-lock to the family design and fit within the grid cell (centered).
       Same aspect on desktop and mobile → identical rendering. */
    card.style.cssText = `aspect-ratio:${design[0]}/${design[1]};width:100%;max-width:100%;max-height:100%;` +
      `flex-shrink:0;border-radius:${wBR}px;overflow:hidden;position:relative;` +
      `border:1px solid rgba(255,255,255,.09);background:${bg};` +
      `-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);`;
    /* Same URL as desktop (no mobile-only branch); the fixed design size now
       guarantees identical rendering, so platform-specific widget layouts are unnecessary.
       overlayHref + mobile:true add a transparent layer so swipes page the home screen
       (iframes otherwise swallow the touch) while a tap opens the widget's link. */
    const overlayHref = item.url || item.href || item.widgetConfig?.scrutinyHref || item.widgetConfig?.linkUrl || null;
    mountScaledWidget(card, { src: widgetSrc(item, { mobile: true }), title: widgetTitle(item), design, iframeOpts: item.iframe, overlayHref, mobile: true,
      onSwipe: dir => goTo(st().pg + dir) });
    return card;
  }

  function makeIconEl(item) {
    return item.type === 'folder' ? mFolder(item, cw, rh2, isz, ir, im, sc) : mIcon(item);
  }

  pages.forEach(placements => {
    const p = mk('div');
    p.className = 'mob-page';
    p.style.cssText = `flex:0 0 100vw;width:100vw;height:${vh}px;overflow:hidden;box-sizing:border-box;` +
      `display:grid;grid-template-columns:repeat(${COLS},1fr);grid-template-rows:repeat(${ROWS},${rh2}px);` +
      `column-gap:${gap}px;row-gap:${gap}px;justify-content:center;align-content:start;` +
      `padding:${sb}px ${sm}px ${safe + dh + dz}px;`;
    placements.forEach(({ item, c, r, w, h }) => {
      const cell = mk('div');
      cell.style.cssText = `grid-column:${c + 1}/span ${w};grid-row:${r + 1}/span ${h};` +
        `display:flex;align-items:center;justify-content:center;min-width:0;min-height:0;`;
      cell.appendChild(item.type === 'widget' ? makeWidgetCard(item) : makeIconEl(item));
      p.appendChild(cell);
    });
    strip.appendChild(p);
  });

  const dw = document.getElementById('dots'); dw.style.cssText = 'display:none'; dw.innerHTML = '';
  const de = [];
  for (let i = 0; i < pages.length; i++) {
    const d = mk('div'); d.className = 'dot' + (i === 0 ? ' on' : '');
    d.onclick = () => goTo(i); dw.appendChild(d); de.push(d);
  }

  const dk = document.getElementById('dock'); dk.className = 'mdock';
  const dockW = vw - Math.round(18*sc);
  const dockIconSz = Math.round(Math.min(isz, (dockW-Math.round(28*sc))/4*0.85));
  const dockIr = Math.round(dockIconSz*.225), dockIm = Math.round(dockIconSz*.64);
  dk.style.cssText = `position:fixed;left:50%;bottom:${safe}px;-webkit-transform:translateX(-50%);transform:translateX(-50%);width:${dockW}px;height:${dh}px;padding:0 ${Math.round(14*sc)}px;border-radius:${Math.round(44*sc)}px;z-index:400;`;
  dk.innerHTML = '';
  dock.forEach(item => {
    const a = mk('a', { href:item.href, target:'_blank', rel:'noreferrer noopener' });
    a.className = 'dyn-dock-icon';
    const nm = item.label || item.id;
    a.setAttribute('aria-label', nm);
    a.title = nm;                 /* dock icons never show a label */
    a.appendChild(mkWrap(item, dockIconSz, dockIr, dockIm, '')); dk.appendChild(a);
  });

  const pillSearchW = Math.round(96*sc);
  const _pdotSz = Math.round(8*sc), _pdotGap = Math.round(5*sc), _pdotPad = Math.round(14*sc);
  const pillDotsW = pages.length * (_pdotSz + _pdotGap) - _pdotGap + _pdotPad * 2;
  const pillBottom = safe + dh + pillGap;
  const pill = document.getElementById('mob-search-pill');
  pill.style.cssText = `position:fixed;left:50%;bottom:${pillBottom}px;-webkit-transform:translateX(-50%);transform:translateX(-50%);width:${pillSearchW}px;height:${pillH}px;display:-webkit-flex;display:flex;z-index:500;`;

  const pillNew = pill.cloneNode(true);
  const pillNewDots = pillNew.querySelector('.msp-dots'); pillNewDots.innerHTML = '';
  const pillDotEls = pages.map((_, i) => {
    const d = document.createElement('div');
    d.className = 'msp-dot' + (i === 0 ? ' on' : '');
    pillNewDots.appendChild(d); return d;
  });
  pill.parentNode.replaceChild(pillNew, pill);
  pillNew.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); if (CB().spotOpen) CB().spotOpen(''); }, { passive:false });
  pillNew.onclick = () => { if (CB().spotOpen) CB().spotOpen(''); };

  let _pillIdleTimer = null;
  function pillPaging(on) { pillNew.classList.toggle('paging', on); pillNew.style.width = (on ? pillDotsW : pillSearchW) + 'px'; }
  function pillBump(newPg) {
    pillPaging(true);
    pillDotEls.forEach((d, i) => d.classList.toggle('on', i === newPg));
    clearTimeout(_pillIdleTimer);
    _pillIdleTimer = setTimeout(() => pillPaging(false), 1500);
  }
  CB().mobPillBump = pillBump;

  const { _mobTsCleanup, _mobTeCleanup } = st();
  if (_mobTsCleanup) document.removeEventListener('touchstart', _mobTsCleanup, { passive:true });
  if (_mobTeCleanup) document.removeEventListener('touchend',   _mobTeCleanup, { passive:true });
  let tx = 0, txOpenedWithFolder = false;
  st()._mobTsCleanup = e => { tx = e.touches[0].clientX; txOpenedWithFolder = !!folderOverlayMob; };
  st()._mobTeCleanup = e => {
    clearMobWidgets();                          /* tap on the home background dismisses any active sled */
    if (txOpenedWithFolder || folderOverlayMob) return;
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 40) goTo(st().pg + (dx < 0 ? 1 : -1));
  };
  document.addEventListener('touchstart', st()._mobTsCleanup, { passive:true });
  document.addEventListener('touchend',   st()._mobTeCleanup, { passive:true });
}
