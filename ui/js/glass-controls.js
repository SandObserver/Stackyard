// @ts-check
import { GlassBar, segmented, tabBar } from '/js/glass-bar.js?v=f450fd40';
import { cancelAll, releasePointer } from '/js/glass-control.js?v=2995d503';
import { lensSupported } from '/js/glass-gpu.js?v=5cefbe56';
import { wantsPlain } from '/js/glass-prefs.js?v=511e01c7';
import { GlassSlider } from '/js/glass-slider.js?v=e631393b';
import { GlassSwitch } from '/js/glass-switch.js?v=6011ab61';

/** Glass needs WebGL2 and none of the settings that ask for plain controls. */
export function glassAllowed() {
  return !wantsPlain() && lensSupported();
}

/** @type {WeakMap<Element, GlassSwitch|GlassSlider|GlassBar>} */
const made = new WeakMap();

/** @template {GlassSwitch|GlassSlider|GlassBar} T @param {Element} el @param {() => T} make @returns {T} */
function once(el, make) {
  let c = made.get(el);
  if (!c) {
    c = make();
    made.set(el, c);
  }
  return /** @type {T} */ (c);
}

/** @param {HTMLElement} el */
function segmentedFor(el) {
  return once(el, () => {
    let pillEl = el.querySelector(':scope > .segr-pill');
    const added = !pillEl;
    if (!pillEl) {
      pillEl = document.createElement('span');
      pillEl.className = 'segr-pill';
      /** @type {HTMLElement} */ (pillEl).style.left = '0';
      pillEl.setAttribute('aria-hidden', 'true');
      el.prepend(pillEl);
    }
    const bar = new GlassBar(el, segmented(el));
    const sized = new ResizeObserver(() => bar.resettle());
    const onChange = () => {
      if (glassAllowed()) return bar.follow();
      bar.stop();
      bar.cv.remove();
      sized.disconnect();
      el.removeEventListener('change', onChange);
      if (added) pillEl?.remove();
      made.delete(el);
    };
    el.addEventListener('change', onChange);
    sized.observe(el);
    bar.resettle();
    return bar;
  });
}

/** @param {PointerEvent} e */
function onPointerDown(e) {
  if (e.button || !(e.target instanceof Element)) return;
  const t = e.target;
  const range = t.closest('input.adm-range, input.hsb-range');
  if (range instanceof HTMLInputElement) {
    if (!range.disabled && glassAllowed()) once(range, () => new GlassSlider(range)).down(e);
    return;
  }
  const segr = /** @type {HTMLElement|null} */ (t.closest('.segr'));
  if (segr) {
    if (glassAllowed()) segmentedFor(segr).down(e);
    return;
  }
  const tabs = /** @type {HTMLElement|null} */ (t.closest('.mtabbar'));
  if (tabs) {
    if (glassAllowed()) once(tabs, () => new GlassBar(tabs, tabBar(tabs))).down(e);
    return;
  }
  const tog = /** @type {HTMLLabelElement|null} */ (t.closest('label.tog'));
  if (!tog || tog.classList.contains('tog-disabled') || !tog.querySelector('.tr')) return;
  const input = tog.querySelector('input');
  if (input && !input.disabled && glassAllowed()) once(tog, () => new GlassSwitch(tog)).down(e);
}

/** @param {TouchEvent} e */
function onTouchEnd(e) {
  if (!e.touches.length) setTimeout(cancelAll, 0);
}

let started = false;
/** One delegated listener; each control gets its glass on its first press. The
    shader compiles while the page is idle. Calling it again does nothing. */
export function initGlassControls() {
  if (started) return;
  started = true;
  (window.requestIdleCallback ?? (f => setTimeout(f, 300)))(() => glassAllowed());
  document.addEventListener('pointerup', releasePointer, true);
  document.addEventListener('pointercancel', releasePointer, true);
  document.addEventListener('touchend', onTouchEnd, true);
  document.addEventListener('touchcancel', cancelAll, true);
  window.addEventListener('blur', cancelAll);
  document.addEventListener('visibilitychange', cancelAll);
  document.addEventListener('pointerdown', onPointerDown, { capture: true });
}
