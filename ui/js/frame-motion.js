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

/** @typedef {{ step: (now: number) => boolean, fail?: (err: unknown) => void }} Track */

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
  for (const t of tracks) {
    try {
      if (!t.step(now)) tracks.delete(t);
    } catch (err) {
      tracks.delete(t);
      t.fail?.(err);
      console.warn('[motion]', err);
    }
  }
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

/** A damped spring. `response` is its period in seconds; `damping` is the
    fraction of critical damping. */
export class Spring {
  /** @param {number} v @param {number} [response] @param {number} [damping] */
  constructor(v, response = 0.3, damping = 0.8) {
    this.v = v;
    this.t = v;
    this.vel = 0;
    this.r = response;
    this.k = 0;
    this.c = 0;
    this.set(response, damping);
  }
  /** @param {number} response @param {number} damping */
  set(response, damping) {
    this.r = response;
    this.k = ((2 * Math.PI) / response) ** 2;
    this.c = (4 * Math.PI * damping) / response;
    return this;
  }
  /** @param {number} t @param {readonly [number, number]} [rd] response and damping */
  to(t, rd) {
    this.t = t;
    if (rd) this.set(rd[0], rd[1]);
    return this;
  }
  /** @param {number} v */
  snap(v) {
    this.v = v;
    this.t = v;
    this.vel = 0;
  }
  /** @param {number} dt seconds */
  step(dt) {
    if (this.r < SPRING_JUMP) {
      this.snap(this.t);
      return;
    }
    /* Fewer substeps let a stiff spring diverge to Infinity. */
    const n = Math.min(400, Math.max(Math.ceil(dt / 0.004), Math.ceil((dt * Math.sqrt(this.k)) / 0.3)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel += (-this.k * (this.v - this.t) - this.c * this.vel) * h;
      this.v += this.vel * h;
    }
    if (Math.abs(this.v - this.t) < 5e-4 && Math.abs(this.vel) < 5e-3) this.snap(this.t);
  }
  get idle() {
    return this.v === this.t && this.vel === 0;
  }
}
/** A response below this many seconds is a jump. */
const SPRING_JUMP = 0.02;

/** Past an end, movement shrinks the further it goes.
    @param {number} x @param {number} lo @param {number} hi @param {number} k */
export const rubber = (x, lo, hi, k) =>
  x < lo ? lo - (1 - 1 / ((lo - x) * k + 1)) / k : x > hi ? hi + (1 - 1 / ((x - hi) * k + 1)) / k : x;

/** Calls `fn(dt)` every frame, dt in seconds and at most 50 ms, until it returns
    false. A throw ends it and calls `fail`.
    @param {(dt: number) => boolean} fn @param {(err: unknown) => void} [fail]
    @returns {() => void} stops it */
export function everyFrame(fn, fail) {
  let last = -1;
  /** @type {Track} */
  const entry = {
    step(now) {
      const dt = last < 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
      last = now;
      return fn(dt);
    },
    fail,
  };
  tracks.add(entry);
  schedule();
  return () => tracks.delete(entry);
}
