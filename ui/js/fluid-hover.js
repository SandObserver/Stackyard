/* A single highlight per list, moved instead of redrawn. It follows the
   pointer, and falls back to the keyboard cursor when the pointer leaves. */

import { ensurePill, pillOf, placePill, restPill } from '/js/moving-pill.js?v=4e961dec';

const FINE = '(hover: hover) and (pointer: fine)';

/* Container element → { hover, kb, bound }. */
const states = new WeakMap();
/* Containers holding a live pill, so a resize can reposition them. */
const live = new Set();

const LISTS = [
  { container: '#sres', item: '.sr' },
  { container: '.row-dd-list', item: 'li[role="option"]' },
  { container: '.grp', item: '.row-link, .row.drow' },
];

export function fluidHoverSupported() {
  return typeof matchMedia === 'function' && matchMedia(FINE).matches;
}

function selectable(item) {
  if (item.hasAttribute('disabled') || item.getAttribute('aria-disabled') === 'true') return false;
  return !item.classList.contains('d-none') && !item.classList.contains('dragging');
}

function stateFor(container) {
  let s = states.get(container);
  if (!s) {
    s = { hover: null, kb: null, bound: false };
    states.set(container, s);
  }
  return s;
}

function refresh(container) {
  const s = stateFor(container);
  const target = s.hover || s.kb;
  if (target && target.isConnected && selectable(target)) {
    const pill = ensurePill(container, 'fh-hl');
    live.add(container);
    placePill(container, pill, target);
  } else {
    restPill(pillOf(container));
  }
}

function bind(container) {
  const s = stateFor(container);
  if (s.bound) return;
  s.bound = true;
  container.addEventListener('pointerleave', () => {
    s.hover = null;
    refresh(container);
  });
}

function locate(item) {
  if (!item || !item.matches) return null;
  for (const cfg of LISTS) {
    if (!item.matches(cfg.item)) continue;
    const container = item.closest(cfg.container);
    if (container) return container;
  }
  return null;
}

/* Moves the highlight to the keyboard cursor. The pointer still wins while it
   is over the list. */
export function fluidHoverKb(item) {
  if (!fluidHoverSupported()) return;
  const container = locate(item);
  if (!container) return;
  stateFor(container).kb = item;
  bind(container);
  refresh(container);
}

export function fluidHoverClear(container) {
  const s = states.get(container);
  if (!s) return;
  s.hover = null;
  s.kb = null;
  refresh(container);
}

export function initFluidHover(root = document) {
  if (!fluidHoverSupported()) return;
  root.addEventListener(
    'pointerover',
    e => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      const from = /** @type {Element} */ (e.target);
      if (!from || !from.closest) return;
      for (const cfg of LISTS) {
        const item = from.closest(cfg.item);
        if (!item) continue;
        const container = item.closest(cfg.container);
        if (!container || !selectable(item)) continue;
        stateFor(container).hover = item;
        bind(container);
        refresh(container);
        return;
      }
    },
    true,
  );
  addEventListener('resize', () => {
    for (const c of live) {
      if (c.isConnected) refresh(c);
      else live.delete(c);
    }
  });
}
