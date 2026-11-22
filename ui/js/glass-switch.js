// @ts-check
import { rubber, Spring } from '/js/frame-motion.js?v=911f7c03';
import { AT_REST, GlassControl, lensLook } from '/js/glass-control.js?v=2995d503';
import { lensClaim, lensFrame, lensPicture, lensRelease } from '/js/glass-gpu.js?v=5cefbe56';
import { behind, clamp, css, dpr, isDark, mix, over, pill, sized, token, unit } from '/js/glass-paint.js?v=800e4865';
import { contrastMore } from '/js/glass-prefs.js?v=511e01c7';

/** Track, knob and lens, CSS px. */
const SW = { W: 64, H: 28, KW: 38, KH: 24, LW: 60, LH: 40, PAD: 22 };
const TRAVEL = SW.W - 4 - SW.KW;
/** Pointer travel in px before a press becomes a drag. */
const DRAG_SLOP = 3;
const P = {
  pressDelay: 150,
  holdMin: 200,
  travelLead: 45,
  hysteresis: 0.55,
  rubber: 2.2,
  depth: -10,
  squashPerSpeed: 0.00045,
  squashMax: 0.04,
  squashFrom: 0.3,
  squashTall: 0.55,
  restShadow: 0.06,
  wobble: /** @type {const} */ ([0.18, 1]),
  follow: /** @type {const} */ ([0.16, 0.85]),
  travel: /** @type {const} */ ([0.26, 0.9]),
  tone: /** @type {const} */ ([0.26, 1]),
  growIn: /** @type {const} */ ([0.22, 0.9]),
  frostIn: /** @type {const} */ ([0.14, 1]),
  shrink: /** @type {const} */ ([0.18, 1]),
  frostOut: /** @type {const} */ ([0.2, 1]),
};

/** On or off after a gesture. A drag goes by where the finger ended, not where
    the animated knob has reached; a cancel keeps the old state.
    @param {{ cancelled: boolean, moved: boolean, target: number, was: boolean }} g */
export const switchNext = ({ cancelled, moved, target, was }) => (cancelled ? was : moved ? target > 0.5 : !was);

