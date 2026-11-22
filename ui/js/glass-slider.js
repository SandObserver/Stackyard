// @ts-check
import { rubber, Spring } from '/js/frame-motion.js?v=911f7c03';
import { AT_REST, GlassControl, lensLook } from '/js/glass-control.js?v=2995d503';
import { lensClaim, lensFrame, lensPicture, lensRelease } from '/js/glass-gpu.js?v=5cefbe56';
import { behind, clamp, dpr, isDark, over, sized, token, unit } from '/js/glass-paint.js?v=800e4865';

/** Thumb, lens and the rail's box, CSS px. */
const SL = { K: 38, KH: 24, LW: 59, LH: 38, PAD: 24, BOX: 28, RAIL: 6 };
/** Pointer travel in px before a press becomes a drag; how far off the thumb a press still takes it. */
const DRAG_SLOP = 2;
const THUMB_SLOP = 8;
const P = {
  holdMin: 230,
  depth: -7,
  overshoot: 5,
  overshootScale: 60,
  overshootLead: 0.35,
  thinning: 0.25,
  thinFull: 8.6,
  iconPush: 0.35,
  iconMax: 2,
  iconGrow: 0.08,
  iconFull: 5,
  edgeOn: 0.6,
  edgeOff: 0.2,
  edgePop: 3,
  popScale: 0.12,
  restShadow: 0.06,
  follow: /** @type {const} */ ([0.2, 0.9]),
  growIn: /** @type {const} */ ([0.2, 0.86]),
  frostIn: /** @type {const} */ ([0.14, 1]),
  shrink: /** @type {const} */ ([0.22, 0.9]),
  frostOut: /** @type {const} */ ([0.3, 1]),
  back: /** @type {const} */ ([0.3, 1]),
};

const ease = (/** @type {number} */ u) => clamp(u, 0, 1) ** 2 * (3 - 2 * clamp(u, 0, 1));

/** Where the fill ends for a thumb centred at `c` on a rail `W` wide: under the
    thumb's centre, easing out to the rail's ends within one thumb width of them.
    @param {number} c @param {number} W @param {number} K thumb width */
export function fillEnd(c, W, K) {
  const x = clamp(c, 0, W);
  return x < W / 2 ? x * ease((x - K / 2) / K) : W - (W - x) * ease((W - K / 2 - x) / K);
}

/** Colour stops of the last linear gradient on a colour bar. @param {Element} el */
function barStops(el) {
  const bg = getComputedStyle(el).backgroundImage;
  const at = bg.lastIndexOf('linear-gradient(');
  return at < 0 ? [] : bg.slice(at).match(/(?:rgba?|color)\([^)]*\)/g) || [];
}

