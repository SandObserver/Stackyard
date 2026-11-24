// @ts-check
import { rubber, Spring } from '/js/frame-motion.js?v=911f7c03';
import { AT_REST, GlassControl, lensLook } from '/js/glass-control.js?v=00019b96';
import { lensClaim, lensFrame, lensPicture, lensRelease } from '/js/glass-gpu.js?v=bfd7c78f';
import { behind, clamp, colour, css, dpr, isDark, over, pill, sized, unit } from '/js/glass-paint.js?v=800e4865';
import { prefersReducedMotion } from '/js/glass-prefs.js?v=b53a71ac';
import { drawTabInks, pillPath, tabInks } from '/js/glass-tabs.js?v=f20d2f91';
import { syncGlideSelect } from '/js/glide-select.js?v=0c57b286';
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
  liftAny: false,
  deferChoose: false,
  tap: /** @type {readonly [number, number]} */ ([0.34, 0.9]),
  tapLiftMin: LIFT_MIN_MS,
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
  swell: 0,
  swellIn: /** @type {const} */ ([0.26, 0.68]),
  swellOut: /** @type {const} */ ([0.26, 0.72]),
  drag: 0,
  dragStretch: 0,
  bend: 0,
  moveBend: 0,
  vert: 1,
  squeeze: 0,
  squeezeBand: 16,
  restFringe: 0,
  moveFringe: 0,
  moveFull: 4,
  moveIn: /** @type {const} */ ([0.12, 1]),
  plainTap: /** @type {const} */ ([0.12, 1]),
  plainRubber: 0.02,
  flashOut: /** @type {const} */ ([0.25, 1]),
};
const TAB_BAR = {
  ...SEGMENTED,
  liftAny: true,
  deferChoose: true,
  tap: /** @type {readonly [number, number]} */ ([0.26, 0.9]),
  tapLiftMin: 80,
  widen: 1.22,
  taller: 17,
  maxStretch: 0,
  swell: 0.04,
  rubber: 0.1,
  drag: 0.2,
  dragStretch: 0.7,
  bend: 0.35,
  moveBend: 1.6,
  vert: 0,
  squeeze: 3.6,
  squeezeBand: 16,
  restFringe: 0.1,
  moveFringe: 0.18,
};

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
    /** @type {import('/js/glass-tabs.js?v=f20d2f91').TabInks|null} */
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
      this.lensEl.before(this.cv);
    } else el.prepend(this.cv);
    this.sc = document.createElement('canvas');
    this.pos = new Spring(Math.max(0, kind.selected()));
    this.grow = new Spring(0);
    this.frost = new Spring(1);
    this.swell = new Spring(0);
    this.motion = new Spring(0);
    this.flash = new Spring(0);
    this.plain = false;
    this.hit = 0;
    this.lifted = false;
    this.landing = false;
    this.liftAt = 0;
    this.tapped = false;
    /** @type {number|undefined} */
    this.chosen = undefined;
    this.scale = 1;
    this.shift = 0;
    /** @type {import('/js/glass-tabs.js?v=f20d2f91').Lit|undefined} */
    this.lit = undefined;
    /** @type {ItemRect[]} */
    this.rects = [];
    this.box = { left: 0, w: 0, h: 0, dx: 0, dy: 0, pw: 0 };
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
    const was = this.el.style.transform;
    if (was) this.el.style.transform = '';
    const b = this.el.getBoundingClientRect();
    const o = this.kind.css ? originOf(this.el) : { left: b.left, top: b.top, width: b.width };
    this.box = { left: b.left, w: b.width, h: b.height, dx: b.left - o.left, dy: b.top - o.top, pw: o.width };
    this.rects = this.kind.items().map(n => {
      const r = n.getBoundingClientRect();
      return { l: r.left - o.left, w: r.width, c: r.left - o.left + r.width / 2, t: r.top - o.top, h: r.height };
    });
    const card = behind(this.el);
    const track = over(colour(getComputedStyle(this.el).backgroundColor), card);
    this.dark = isDark(track);
    const pillValue = getComputedStyle(this.el.parentElement ?? this.el)
      .getPropertyValue(this.kind.pillColour)
      .trim();
    this.col = { card, track, pill: over(colour(pillValue || '#fff'), track) };
    if (this.kind.css) {
      this.lit = litColours(this.el);
      this.readInk(o);
    }
    if (was) this.el.style.transform = was;
  }
  /** @param {{ left: number, top: number }} [b] the bar's content origin */
  readInk(b) {
    this.inkStale = false;
    const was = this.el.style.transform;
    if (was) this.el.style.transform = '';
    b ??= originOf(this.el);
    const next = tabInks(
      this.kind.items(),
      b,
      () => {
        this.inkStale = true;
        this.wake();
      },
      this.lit,
    );
    if (was) this.el.style.transform = was;
    if (!next.pending || !this.ink || this.ink.pending) this.ink = next;
  }
  /** @param {PointerEvent} e */
  down(e) {
    let hit = this.kind.items().findIndex(n => n.contains(/** @type {Node} */ (e.target)));
    /* A tab under the lens is clip-pathed, so a press there targets the bar. */
    if (hit < 0 && (!this.kind.css || e.target !== this.el)) return;
    this.measure();
    if (hit < 0) {
      const mid = this.box.left + this.box.w / 2;
      const x = (e.clientX - mid) / this.scale + this.box.w / 2;
      hit = nearestItem(this.rects, x);
    }
    this.commit();
    if (!this.pointer && !this.lifted) this.plain = !!this.kind.css && prefersReducedMotion();
    if (!this.pointer && !this.lifted) this.pos.snap(Math.max(0, this.kind.selected()));
    this.pointer = { id: e.pointerId, x0: e.clientX, moved: false };
    this.hit = hit;
    this.landing = false;
    this.hold(e, this.el);
    if (this.P.liftAny) {
      this.lift();
      if (this.plain) this.flash.snap(1);
      if (Math.round(this.pos.t) !== hit) this.pos.to(hit, this.plain ? this.P.plainTap : this.P.tap);
      this.wake();
    } else if (hit === this.kind.selected()) this.later('lift', () => this.lift(), this.P.pressDelay);
    else this.clear('lift');
  }
  lift() {
    this.clear('lift');
    if (this.lifted && (this.plain || !this.P.liftAny || this.grow.t === 1)) return;
    this.lifted = true;
    this.landing = false;
    this.liftAt = performance.now();
    if (this.kind.css) this.el.classList.add('glass-lifted');
    this.kind.still?.(true);
    if (this.plain) {
      this.wake();
      return;
    }
    this.grow.to(1, this.P.growIn);
    if (this.P.swell && !prefersReducedMotion()) this.swell.to(1, this.P.swellIn);
    this.frost.to(0, this.P.frostIn);
    this.wake();
  }
  /** @param {PointerEvent} e */
  move(e) {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    if (!p.moved && Math.abs(e.clientX - p.x0) < DRAG_SLOP) return;
    if (!p.moved) {
      this.lift();
      this.flash.to(0, this.P.flashOut);
    }
    p.moved = true;
    const mid = this.box.left + this.box.w / 2;
    const raw = indexAt(this.rects, (e.clientX - mid - this.shift) / this.scale + this.box.w / 2);
    const k = this.plain ? this.P.plainRubber : this.P.rubber;
    this.pos.to(rubber(raw, 0, this.rects.length - 1, 1 / k), this.P.follow);
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
    this.tapped = !p.moved;
    if (this.tapped && this.P.swell) this.swell.to(0, this.P.swellOut);
    this.pos.to(i, this.plain ? this.P.plainTap : this.tapped ? this.P.tap : this.P.land);
    this.flash.to(0, this.P.flashOut);
    this.landing = true;
    if (!cancelled && (i !== this.kind.selected() || (this.kind.reselect && !p.moved))) {
      if (this.P.deferChoose) this.chosen = i;
      else this.kind.choose(i);
    }
    this.swallowClick();
    this.wake();
  }
  /** Clear the swallow window first, or the pick click is dropped as the gesture click. */
  commit() {
    if (this.chosen === undefined) return;
    const i = this.chosen;
    this.chosen = undefined;
    this.swallowUntil = 0;
    this.kind.choose(i);
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
  /** Measure mid-gesture too. Old tab places make a release pick the wrong tab. */
  resettle() {
    this.measure();
    if (this.pointer || this.lifted) {
      this.wake();
      return;
    }
    this.pos.snap(Math.max(0, this.kind.selected()));
    this.render(true);
  }
  /** @param {number} dt */
  frame(dt) {
    this.motion.to(clamp(Math.abs(this.pos.vel) / this.P.moveFull, 0, 1), this.P.moveIn);
    for (const s of [this.pos, this.grow, this.frost, this.swell, this.motion, this.flash]) s.step(dt);
    if (
      this.landing &&
      !this.pointer &&
      Math.abs(this.pos.v - this.pos.t) < LAND_NEAR &&
      performance.now() - this.liftAt > (this.tapped ? this.P.tapLiftMin : LIFT_MIN_MS)
    ) {
      this.landing = false;
      this.commit();
      this.el.classList.remove('glass-lifted');
      this.grow.to(0, this.P.shrink);
      if (this.P.swell) this.swell.to(0, this.P.swellOut);
      this.frost.to(1, this.P.frostOut);
    }
    const done =
      !this.pointer && !this.landing && [this.pos, this.grow, this.frost, this.swell, this.flash].every(s => s.idle);
    if (done) {
      this.commit();
      this.lifted = false;
      this.el.classList.remove('glass-lifted');
      this.kind.still?.(false);
    }
    this.render(done);
    if (done && this.kind.css) syncGlideSelect(document, { snap: true });
    return !done;
  }
  stop() {
    super.stop();
    this.lifted = false;
    this.el.classList.remove('glass-lifted');
    this.kind.still?.(false);
    this.landing = false;
    this.grow.snap(0);
    this.frost.snap(1);
    this.swell.snap(0);
    this.motion.snap(0);
    this.flash.snap(0);
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
    if (this.P.swell) {
      this.scale = 1 + this.P.swell * Math.max(0, this.swell.v);
      this.shift = prefersReducedMotion() ? 0 : edgePull(this.rects, this.pos.v, this.P.drag);
      const sx = this.scale * (1 + (Math.abs(this.shift) * this.P.dragStretch) / Math.max(1, this.box.w));
      const still = done || (this.scale < 1.0005 && Math.abs(this.shift) < 0.05);
      const t = still ? '' : `translateX(${this.shift.toFixed(2)}px) scale(${sx.toFixed(4)},${this.scale.toFixed(4)})`;
      if (this.el.style.transform !== t) this.el.style.transform = t;
      if (!t) {
        this.scale = 1;
        this.shift = 0;
      }
    }
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
      this.bend(0, 0, 0, 0, 0, false);
      return;
    }
    lens.style.width = `${R.w}px`;
    lens.style.height = `${R.h}px`;
    lens.style.transform = `translate(${R.c - R.w / 2}px,${R.t}px) scale(${w / R.w},${h / R.h})`;
    lens.style.setProperty('--f', f.toFixed(3));
    lens.style.setProperty('--g', clamp(Math.min(g * TINT_RAMP, 1 - f), 0, 1).toFixed(3));
    lens.style.setProperty('--hl', clamp(this.flash.v, 0, 1).toFixed(3));
    this.el.classList.toggle('glass-plain', this.plain);
    this.el.classList.add('glass-on');
    this.bend(R.c, R.t + R.h / 2, w, h, g * (1 - f), this.plain && this.lifted);
  }
  /** @param {number} cx @param {number} cy @param {number} w @param {number} h @param {number} strength
      @param {boolean} flat the selected inks show under the pill, with no bend */
  bend(cx, cy, w, h, strength, flat) {
    const tabs = this.kind.items();
    const on = flat || strength > RIM_MIN;
    if (on && this.inkStale) this.readInk();
    const ink = this.ink;
    const L = on && ink && !ink.pending ? lensClaim(this, this.cv, true) : null;
    this.el.classList.toggle('glass-bending', !!L);
    if (!L || !ink) {
      for (const t of tabs) setClip(t, '');
      lensRelease(this);
      return;
    }
    /* Padding-box width. A border-box width shifts the picture right to left. */
    const CW = this.box.pw + 2 * PAD;
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
    const barPic = lensPicture(
      L,
      this,
      ['bar', dpr(), this.box.w, this.box.h, this.dark, this.col.card, this.col.track].join('|'),
      () => {
        const gx = sized(this.sc, CW, CH);
        gx.fillStyle = css(this.col.card);
        gx.fillRect(0, 0, CW, CH);
        gx.fillStyle = css(this.col.track);
        const bx = PAD + this.box.dx;
        const by = PAD + this.box.dy;
        pill(gx, bx, by, this.box.w, this.box.h);
        gx.fill();
        gx.lineWidth = 1.5;
        gx.strokeStyle = this.dark ? 'rgba(255,255,255,.32)' : 'rgba(0,0,0,.14)';
        pill(gx, bx + 0.75, by + 0.75, this.box.w - 1.5, this.box.h - 1.5);
        gx.stroke();
        return this.sc;
      },
    );
    const ramp = flat ? 0 : clamp((strength - RIM_MIN) / 0.35, 0, 1);
    const s = flat ? 0 : strength;
    const m = Math.max(0, Math.min(1, this.motion.v));
    lensFrame(L, pic, barPic, CW, CH, dpr(), {
      mix: ramp * ramp * (3 - 2 * ramp),
      x: PAD + cx - w / 2,
      y: PAD + cy - h / 2,
      w,
      h,
      slab: {
        side: Math.min(h, w),
        bend: profileBend(this.P.bend * (1 + this.P.moveBend * m) * s),
        vert: this.P.vert,
      },
      squeeze: this.P.squeeze * s,
      squeezeBand: this.P.squeezeBand,
      ink: true,
      disp: (this.P.restFringe + this.P.moveFringe * m) * s,
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

/** Each bend value caches a profile. Keep to steps of 0.01 or the cache grows without bound.
    @param {number} b */
export const profileBend = b => Math.round(100 * b) / 100;

/** @param {ItemRect[]} r @param {number} p fractional index @param {number} k share of the overshoot */
export function edgePull(r, p, k) {
  const last = r.length - 1;
  if (last < 1) return 0;
  const past = p < 0 ? p : p > last ? p - last : 0;
  return past * Math.abs(r[1].c - r[0].c) * k * (Math.sign(r[last].c - r[0].c) || 1);
}

/** @param {ItemRect[]} r @param {number} px */
export const nearestItem = (r, px) => clamp(Math.round(indexAt(r, px)), 0, r.length - 1);

/** Where absolutely placed children start: inside the border, not at the box edge.
    @param {HTMLElement} el */
function originOf(el) {
  const probe = document.createElement('i');
  probe.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0';
  el.append(probe);
  const r = probe.getBoundingClientRect();
  probe.style.cssText = 'position:absolute;right:0;top:0;width:0;height:0';
  const end = probe.getBoundingClientRect().left;
  probe.remove();
  return { left: r.left, top: r.top, width: end - r.left };
}

/** @param {HTMLElement} bar */
function litColours(bar) {
  const probe = document.createElement('i');
  probe.style.cssText = 'position:absolute;width:0;height:0;color:var(--ac2)';
  bar.append(probe);
  const color = getComputedStyle(probe).color;
  probe.style.color = 'var(--ac)';
  const accent = getComputedStyle(probe).color;
  probe.remove();
  return { color, accent };
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
