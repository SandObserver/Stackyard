// @ts-check

/** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
    @returns {(p: number) => number} */
export function cubicBezier(x1, y1, x2, y2) {
  const at = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ t) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return p => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < p) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

const KEYWORDS = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

/** @param {string} text @returns {(p: number) => number} */
export function easing(text) {
  const m = /^cubic-bezier\(([^)]*)\)$/.exec(text.trim());
  const c = m ? m[1].split(',').map(Number) : KEYWORDS[/** @type {keyof typeof KEYWORDS} */ (text.trim())];
  if (!c || c.length !== 4 || c.some(n => !Number.isFinite(n))) return p => Math.min(1, Math.max(0, p));
  return cubicBezier(c[0], c[1], c[2], c[3]);
}

/** @typedef {{ step: (now: number) => boolean }} Track */

/** @type {Set<Track>} */
const tracks = new Set();
/** @type {Set<() => void>} */
const afterFrame = new Set();
let pending = false;
let scripted = false;

export const isScripted = () => scripted;
/** Also sets data-glass-live on the root, which turns those CSS transitions off.
    @param {boolean} on */
export const setScripted = on => {
  scripted = on;
  document.documentElement.toggleAttribute('data-glass-live', on);
};

/** Runs after every animation has stepped, once per frame.
    @param {() => void} fn @returns {() => void} removes it */
export function onFrame(fn) {
  afterFrame.add(fn);
  return () => afterFrame.delete(fn);
}

function tick(/** @type {number} */ now) {
  pending = false;
  for (const t of tracks) if (!t.step(now)) tracks.delete(t);
  for (const fn of afterFrame) fn();
  if (tracks.size) schedule();
}

function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(tick);
}

export const requestFrame = schedule;

/** @param {number} duration @param {(p: number) => number} ease
    @param {(p: number) => void} fn @param {() => void} [done]
    @returns {{ cancel: () => void }} */
export function animate(duration, ease, fn, done) {
  let t0 = -1;
  /** @type {Track} */
  const track = {
    step(now) {
      if (t0 < 0) t0 = now;
      const p = duration > 0 ? Math.min(1, (now - t0) / duration) : 1;
      fn(ease(p));
      if (p < 1) return true;
      done?.();
      return false;
    },
  };
  tracks.add(track);
  schedule();
  return { cancel: () => tracks.delete(track) };
}

/** @type {WeakMap<Element, { cancel: () => void }>} */
const glides = new WeakMap();

/** @param {Element} el @param {number} duration @param {(p: number) => number} ease
    @param {(p: number) => void} fn @param {() => void} [done] */
export function glide(el, duration, ease, fn, done) {
  stopGlide(el);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const run = animate(still ? 0 : duration, ease, fn, () => {
    glides.delete(el);
    done?.();
  });
  glides.set(el, run);
}

/** @param {Element} el */
export function stopGlide(el) {
  glides.get(el)?.cancel();
  glides.delete(el);
}
