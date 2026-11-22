// @ts-check
import { rubber, Spring } from '/js/frame-motion.js?v=911f7c03';
import { AT_REST, GlassControl, lensLook } from '/js/glass-control.js?v=2995d503';
import { lensClaim, lensFrame, lensPicture, lensRelease } from '/js/glass-gpu.js?v=5cefbe56';
import { behind, clamp, colour, css, dpr, isDark, over, pill, sized, unit } from '/js/glass-paint.js?v=800e4865';
import { prefersReducedMotion } from '/js/glass-prefs.js?v=511e01c7';
import { drawTabInks, pillPath, tabInks } from '/js/glass-tabs.js?v=cecbcf6f';
import { holdIcons } from '/js/icon-motion.js?v=7bfd91f5';

/** Pointer travel in px before a press becomes a drag. */
const DRAG_SLOP = 4;
/** Shortest time a lifted lens shows before it can land. */
const LIFT_MIN_MS = 260;
/** How close to its item, in items, the lens may land. */
const LAND_NEAR = 0.06;
/** Room around the bar in the lens picture, CSS px. */
const PAD = 24;

const SEGMENTED = {
  pressDelay: 0,
  widen: 1.094,
  taller: 17,
  depth: -6,
  disp: 0.35,
  bevel: 12,
  line: 0.35,
  stretch: 0.0005,
  maxStretch: 0.22,
  rubber: 0.05,
  land: /** @type {const} */ ([0.34, 0.9]),
  quick: /** @type {const} */ ([0.25, 1]),
  follow: /** @type {const} */ ([0.12, 0.9]),
  growIn: /** @type {const} */ ([0.2, 0.9]),
  frostIn: /** @type {const} */ ([0.12, 1]),
  shrink: /** @type {const} */ ([0.18, 1]),
  frostOut: /** @type {const} */ ([0.2, 1]),
};
const TAB_BAR = { ...SEGMENTED, pressDelay: 150, widen: 1.26, taller: 9, maxStretch: 0 };

const RIM_BAND = 14;
const RIM_PULL = 6;
/** Below this strength the bend is off. */
const RIM_MIN = 0.02;
/** Tint and rim reach full at this much growth. */
const TINT_RAMP = 1.6;

/** @typedef {{ l: number, w: number, c: number, t: number, h: number }} ItemRect left, width, centre, top, height in bar px */
/** @typedef {{ items: () => HTMLElement[], selected: () => number, choose: (i: number) => void,
               pill: () => HTMLElement|null, pillColour: string, P: typeof SEGMENTED, css?: boolean, reselect?: boolean,
               still?: (on: boolean) => void }} BarKind */

/** Fractional item index at bar x `px`. Works for either direction of items.
    @param {ItemRect[]} r @param {number} px */
export function indexAt(r, px) {
  if (r.length < 2) return 0;
  const dir = Math.sign(r[r.length - 1].c - r[0].c) || 1;
  for (let i = 0; i < r.length - 1; i++) {
    const a = r[i].c;
    const z = r[i + 1].c;
    if ((px - a) * dir <= (z - a) * dir || i === r.length - 2) return i + (px - a) / (z - a);
  }
  return 0;
}

/** The pill's box at fractional index `p`; past either end it keeps going.
    @param {ItemRect[]} r @param {number} p */
export function rectAt(r, p) {
  const i = clamp(Math.floor(p), 0, r.length - 1);
  const j = clamp(i + 1, 0, r.length - 1);
  const t = clamp(p - i, 0, 1);
  const ex = p < 0 ? p : p > r.length - 1 ? p - (r.length - 1) : 0;
  const step = r.length > 1 ? r[1].c - r[0].c : 0;
  return {
    c: r[i].c + (r[j].c - r[i].c) * t + ex * step,
    w: r[i].w + (r[j].w - r[i].w) * t,
    t: r[i].t,
    h: r[i].h,
  };
}

/** @param {HTMLElement} el @param {string} v */
function setClip(el, v) {
  if (el.dataset.clip === v) return;
  el.dataset.clip = v;
  el.style.clipPath = v;
}