export class GlassSwitch extends GlassControl {
  /** @param {HTMLLabelElement} label */
  constructor(label) {
    super(label);
    this.input = /** @type {HTMLInputElement} */ (label.querySelector('input'));
    this.tr = /** @type {HTMLElement} */ (label.querySelector('.tr'));
    this.cv = document.createElement('canvas');
    this.cv.className = 'glass-lens';
    this.cv.setAttribute('aria-hidden', 'true');
    this.tr.append(this.cv);
    this.sc = document.createElement('canvas');
    const c = this.input.checked ? 1 : 0;
    this.x = new Spring(c);
    this.grow = new Spring(0);
    this.frost = new Spring(1);
    this.tone = new Spring(c);
    this.sq = new Spring(0);
    this.v0 = c;
    this.state = c;
    this.pressed = false;
    this.pressAt = 0;
    this.colKey = '';
    this.col = {
      card: /** @type {number[]} */ ([255, 255, 255]),
      off: /** @type {number[]} */ ([0, 0, 0]),
      on: /** @type {number[]} */ ([0, 0, 0]),
      knob: /** @type {number[]} */ ([255, 255, 255]),
      mark: /** @type {number[]} */ ([0, 0, 0]),
      markOn: /** @type {number[]} */ ([255, 255, 255]),
    };
    label.addEventListener('pointermove', e => this.move(e));
    label.addEventListener('pointerup', e => this.release(e));
    label.addEventListener('pointercancel', e => this.release(e));
  }
  colours() {
    const key = `${document.documentElement.dataset.theme}|${contrastMore()}`;
    if (key === this.colKey) return;
    this.colKey = key;
    const card = behind(this.el);
    this.dark = isDark(card);
    this.col = {
      card,
      off: over(token(this.tr, '--track-off'), card),
      on: over(token(this.tr, '--gn'), card),
      knob: token(this.tr, '--control-knob'),
      mark: token(this.tr, '--dm'),
      markOn: token(this.tr, '--on-fill'),
    };
  }
  /** @param {PointerEvent} e */
  down(e) {
    this.colours();
    const c = this.input.checked ? 1 : 0;
    if (!this.pointer && this.grow.idle && this.grow.v === 0) {
      this.x.snap(c);
      this.tone.snap(c);
    }
    this.clear('shrink');
    this.clear('travel');
    this.pointer = { id: e.pointerId, x0: e.clientX, moved: false };
    this.v0 = this.x.v;
    this.state = c;
    this.hold(e, this.el);
    this.render(false);
    this.later('press', () => this.press(), P.pressDelay);
  }
  /** @param {PointerEvent} e */
  move(e) {
    const p = this.pointer;
    if (!p || e.pointerId !== p.id) return;
    const dx = (e.clientX - p.x0) * (this.flip ? -1 : 1);
    if (!p.moved && Math.abs(dx) < DRAG_SLOP) return;
    if (!p.moved) this.press();
    p.moved = true;
    this.x.to(rubber(this.v0 + dx / TRAVEL, 0, 1, P.rubber), P.follow);
    this.wake();
  }
  /** @param {boolean} cancelled */
  end(cancelled) {
    const p = this.pointer;
    if (!p) return;
    this.pointer = null;
    this.clear('press');
    if (cancelled && !this.pressed) {
      this.render(true);
      return;
    }
    this.press();
    this.pressed = false;
    const was = this.input.checked;
    const next = switchNext({ cancelled, moved: p.moved, target: this.x.t, was });
    this.swallowClick();
    if (next !== was) {
      this.input.checked = next;
      this.input.dispatchEvent(new Event('input', { bubbles: true }));
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    this.settle(next);
  }
  press() {
    this.clear('press');
    if (this.pressed) return;
    this.pressed = true;
    this.pressAt = performance.now();
    this.grow.to(1, P.growIn);
    this.frost.to(0, P.frostIn);
    this.wake();
  }
  /** @param {boolean} on */
  settle(on) {
    const t = on ? 1 : 0;
    const since = performance.now() - this.pressAt;
    const go = () => {
      this.x.to(t, P.travel);
      this.tone.to(t, P.tone);
      this.wake();
    };
    if (since >= P.travelLead) go();
    else this.later('travel', go, P.travelLead - since);
    const shrink = () => {
      if (this.pointer) return;
      this.grow.to(0, P.shrink);
      this.frost.to(1, P.frostOut);
      this.wake();
    };
    if (since >= P.holdMin) shrink();
    else this.later('shrink', shrink, P.holdMin - since);
    this.wake();
  }
  /** @param {number} dt */
  frame(dt) {
    for (const s of [this.x, this.grow, this.frost, this.tone]) s.step(dt);
    if (this.pointer?.moved) {
      if (!this.state && this.x.v > P.hysteresis) this.state = 1;
      else if (this.state && this.x.v < 1 - P.hysteresis) this.state = 0;
      this.tone.to(this.state, P.tone);
    }
    const speed = Math.abs(this.x.vel) * TRAVEL;
    this.sq.to(this.grow.v > P.squashFrom ? Math.min(P.squashMax, speed * P.squashPerSpeed) : 0, P.wobble);
    this.sq.step(dt);
    const done = !this.pointer && [this.x, this.grow, this.frost, this.tone, this.sq].every(s => s.idle);
    this.render(done);
    return !done;
  }
  stop() {
    super.stop();
    this.pressed = false;
    this.grow.snap(0);
    this.sq.snap(0);
    this.frost.snap(1);
    this.render(true);
  }
  /** The I and O that Increase Contrast shows, where the knob leaves them visible.
      @param {CanvasRenderingContext2D} gx @param {number} m on (1) or off (0) */
  marks(gx, m) {
    const pad = SW.PAD;
    const cy = pad + SW.H / 2;
    const at = (/** @type {number} */ x) => pad + (this.flip ? SW.W - x : x);
    gx.globalAlpha = m;
    gx.fillStyle = css(this.col.markOn);
    gx.fillRect(at(15) - 0.75, cy - 5, 1.5, 10);
    gx.globalAlpha = 1 - m;
    gx.strokeStyle = css(this.col.mark);
    gx.lineWidth = 1.4;
    gx.beginPath();
    gx.arc(at(SW.W - 13), cy, 4.35, 0, Math.PI * 2);
    gx.stroke();
    gx.globalAlpha = 1;
  }
  /** @param {boolean} done */
  render(done) {
    const g = Math.max(0, this.grow.v);
    const f = clamp(this.frost.v, 0, 1);
    const m = clamp(this.tone.v, 0, 1);
    const L = done && g < AT_REST ? null : lensClaim(this, this.cv);
    if (!L) {
      lensRelease(this);
      this.el.classList.remove('glass-on');
      this.tr.style.removeProperty('background-color');
      return;
    }
    this.tr.style.backgroundColor = css(mix(this.col.off, this.col.on, m));
    const pos = this.flip ? 1 - this.x.v : this.x.v;
    const cx = 2 + SW.KW / 2 + TRAVEL * pos;
    const q = this.sq.v;
    const w = (SW.KW + (SW.LW - SW.KW) * g) * (1 - q);
    const h = (SW.KH + (SW.LH - SW.KH) * g) * (1 + P.squashTall * q);
    const pad = SW.PAD;
    const CW = SW.W + 2 * pad;
    const CH = SW.H + 2 * pad;
    const marks = contrastMore();
    const key = [dpr(), this.col.card, this.col.off, this.col.on, marks, this.flip].join('|');
    const pic = (/** @type {number} */ t) =>
      lensPicture(L, this, `${key}|${t}`, () => {
        const gx = sized(this.sc, CW, CH);
        gx.fillStyle = css(this.col.card);
        gx.fillRect(0, 0, CW, CH);
        gx.fillStyle = css(t ? this.col.on : this.col.off);
        pill(gx, pad, pad, SW.W, SW.H);
        gx.fill();
        if (marks) this.marks(gx, t);
        return this.sc;
      });
    const look = lensLook(this.dark, g, f);
    lensFrame(L, pic(0), pic(1), CW, CH, dpr(), {
      ...look,
      mix: m,
      x: pad + cx - w / 2,
      y: pad + SW.H / 2 - h / 2,
      w,
      h,
      depth: P.depth * g,
      veil: unit(this.col.knob),
      shadow: look.shadow + P.restShadow * (1 - g),
    });
    this.el.classList.add('glass-on');
  }
}
