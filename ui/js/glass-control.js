// @ts-check
import { everyFrame } from '/js/frame-motion.js?v=911f7c03';
import { lensRelease } from '/js/glass-gpu.js?v=ca6a65f5';

/** How long after a gesture the browser's own click for it can still arrive. */
export const CLICK_WINDOW_MS = 400;
/** Below this growth a lens is at rest and its glass is put away. */
export const AT_REST = 0.002;

/** The look every lens shares. A dark page gets a fainter rim and a deeper shadow. */
const LOOK = { bevel: 12, blur: 8, line: 1, rim: 0.9, shadow: 0.1, disp: 0.02, lift: 0.07 };
const LOOK_DARK = { rim: 0.35, lift: 0.1, shadow: 0.4 };

/** Lens parameters that follow growth `g` and frost `f`.
    @param {boolean} dark @param {number} g @param {number} f */
export function lensLook(dark, g, f) {
  const k = dark ? { ...LOOK, ...LOOK_DARK } : LOOK;
  return {
    bevel: k.bevel,
    frost: f,
    blur: f > 0.05 && f < 0.97 ? f * (1 - f) * k.blur : 0,
    line: k.line * g,
    rim: k.rim * g,
    shadow: k.shadow * g,
    disp: k.disp,
    lift: k.lift,
  };
}

/** Whether a click belongs to a gesture this control already acted on. Keyboard
    and script clicks (detail 0) never do.
    @param {{ detail: number, timeStamp: number }} e @param {number} until */
export const ownClick = (e, until) => e.detail > 0 && e.timeStamp <= until;

/** Controls with a finger or pointer down.
    @type {Set<GlassControl>} */
const held = new Set();

/** The page ends a held gesture too: Safari can deliver the release elsewhere,
    or not at all. @param {PointerEvent} e */
export function releasePointer(e) {
  for (const c of held) {
    if (!c.pointer) held.delete(c);
    else if (c.pointer.id === e.pointerId) {
      held.delete(c);
      c.end(e.type === 'pointercancel');
    }
  }
}
export function cancelAll() {
  for (const c of held) {
    held.delete(c);
    if (c.pointer) c.end(true);
  }
}

/** The gesture and lens lifecycle every glass control shares. */
export class GlassControl {
  /** @param {HTMLElement} el */
  constructor(el) {
    this.el = el;
    /** @type {{ id: number, x0: number, moved: boolean } | null} */
    this.pointer = null;
    this.flip = false;
    this.dark = false;
    this.swallowUntil = 0;
    this.stopsClick = false;
    /** @type {Map<string, number>} */
    this.timers = new Map();
    /** @type {(() => void) | null} */
    this.stopTrack = null;
    el.addEventListener(
      'click',
      e => {
        if (!ownClick(e, this.swallowUntil)) return;
        this.swallowUntil = 0;
        e.preventDefault();
        if (this.stopsClick) e.stopPropagation();
      },
      true,
    );
  }
  /** @param {PointerEvent} e @param {Element} target */
  hold(e, target) {
    this.swallowUntil = 0;
    this.flip = getComputedStyle(this.el).direction === 'rtl';
    held.add(this);
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* Pointer already gone. */
    }
  }
  /** The browser's own click for this gesture is dropped. */
  swallowClick() {
    this.swallowUntil = performance.now() + CLICK_WINDOW_MS;
  }
  /** @param {string} name @param {() => void} fn @param {number} ms */
  later(name, fn, ms) {
    this.clear(name);
    this.timers.set(
      name,
      window.setTimeout(() => {
        this.timers.delete(name);
        fn();
      }, ms),
    );
  }
  /** @param {string} name */
  clear(name) {
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
  }
  wake() {
    if (this.stopTrack) return;
    this.stopTrack = everyFrame(
      dt => {
        const more = this.frame(dt);
        if (!more) this.stopTrack = null;
        return more;
      },
      () => {
        this.stopTrack = null;
        this.stop();
      },
    );
  }
  /** Steps and draws one frame. @param {number} _dt @returns {boolean} whether to keep going */
  frame(_dt) {
    return false;
  }
  /** Ends the gesture. @param {boolean} _cancelled */
  end(_cancelled) {}
  /** Drops every running part back to the plain control. */
  stop() {
    this.pointer = null;
    held.delete(this);
    for (const name of [...this.timers.keys()]) this.clear(name);
    this.stopTrack?.();
    this.stopTrack = null;
    lensRelease(this);
  }
}