export class GlassSlider extends GlassControl {
  /** @param {HTMLInputElement} input */
  constructor(input) {
    super(input);
    this.input = input;
    this.wrap = /** @type {HTMLElement} */ (input.parentElement);
    this.cv = document.createElement('canvas');
    this.cv.className = 'glass-lens';
    this.cv.setAttribute('aria-hidden', 'true');
    this.wrap.append(this.cv);
    this.sc = document.createElement('canvas');
    const icons = [...this.wrap.children].filter(n => n.matches('.si, .hsb-ico'));
    /** @type {HTMLElement[]|null} */
    this.ico = icons.length === 2 ? /** @type {HTMLElement[]} */ (icons) : null;
    this.v = new Spring(this.frac());
    this.grow = new Spring(0);
    this.frost = new Spring(1);
    this.ext = new Spring(0);
    this.pop = new Spring(0, 0.32, 0.5);
    this.edge = 0;
    this.v0 = 0;
    this.value0 = input.value;
    this.pressAt = 0;
    this.placed = '';
    this.colKey = '';
    this.col = {
      card: /** @type {number[]} */ ([255, 255, 255]),
      rail: /** @type {number[]} */ ([0, 0, 0]),
      fill: /** @type {number[]} */ ([0, 0, 0]),
      knob: /** @type {number[]} */ ([255, 255, 255]),
    };
    /** @type {string[]} */
    this.stops = [];
    /** The rail's width, left and middle, read once per press. */
    this.geo = { W: 0, L: 0, M: 0 };
    /* The native range follows a touch even after pointerdown preventDefault, so
       both would write the value. */
    input.addEventListener(
      'touchstart',
      e => {
        if (this.pointer) e.preventDefault();
      },
      { passive: false },
    );
    input.addEventListener('pointermove', e => this.move(e));
    input.addEventListener('pointerup', e => this.release(e));
    input.addEventListener('pointercancel', e => this.release(e));
  }
  range() {
    const i = this.input;
    const lo = Number(i.min) || 0;
    const hi = i.max === '' ? 100 : Number(i.max);
    return { lo, hi };
  }
  frac() {
    const { lo, hi } = this.range();
    return hi > lo ? clamp((Number(this.input.value) - lo) / (hi - lo), 0, 1) : 0;
  }
  colours() {
    this.stops = this.input.classList.contains('hsb-range') ? barStops(this.input) : [];
    const key = `${document.documentElement.dataset.theme}`;
    if (key === this.colKey) return;
    this.colKey = key;
    const card = behind(this.input);
    this.dark = isDark(card);
    this.col = {
      card,
      rail: over(token(this.input, '--bd-inner'), card),
      fill: token(this.input, '--ac'),
      knob: token(this.input, '--control-knob'),
    };
  }
  /** Takes the gesture only when the press lands on the thumb; a press on the
      rail keeps the browser's own jump.
      @param {PointerEvent} e @returns {boolean} */
  down(e) {
    const r = this.input.getBoundingClientRect();
    const flip = getComputedStyle(this.input).direction === 'rtl';
    const pos = flip ? 1 - this.frac() : this.frac();
    const tc = SL.K / 2 + (r.width - SL.K) * pos;
    if (Math.abs(e.clientX - r.left - tc) > SL.K / 2 + THUMB_SLOP) return false;
    e.preventDefault();
    this.colours();
    this.geo = {
      W: this.input.offsetWidth,
      L: this.input.offsetLeft,
      M: this.input.offsetTop + this.input.offsetHeight / 2,
    };
    if (!this.pointer && this.grow.v === 0) this.v.snap(this.frac());
    this.clear('shrink');
    this.pointer = { id: e.pointerId, x0: e.clientX, moved: false };
    this.v0 = this.frac();
    this.value0 = this.input.value;
    this.hold(e, this.input);
    this.press();
    return true;
  }
  /** @param {PointerEvent} e */
  move(e) {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    const dx = (e.clientX - p.x0) * (this.flip ? -1 : 1);
    if (!p.moved && Math.abs(dx) < DRAG_SLOP) return;
    p.moved = true;
    const span = this.geo.W - SL.K;
    const raw = this.v0 + dx / span;
    const past = raw > 1 ? (raw - 1) * span : raw < 0 ? raw * span : 0;
    const ext = Math.sign(past) * (P.overshoot / P.overshootScale) * rubber(Math.abs(past), 0, 0, 1 / P.overshootScale);
    this.v.to(clamp(raw, 0, 1), P.follow);
    this.ext.to(ext, P.follow);
    this.setValue(clamp(raw, 0, 1));
    this.wake();
  }
  /** @param {number} f */
  setValue(f) {
    const { lo, hi } = this.range();
    const before = this.input.value;
    this.input.value = String(lo + f * (hi - lo));
    if (this.input.value !== before) this.input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  /** @param {boolean} cancelled */
  end(cancelled) {
    const p = this.pointer;
    if (!p) return;
    this.pointer = null;
    if (cancelled && this.input.value !== this.value0) {
      this.input.value = this.value0;
      this.input.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (p.moved) this.input.dispatchEvent(new Event('change', { bubbles: true }));
    this.ext.to(0, P.back);
    this.v.to(this.frac(), P.follow);
    const shrink = () => {
      if (this.pointer) return;
      this.grow.to(0, P.shrink);
      this.frost.to(1, P.frostOut);
      this.wake();
    };
    const since = performance.now() - this.pressAt;
    if (since >= P.holdMin) shrink();
    else this.later('shrink', shrink, P.holdMin - since);
    this.wake();
  }
  press() {
    this.pressAt = performance.now();
    this.grow.to(1, P.growIn);
    this.frost.to(0, P.frostIn);
    this.wake();
  }
  /** @param {number} dt */
  frame(dt) {
    for (const s of [this.v, this.grow, this.frost, this.ext, this.pop]) s.step(dt);
    const side = this.ext.v > P.edgeOn ? 1 : this.ext.v < -P.edgeOn ? -1 : 0;
    if (side && side !== this.edge) this.pop.vel += P.edgePop;
    if (Math.abs(this.ext.v) < P.edgeOff) this.edge = 0;
    else if (side) this.edge = side;
    const done = !this.pointer && [this.v, this.grow, this.frost, this.ext, this.pop].every(s => s.idle);
    this.render(done);
    return !done;
  }
  stop() {
    super.stop();
    this.grow.snap(0);
    this.frost.snap(1);
    this.ext.snap(0);
    this.pop.snap(0);
    this.render(true);
  }
  /** The end icons lean out when the rail is pulled past them. @param {number} ext */
  icons(ext) {
    if (!this.ico) return;
    const a = Math.abs(ext);
    const k = Math.min(1, a / P.iconFull);
    const push = Math.sign(ext) * Math.min(P.iconMax, a * P.iconPush) * (this.flip ? -1 : 1);
    const sc = 1 + P.iconGrow * k + P.popScale * Math.max(-0.5, this.pop.v);
    const [low, high] = this.ico;
    high.style.transform =
      ext > 0.01 || this.edge > 0
        ? `translateX(${this.flip ? Math.min(0, push) : Math.max(0, push)}px) scale(${sc})`
        : '';
    low.style.transform =
      ext < -0.01 || this.edge < 0
        ? `translateX(${this.flip ? Math.max(0, push) : Math.min(0, push)}px) scale(${sc})`
        : '';
  }
  /** @param {boolean} done */
  render(done) {
    const i = this.input;
    const ext = this.ext.v;
    const a = Math.abs(ext);
    this.icons(ext);
    const g = Math.max(0, this.grow.v);
    const f = clamp(this.frost.v, 0, 1);
    const L = done && g < AT_REST ? null : lensClaim(this, this.cv);
    if (!L) {
      lensRelease(this);
      i.classList.remove('glass-on');
      i.style.removeProperty('transform');
      if (!this.stops.length) i.style.setProperty('--range-fill', String(this.frac()));
      return;
    }
    if (!this.stops.length) i.style.setProperty('--range-fill', String(this.v.v));
    const { W, L: left, M } = this.geo;
    const thin = 1 - P.thinning * Math.min(1, a / P.thinFull);
    const shift = ext * P.overshootLead;
    const sx = (W + a * (1 - P.overshootLead)) / W;
    const fromLow = ext >= 0;
    i.style.transformOrigin = fromLow !== this.flip ? 'left center' : 'right center';
    i.style.transform = a > 0.01 ? `translateX(${shift * (this.flip ? -1 : 1)}px) scale(${sx},${thin})` : '';
    const PAD = SL.PAD;
    const tc = SL.K / 2 + (W - SL.K) * this.v.v + ext;
    const CW = SL.LW + 2 * PAD;
    const CH = SL.BOX + 2 * PAD;
    const x0 = tc - CW / 2;
    const place = `${left}|${M - CH / 2}`;
    if (this.placed !== place || L.cv.style.left === '') {
      this.placed = place;
      L.cv.style.left = `${left}px`;
      L.cv.style.top = `${M - CH / 2}px`;
    }
    L.cv.style.transform = this.flip ? `translateX(${W - x0 - CW}px) scaleX(-1)` : `translateX(${x0}px)`;
    const rh = SL.RAIL * thin;
    const grad = this.stops.length > 1;
    const gpic = grad
      ? lensPicture(L, this, this.stops.join(','), () => {
          const gx = sized(this.sc, 256, 1, 1);
          const lg = gx.createLinearGradient(0, 0, 256, 0);
          this.stops.forEach((st, k) => lg.addColorStop(k / (this.stops.length - 1), st));
          gx.fillStyle = lg;
          gx.fillRect(0, 0, 256, 1);
          return this.sc;
        })
      : null;
    const w = SL.K + (SL.LW - SL.K) * g;
    const h = SL.KH + (SL.LH - SL.KH) * g;
    const look = lensLook(this.dark, g, f);
    lensFrame(L, gpic, gpic, CW, CH, dpr(), {
      ...look,
      rail: {
        card: unit(this.col.card),
        x: (fromLow ? shift : shift + (W - W * sx)) - x0,
        y: PAD + SL.BOX / 2 - rh / 2,
        w: W * sx,
        h: rh,
        rail: unit(this.col.rail),
        fill: unit(this.col.fill),
        fillW: fillEnd(tc, W, SL.K) * sx,
        grad,
      },
      x: tc - x0 - w / 2,
      y: PAD + SL.BOX / 2 - h / 2,
      w,
      h,
      depth: P.depth * g,
      veil: unit(this.col.knob),
      shadow: look.shadow + P.restShadow * (1 - g) * (1 - f),
    });
    i.classList.add('glass-on');
  }
}
