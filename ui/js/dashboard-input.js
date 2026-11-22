import { wheelPager } from '/js/dashboard-logic.js?v=b4828b62';
import { overlayOpen } from '/js/dashboard-pager.js?v=f6910a39';
import { isScripted } from '/js/frame-motion.js?v=911f7c03';
import { swipePager } from '/js/ui.js?v=bc665c94';
import { el, pageDir } from '/js/utils.js?v=457d9918';
import { scrollsSideways } from '/js/widget-frame.js?v=8e76d79b';

/* A touch produces a compatibility mouse event after it. */
const COMPAT_POINTER_MS = 500;

/** @param {{
      dash: import('/js/dashboard-state.js?v=51013727').DashboardState,
      goTo: (n: number, announce?: boolean, bump?: boolean, ms?: number) => void,
    }} deps */
export function wirePageInput({ dash, goTo }) {
  let _lastTouch = 0;
  /* Attached once, not per layout: the window can cross the breakpoint later,
     and a listener added on every crossing would fire twice. */
  /* A pointer or a key must reach the pager on both layouts. The phone layout is
     what a narrow window gets, and there its own swipe is the only pager, so a
     mouse and a keyboard cannot leave page one. */
  const pager = /** @type {HTMLInputElement} */ (el('mob-pager'));
  pager.addEventListener('input', () => goTo(Number(pager.value) - 1, false));
  document.addEventListener('keydown', e => {
    if (e.target === pager || e.defaultPrevented) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (typesText(e.target)) return;
    /* The overlay covers the page it would scroll behind. */
    if (overlayOpen()) return;
    if (e.key === 'ArrowRight') goTo(dash.pg + pageDir());
    if (e.key === 'ArrowLeft') goTo(dash.pg - pageDir());
  });
  /* A trackpad swipe or a thumb wheel turns one page per gesture. Widget frames
     hand their wheel to the card, so this also runs over widgets. */
  const wheelStep = wheelPager();
  document.addEventListener(
    'wheel',
    e => {
      if (e.ctrlKey || overlayOpen()) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerWidth : 1;
      const dx = e.deltaX * unit,
        dy = e.deltaY * unit;
      if (Math.abs(dx) <= Math.abs(dy) || scrollsSideways(e.target, dx)) return;
      /* Unhandled, a sideways swipe is the browser's back and forward gesture. */
      e.preventDefault();
      const step = wheelStep(dx, dy, e.timeStamp);
      if (step) goTo(dash.pg + step * pageDir());
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
    if (overlayOpen()) {
      _dDragging = false;
      return;
    }
    if (!_dDragging) return;
    _dDragging = false;
    /* A swipe is followed by a compatibility mouse event. Acting on both pages
       twice for one gesture. */
    if (Date.now() - _lastTouch < COMPAT_POINTER_MS) return;
    const dx = e.clientX - _dMx;
    if (Math.abs(dx) > 60) goTo(dash.pg + (dx < 0 ? 1 : -1) * pageDir());
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
  dash.CB.homeSwipe = swipePager(document, strip, {
    width: () => innerWidth,
    page: () => dash.pg,
    total: () => strip.children.length,
    turn: (n, ms) => goTo(n, true, true, ms),
    scripted: isScripted,
    enabled: () => !overlayOpen(),
  });
}

/** @param {EventTarget|null} target */
function typesText(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest('input, textarea, select');
}

/* Keep. Without it Safari leaves the tile scaled after a new tab opens. */
export function wireTileSettle() {
  document.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    const a = e.target.closest(
      'a[target="_blank"]:is(.icon, .di, .folder-icon-link, .dyn-mob-icon, .dyn-dock-icon, .dyn-fold-anchor)',
    );
    if (!a) return;
    a.classList.add('settled');
    a.addEventListener('pointerleave', () => a.classList.remove('settled'), { once: true });
  });
}
