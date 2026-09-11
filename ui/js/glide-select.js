/* The selected-item pill in the settings navigation. It travels from the old
   item to the new one instead of fading in place.

   Not gated on a pointer: this is selection, not hover, so the phone tab bar
   gets it too. */

import { ensurePill, measurable, placePill } from '/js/moving-pill.js?v=4e961dec';

const NAVS = [
  { container: '.sb-nav', item: '.nl', holdInk: true },
  { container: '.mtabbar', item: '.mtab', holdInk: false },
];

/* Container → the item its pill is on, so a move is told from a reposition. */
const at = new WeakMap();
/* Container → the pending timer that lifts the ink hold. */
const timers = new WeakMap();
const GLIDE_MS = 320;

/** Places each nav's pill on its active item. Both navs are in the document at
    once and the one belonging to the other layout is hidden, so the hidden one
    is left alone rather than placed against a zero rect. */
export function syncGlideSelect(root = document) {
  for (const cfg of NAVS) {
    for (const container of root.querySelectorAll(cfg.container)) {
      if (!measurable(container)) continue;
      const active = container.querySelector(cfg.item + '.active');
      if (!active) continue;
      const was = at.get(container);
      /* The label ink is held only for a real move. On the first placement
         there is nothing to travel from, so the pill and the ink land together. */
      if (cfg.holdInk && was && was !== active) {
        container.classList.add('gs-moving');
        clearTimeout(timers.get(container));
        timers.set(
          container,
          setTimeout(() => container.classList.remove('gs-moving'), GLIDE_MS),
        );
      }
      if (placePill(container, ensurePill(container, 'gs-pill'), active)) at.set(container, active);
    }
  }
}

/* Watch the navs rather than the window. A nav is laid out later than this
   runs: the tab bar stays hidden until the page is marked authenticated, and
   the two navs swap when the layout crosses the mobile breakpoint. Observing
   the container catches every one of those without a caller having to know. */
export function initGlideSelect(root = document) {
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => syncGlideSelect(root));
    for (const cfg of NAVS) for (const nav of root.querySelectorAll(cfg.container)) ro.observe(nav);
  } else {
    addEventListener('resize', () => syncGlideSelect(root));
  }
  syncGlideSelect(root);
}