export class GlassBar extends GlassControl {
  /** @param {HTMLElement} el @param {BarKind} kind */
  constructor(el, kind) {
    super(el);
    this.kind = kind;
    this.P = kind.P;
    this.stopsClick = !!kind.reselect;
    this.cv = document.createElement('canvas');
    this.cv.className = 'glass-lens';
    this.cv.setAttribute('aria-hidden', 'true');
    /** @type {HTMLElement|null} */
    this.lensEl = null;
    /** @type {import('/js/glass-tabs.js?v=cecbcf6f').TabInks|null} */
    this.ink = null;
    this.inkStale = false;
    if (kind.css) {
      this.lensEl = document.createElement('span');
      this.lensEl.className = 'mtab-lens';
      this.lensEl.style.left = '0';
      this.lensEl.setAttribute('aria-hidden', 'true');
      /* Never the first child: moving-pill takes the first child as its pill. */
      const first = el.querySelector(':scope > .mtab');
      if (first) first.before(this.lensEl);
      else el.append(this.lensEl);
      el.append(this.cv);
    } else el.prepend(this.cv);
    this.sc = document.createElement('canvas');
    this.pos = new Spring(Math.max(0, kind.selected()));
    this.grow = new Spring(0);
    this.frost = new Spring(1);
    this.hit = 0;
    this.lifted = false;
    this.landing = false;
    this.liftAt = 0;
    /** @type {ItemRect[]} */
    this.rects = [];
    this.box = { left: 0, w: 0, h: 0 };
    this.col = {
      card: /** @type {number[]} */ ([255, 255, 255]),
      track: /** @type {number[]} */ ([0, 0, 0]),
      pill: /** @type {number[]} */ ([255, 255, 255]),
    };
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerup', e => this.release(e));
    el.addEventListener('pointercancel', e => this.release(e));
  }
  measure() {
    const b = this.el.getBoundingClientRect();
    this.box = { left: b.left, w: b.width, h: b.height };
    this.rects = this.kind.items().map(n => {
      const r = n.getBoundingClientRect();
      return { l: r.left - b.left, w: r.width, c: r.left - b.left + r.width / 2, t: r.top - b.top, h: r.height };
    });
    const card = behind(this.el);
    const track = over(colour(getComputedStyle(this.el).backgroundColor), card);
    this.dark = isDark(track);
    const pillValue = getComputedStyle(this.el.parentElement ?? this.el)
      .getPropertyValue(this.kind.pillColour)
      .trim();
    this.col = { card, track, pill: over(colour(pillValue || '#fff'), track) };
    if (this.kind.css) this.readInk(b);
  }
  /** @param {DOMRect} [b] */
  readInk(b = this.el.getBoundingClientRect()) {
    this.inkStale = false;
    const next = tabInks(this.kind.items(), b, () => {
      this.inkStale = true;
      this.wake();
    });
    if (!next.pending || !this.ink || this.ink.pending) this.ink = next;
  }
  /** @param {PointerEvent} e */
  down(e) {
    const hit = this.kind.items().findIndex(n => n.contains(/** @type {Node} */ (e.target)));
    if (hit < 0) return;
    this.measure();
    if (!this.pointer && !this.lifted) this.pos.snap(Math.max(0, this.kind.selected()));
    this.pointer = { id: e.pointerId, x0: e.clientX, moved: false };
    this.hit = hit;
    this.landing = false;
    this.hold(e, this.el);
    if (hit === this.kind.selected()) this.later('lift', () => this.lift(), this.P.pressDelay);
    else this.clear('lift');
  }
  lift() {
    this.clear('lift');
    if (this.lifted) return;
    this.lifted = true;
    this.liftAt = performance.now();
    if (this.kind.still) {
      this.kind.still(true);
      this.inkStale = true;
    }
    this.grow.to(1, this.P.growIn);
    this.frost.to(0, this.P.frostIn);
    this.wake();
  }
  /** @param {PointerEvent} e */
  move(e) {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    if (!p.moved && Math.abs(e.clientX - p.x0) < DRAG_SLOP) return;
    if (!p.moved) this.lift();
    p.moved = true;
    const raw = indexAt(this.rects, e.clientX - this.box.left);
    this.pos.to(rubber(raw, 0, this.rects.length - 1, 1 / this.P.rubber), this.P.follow);
    this.wake();
  }
  /** @param {boolean} cancelled */
  end(cancelled) {
    const p = this.pointer;
    if (!p) return;
    this.pointer = null;
    this.clear('lift');
    if (cancelled && !this.lifted) return;
    const last = this.rects.length - 1;
    const i = cancelled
      ? Math.max(0, this.kind.selected())
      : p.moved
        ? clamp(Math.round(this.pos.t), 0, last)
        : this.hit;
    this.lift();
    this.pos.to(i, this.P.land);
    this.landing = true;
    if (!cancelled && (i !== this.kind.selected() || (this.kind.reselect && !p.moved))) {
      this.kind.choose(i);
      this.inkStale = true;
    }
    this.swallowClick();
    this.wake();
  }
  /** A change from the keyboard or the page: the pill moves, no lens. */
  follow() {
    if (this.pointer || this.lifted) return;
    this.measure();
    const i = Math.max(0, this.kind.selected());
    if (prefersReducedMotion()) this.pos.snap(i);
    else this.pos.to(i, this.P.quick);
    this.wake();
  }
  /** After a resize, with no gesture running. */
  resettle() {
    if (this.pointer || this.lifted) return;
    this.measure();
    this.pos.snap(Math.max(0, this.kind.selected()));
    this.render(true);
  }
  /** @param {number} dt */
  frame(dt) {
    for (const s of [this.pos, this.grow, this.frost]) s.step(dt);
    if (
      this.landing &&
      !this.pointer &&
      Math.abs(this.pos.v - this.pos.t) < LAND_NEAR &&
      performance.now() - this.liftAt > LIFT_MIN_MS
    ) {
      this.landing = false;
      this.grow.to(0, this.P.shrink);
      this.frost.to(1, this.P.frostOut);
    }
    const done = !this.pointer && !this.landing && [this.pos, this.grow, this.frost].every(s => s.idle);
    if (done) {
      this.lifted = false;
      this.kind.still?.(false);
    }
    this.render(done);
    return !done;
  }
  stop() {
    super.stop();
    this.lifted = false;
    this.kind.still?.(false);
    this.landing = false;
    this.grow.snap(0);
    this.frost.snap(1);
    this.pos.snap(Math.max(0, this.kind.selected()));
    this.render(true);
    this.el.classList.remove('glass-moving');
  }
  /** @param {boolean} done */
  render(done) {
    const pillEl = this.kind.pill();
    const g = Math.max(0, this.grow.v);
    const f = clamp(this.frost.v, 0, 1);
    if (!this.rects.length) return;
    const R = rectAt(this.rects, this.pos.v);
    if (pillEl?.classList.contains('segr-pill')) {
      this.el.classList.toggle('glass-moving', !done);
      pillEl.style.background = css(this.col.pill);
      pillEl.style.width = `${R.w}px`;
      pillEl.style.height = `${R.h}px`;
      pillEl.style.transform = `translate(${R.c - R.w / 2}px,${R.t}px)`;
    }
    const step = this.rects.length > 1 ? Math.abs(this.rects[1].c - this.rects[0].c) : 0;
    const st = 1 + Math.min(this.P.maxStretch, Math.abs(this.pos.vel) * step * this.P.stretch);
    const w = R.w * (1 + (this.P.widen - 1) * g) * st;
    const h = R.h + this.P.taller * g;
    if (this.kind.css) this.cssLens(done, R, w, h, g, f);
    else this.glLens(done, R, w, h, g, f);
  }
  /** @param {boolean} done @param {{ c: number, w: number, t: number, h: number }} R
      @param {number} w @param {number} h @param {number} g @param {number} f */
  glLens(done, R, w, h, g, f) {
    const L = done && g < AT_REST ? null : lensClaim(this, this.cv, true);
    if (!L) {
      lensRelease(this);
      this.el.classList.remove('glass-on');
      return;
    }
    const CW = this.box.w + 2 * PAD;
    const CH = this.box.h + 2 * PAD;
    const pic = lensPicture(L, this, [dpr(), this.box.w, this.box.h, this.col.card, this.col.track].join('|'), () => {
      const gx = sized(this.sc, CW, CH);
      gx.fillStyle = css(this.col.card);
      gx.fillRect(0, 0, CW, CH);
      gx.fillStyle = css(this.col.track);
      pill(gx, PAD, PAD, this.box.w, this.box.h);
      gx.fill();
      return this.sc;
    });
    const look = lensLook(this.dark, g, f);
    lensFrame(L, pic, pic, CW, CH, dpr(), {
      ...look,
      x: PAD + R.c - w / 2,
      y: PAD + R.t + R.h / 2 - h / 2,
      w,
      h,
      bevel: this.P.bevel,
      depth: this.P.depth * g,
      veil: unit(this.col.pill),
      line: look.line * this.P.line,
      disp: this.P.disp * g,
    });
    this.el.classList.add('glass-on');
  }
  /** The tab bar's lens, a CSS layer.
      @param {boolean} done @param {{ c: number, w: number, t: number, h: number }} R
      @param {number} w @param {number} h @param {number} g @param {number} f */
  cssLens(done, R, w, h, g, f) {
    const lens = /** @type {HTMLElement} */ (this.lensEl);
    if (done && g < AT_REST) {
      this.el.classList.remove('glass-on');
      this.bend(0, 0, 0, 0, 0);
      return;
    }
    lens.style.width = `${R.w}px`;
    lens.style.height = `${R.h}px`;
    lens.style.transform = `translate(${R.c - R.w / 2}px,${R.t}px) scale(${w / R.w},${h / R.h})`;
    lens.style.setProperty('--f', f.toFixed(3));
    lens.style.setProperty('--g', clamp(Math.min(g * TINT_RAMP, 1 - f), 0, 1).toFixed(3));
    this.el.classList.add('glass-on');
    this.bend(R.c, R.t + R.h / 2, w, h, g * (1 - f));
  }
  /** @param {number} cx @param {number} cy @param {number} w @param {number} h @param {number} strength */
  bend(cx, cy, w, h, strength) {
    const tabs = this.kind.items();
    if (strength > RIM_MIN && this.inkStale) this.readInk();
    const ink = this.ink;
    const L = strength > RIM_MIN && ink && !ink.pending ? lensClaim(this, this.cv, true) : null;
    this.el.classList.toggle('glass-bending', !!L);
    if (!L || !ink) {
      for (const t of tabs) setClip(t, '');
      lensRelease(this);
      return;
    }
    const CW = this.box.w + 2 * PAD;
    const CH = this.box.h + 2 * PAD;
    const pic = lensPicture(
      L,
      this,
      ['ink', dpr(), this.box.w, this.box.h, ink.key].join('|'),
      () => {
        const gx = sized(this.sc, CW, CH);
        gx.clearRect(0, 0, CW, CH);
        drawTabInks(gx, ink.items, PAD);
        return this.sc;
      },
      true,
    );
    lensFrame(L, pic, pic, CW, CH, dpr(), {
      x: PAD + cx - w / 2,
      y: PAD + cy - h / 2,
      w,
      h,
      bevel: Math.min(Math.min(h, w) / 2, RIM_BAND),
      depth: -RIM_PULL * strength,
      ink: true,
      shadow: 0,
    });
    const left = cx - w / 2;
    this.rects.forEach((rc, n) => {
      const t = tabs[n];
      if (!t) return;
      if (rc.l + rc.w <= left || rc.l >= left + w) {
        setClip(t, '');
        return;
      }
      setClip(
        t,
        `path(evenodd, 'M-50 -50H${(rc.w + 50).toFixed(0)}V${(rc.h + 50).toFixed(0)}H-50Z${pillPath(cx - rc.l, cy - rc.t, w, h)}')`,
      );
    });
  }
}

/** @param {HTMLElement} segr @returns {BarKind} */
export const segmented = segr => {
  const radios = () => /** @type {HTMLInputElement[]} */ ([...segr.querySelectorAll('.segr-opt input')]);
  return {
    items: () => /** @type {HTMLElement[]} */ ([...segr.querySelectorAll('.segr-opt')]),
    selected: () => radios().findIndex(r => r.checked),
    choose: i => {
      const r = radios()[i];
      if (!r) return;
      r.checked = true;
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
    },
    pill: () => segr.querySelector(':scope > .segr-pill'),
    pillColour: '--segment-on',
    P: SEGMENTED,
  };
};

/** @param {HTMLElement} bar @returns {BarKind} */
export const tabBar = bar => {
  const tabs = () => /** @type {HTMLElement[]} */ ([...bar.querySelectorAll(':scope > .mtab')]);
  return {
    items: tabs,
    selected: () => tabs().findIndex(n => n.classList.contains('active')),
    choose: i => tabs()[i]?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })),
    reselect: true,
    pill: () => bar.querySelector(':scope > .gs-pill'),
    pillColour: '--tab-pill',
    P: TAB_BAR,
    css: true,
    still: on => holdIcons(bar, on),
  };
};
