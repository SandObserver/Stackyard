import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'css/admin.css'), 'utf8');

/** Media features the fake browser reports, read live like a MediaQueryList. */
let media = /** @type {string[]} */ ([]);
globalThis.matchMedia = /** @type {any} */ (
  q => ({
    get matches() {
      return media.some(m => q.includes(m));
    },
  })
);
/** A WebGL2 stand-in where every call succeeds. */
const fakeGl = () =>
  new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'getProgramParameter' || key === 'getShaderParameter'
          ? () => true
          : key === 'getActiveUniform'
            ? () => null
            : () => ({}),
    },
  );
/** @type {object|null} */
let webgl = null;
const realNow = performance.now.bind(performance);
let skew = 0;
performance.now = () => realNow() + skew;
const fakeEl = (/** @type {string} */ tag) => ({
  tagName: tag.toUpperCase(),
  className: '',
  style: { setProperty() {}, removeProperty() {} },
  dataset: {},
  hidden: false,
  listeners: /** @type {Record<string, Function>} */ ({}),
  setAttribute() {},
  addEventListener(/** @type {string} */ type, /** @type {Function} */ fn) {
    this.listeners[type] = fn;
  },
  getContext: () => webgl,
  append() {},
  prepend() {},
  /** @type {any[]} */
  placedBefore: [],
  before(/** @type {any} */ n) {
    this.placedBefore.push(n);
  },
});
globalThis.document = /** @type {any} */ ({
  documentElement: { dataset: {} },
  createElement: fakeEl,
});
globalThis.window = /** @type {any} */ (globalThis);

const { glassAllowed, tabBarAllowed } = await import('../js/glass-controls.js');
const { ownClick, GlassControl, CLICK_WINDOW_MS, pointOver, releasePointer } = await import('../js/glass-control.js');
const { switchNext } = await import('../js/glass-switch.js');
const { fillEnd } = await import('../js/glass-slider.js');
const { indexAt, rectAt, edgePull, nearestItem, profileBend, GlassBar, tabBar, segmented } = await import(
  '../js/glass-bar.js'
);
const { pillPath, referencedIds } = await import('../js/glass-tabs.js');
const { parseColour, over } = await import('../js/glass-paint.js');
const { lensPicture } = await import('../js/glass-gpu.js');

test('glass is on only with WebGL2 and none of Reduce Transparency, Reduce Motion or forced colours', () => {
  assert.equal(glassAllowed(), false, 'no WebGL2 means no glass');
  webgl = fakeGl();
  skew += 60_000;
  assert.equal(glassAllowed(), true, 'WebGL2 is tried again later');
  document.documentElement.dataset.transparency = 'reduce';
  assert.equal(glassAllowed(), false);
  delete document.documentElement.dataset.transparency;
  media = ['prefers-reduced-motion'];
  assert.equal(glassAllowed(), false);
  media = ['forced-colors'];
  assert.equal(glassAllowed(), false);
  media = [];
  assert.equal(glassAllowed(), true);
});

test('the tab bar keeps its gesture under Reduce Motion, but not under Reduce Transparency or forced colours', () => {
  media = ['prefers-reduced-motion'];
  assert.equal(glassAllowed(), false);
  assert.equal(tabBarAllowed(), true);
  document.documentElement.dataset.transparency = 'reduce';
  assert.equal(tabBarAllowed(), false);
  delete document.documentElement.dataset.transparency;
  media = ['forced-colors'];
  assert.equal(tabBarAllowed(), false);
  media = [];
  assert.equal(tabBarAllowed(), true);
});

test('a switch decides from where the finger ended, not where the knob has got to', () => {
  const base = { cancelled: false, moved: true, was: false };
  assert.equal(switchNext({ ...base, target: 0.9 }), true, 'a fast flick to the right turns it on');
  assert.equal(switchNext({ ...base, target: 0.2 }), false);
  assert.equal(switchNext({ ...base, was: true, target: 0.1 }), false, 'a flick back turns it off');
  assert.equal(switchNext({ ...base, moved: false, target: 0 }), true, 'a tap toggles');
  assert.equal(switchNext({ ...base, moved: false, was: true, target: 1 }), false);
  assert.equal(switchNext({ ...base, cancelled: true, target: 1 }), false, 'a cancel keeps the state');
});

test('the slider fill ends under the thumb and eases to the rail ends', () => {
  const W = 300;
  const K = 38;
  assert.equal(fillEnd(K / 2, W, K), 0, 'thumb all the way left: no fill');
  assert.equal(fillEnd(W - K / 2, W, K), W, 'thumb all the way right: full');
  assert.equal(fillEnd(150, W, K), 150, 'in the middle the fill meets the thumb centre');
  assert.equal(fillEnd(K / 2 + K, W, K), K / 2 + K, 'one thumb width in, it is back under the centre');
  const a = fillEnd(K / 2 + 5, W, K);
  const b = fillEnd(K / 2 + 15, W, K);
  assert.ok(a > 0 && b > a && b < K / 2 + 15, 'near the end it grows smoothly from zero');
  assert.equal(fillEnd(-20, W, K), 0, 'a rubber-band pull past the start stays empty');
});

/** Three items, 60 px wide, centres at 30, 90, 150. */
const LTR = [0, 60, 120].map(l => ({ l, w: 60, c: l + 30, t: 2, h: 28 }));
const RTL = [...LTR].reverse();

test('the bar maps a pointer x to an item index in either direction', () => {
  assert.equal(indexAt(LTR, 30), 0);
  assert.equal(indexAt(LTR, 120), 1.5);
  assert.equal(indexAt(LTR, 150), 2);
  assert.equal(indexAt(RTL, 150), 0, 'right to left, the first item is on the right');
  assert.equal(indexAt(RTL, 30), 2);
  assert.equal(indexAt(LTR, 210), 3, 'past the last item it keeps counting, for the rubber band');
  assert.equal(indexAt(LTR.slice(0, 1), 500), 0);
});

test('the pill box follows a fractional index and keeps going past the ends', () => {
  assert.deepEqual(rectAt(LTR, 1), { c: 90, w: 60, t: 2, h: 28 });
  assert.equal(rectAt(LTR, 0.5).c, 60);
  assert.equal(rectAt(LTR, -0.25).c, 15);
  assert.equal(rectAt(LTR, 2.5).c, 180);
  assert.equal(rectAt(RTL, 0.5).c, 120);
});

test('a pill path traces the lens outline: two straight sides and two half circles', () => {
  const m =
    /^M([\d.-]+) ([\d.-]+)H([\d.-]+)A([\d.]+) [\d.]+ 0 0 1 ([\d.-]+) ([\d.-]+)H([\d.-]+)A[\d.]+ [\d.]+ 0 0 1 ([\d.-]+) ([\d.-]+)Z$/.exec(
      pillPath(100, 30, 80, 40),
    );
  assert.ok(m, 'one closed pill');
  assert.deepEqual(m.slice(1).map(Number), [80, 10, 120, 20, 120, 50, 80, 80, 10]);
});

test('an icon copy finds the masks and clips it points at, or it would draw nothing', () => {
  const el = (/** @type {string[]} */ values, /** @type {any[]} */ kids = []) => ({
    attributes: values.map(value => ({ value })),
    querySelectorAll: () => kids,
  });
  const icon = el(['0 0 24 24'], [el(['url(#ic-m)', 'sy-i']), el(['url("#ic-am")']), el(['#ic-part'])]);
  assert.deepEqual([...referencedIds(/** @type {any} */ (icon))].sort(), ['ic-am', 'ic-m', 'ic-part']);
});

test('the tab bar bends its icons and labels on the GPU, not with strips of copies', () => {
  const bar = fs.readFileSync(path.join(root, 'js/glass-bar.js'), 'utf8');
  assert.doesNotMatch(bar, /mtab-bend/, 'strip copies split letters where they meet');
  assert.match(bar, /lensPicture\([\s\S]*?true,\s*\)/, 'the see-through picture is uploaded premultiplied');
  const gpu = fs.readFileSync(path.join(root, 'js/glass-gpu.js'), 'utf8');
  assert.match(gpu, /vec4 k = inkAt\(\(p - g \* pr\) \/ uSize\);/, 'the slab edge reads the scene from inside');
  assert.match(
    gpu,
    /uSqueeze \* 4\.0 \* sx \* \(1\.0 - sx\)/,
    'the squeeze is zero at the rim, so the bar edge joins it',
  );
  assert.match(css, /\.mtabbar > \.glass-lens\{[^}]*inset-inline-start:-24px;top:-24px;[^}]*display:none/);
  assert.match(
    bar,
    /const CW = this\.box\.pw \+ 2 \* PAD;/,
    'right to left, a border-box wide canvas sits off by the borders',
  );
  assert.match(css, /\.mtabbar\.glass-bending > \.glass-lens\{display:block\}/);
});

test('a see-through lens picture is uploaded premultiplied, and the setting is put back', () => {
  /** @type {any[]} */
  const calls = [];
  const gl = {
    TEXTURE_2D: 0,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 9,
    createTexture: () => ({}),
    bindTexture() {},
    texParameteri() {},
    texImage2D: () => calls.push('upload'),
    pixelStorei: (/** @type {number} */ k, /** @type {boolean} */ v) => calls.push([k, v]),
    deleteTexture() {},
  };
  const slot = /** @type {any} */ ({ gl, pics: new Map() });
  lensPicture(slot, {}, 'ink', () => /** @type {any} */ ({}), true);
  assert.deepEqual(calls, [[9, true], 'upload', [9, false]]);
  calls.length = 0;
  lensPicture(slot, {}, 'opaque', () => /** @type {any} */ ({}));
  assert.deepEqual(calls, ['upload']);
});

test('a control drops only the browser click of its own gesture', () => {
  assert.equal(ownClick({ detail: 1, timeStamp: 100 }, 200), true);
  assert.equal(ownClick({ detail: 1, timeStamp: 300 }, 200), false, 'a later click is a new one');
  assert.equal(ownClick({ detail: 0, timeStamp: 100 }, 200), false, 'keyboard and VoiceOver clicks always pass');

  const el = fakeEl('label');
  const c = new GlassControl(/** @type {any} */ (el));
  const click = (/** @type {number} */ detail, /** @type {number} */ timeStamp) => {
    let stopped = false;
    el.listeners.click({ detail, timeStamp, preventDefault: () => (stopped = true), stopPropagation() {} });
    return stopped;
  };
  c.swallowClick();
  const now = performance.now();
  assert.equal(click(0, now), false, 'a key press right after a gesture still toggles');
  assert.equal(click(1, now), true);
  assert.equal(click(1, now), false, 'only one click is dropped');
  c.swallowClick();
  assert.equal(click(1, now + CLICK_WINDOW_MS + 50), false, 'no gesture blocks a click that comes much later');
});

test('a contact counts as over a box when its area overlaps it', () => {
  const box = { left: 100, top: 100, right: 164, bottom: 144 };
  assert.equal(pointOver({ clientX: 130, clientY: 120 }, box), true);
  assert.equal(pointOver({ clientX: 130, clientY: 220 }, box), false);
  assert.equal(pointOver({ clientX: 130, clientY: 150, width: 20, height: 20 }, box), true, 'a fingertip at the edge');
  assert.equal(pointOver({ clientX: 130, clientY: 160, width: 20, height: 20 }, box), false);
});

test('a tap that lifts off the control is cancelled; a drag or a tap on it is not', () => {
  const el = Object.assign(fakeEl('label'), {
    getBoundingClientRect: () => ({ left: 0, top: 100, right: 64, bottom: 144 }),
  });
  /** @type {boolean[]} */
  const ends = [];
  const c = new GlassControl(/** @type {any} */ (el));
  c.end = cancelled => {
    c.pointer = null;
    ends.push(cancelled);
  };
  const lift = (/** @type {boolean} */ moved, /** @type {number} */ y, type = 'pointerup') => {
    c.pointer = { id: 7, x0: 30, moved };
    c.release(/** @type {any} */ ({ type, pointerId: 7, clientX: 30, clientY: y }));
  };
  lift(false, 120);
  lift(false, 10);
  lift(true, 10);
  lift(false, 120, 'pointercancel');
  assert.deepEqual(ends, [false, true, false, true]);
  c.pointer = { id: 7, x0: 30, moved: false };
  c.release(/** @type {any} */ ({ type: 'pointerup', pointerId: 8, clientX: 30, clientY: 120 }));
  assert.equal(ends.length, 4, 'another finger does not end it');

  const realStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = /** @type {any} */ (() => ({ direction: 'ltr' }));
  try {
    c.pointer = { id: 9, x0: 30, moved: false };
    c.hold(/** @type {any} */ ({ pointerId: 9 }), /** @type {any} */ ({ setPointerCapture() {} }));
    releasePointer(/** @type {any} */ ({ type: 'pointerup', pointerId: 9, clientX: 30, clientY: 400 }));
    assert.deepEqual(ends.at(-1), true, 'a release the page catches is judged the same way');
  } finally {
    globalThis.getComputedStyle = realStyle;
  }
});

test('a dropped switch click still reaches outside listeners; a dropped tab bar click does not', () => {
  const stops = (/** @type {GlassControl} */ c, /** @type {any} */ el) => {
    let stopped = false;
    c.swallowClick();
    el.listeners.click({
      detail: 1,
      timeStamp: performance.now(),
      preventDefault() {},
      stopPropagation: () => (stopped = true),
    });
    return stopped;
  };
  const sw = fakeEl('label');
  assert.equal(stops(new GlassControl(/** @type {any} */ (sw)), sw), false, 'an open drop-down still closes');
  const nav = Object.assign(fakeEl('nav'), { querySelector: () => null, querySelectorAll: () => [] });
  const bar = new GlassBar(/** @type {any} */ (nav), {
    ...tabBar(/** @type {any} */ (nav)),
    P: /** @type {any} */ ({}),
  });
  assert.equal(stops(bar, nav), true, 'a tab never gets a second click');
});

test('a tab bar pick arrives as a pointer click, and the current tab can be picked again', () => {
  globalThis.MouseEvent ??= /** @type {any} */ (
    class {
      /** @param {string} type @param {object} init */
      constructor(type, init) {
        Object.assign(this, { type, ...init });
      }
    }
  );
  /** @type {any[]} */
  const got = [];
  const tabs = [0, 1].map(n => ({
    n,
    classList: { contains: () => n === 0 },
    dispatchEvent: (/** @type {any} */ e) => got.push([n, e]),
  }));
  const nav = Object.assign(fakeEl('nav'), { querySelector: () => null, querySelectorAll: () => tabs });
  const kind = tabBar(/** @type {any} */ (nav));
  assert.equal(kind.reselect, true);
  kind.choose(1);
  assert.equal(got[0][0], 1);
  assert.equal(got[0][1].type, 'click');
  assert.equal(got[0][1].detail, 1, 'detail 0 reads as a key press and skips the section fade');
  assert.equal(got[0][1].bubbles, true);
});

const tabNav = () =>
  Object.assign(fakeEl('nav'), {
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add() {}, remove() {}, toggle() {} },
  });

test('a tab bar pick waits for the lens to land, and its click is not dropped as the gesture click', () => {
  /** @type {number[]} */
  const chosen = [];
  const nav = tabNav();
  const bar = new GlassBar(/** @type {any} */ (nav), {
    ...tabBar(/** @type {any} */ (nav)),
    items: () => [],
    selected: () => 0,
    choose: i => chosen.push(i),
  });
  bar.wake = () => {};
  bar.rects = LTR;
  bar.pointer = { id: 1, x0: 90, moved: false };
  bar.hit = 1;
  bar.end(false);
  assert.deepEqual(chosen, [], 'nothing is picked on release');
  assert.ok(bar.swallowUntil > 0, 'the browser click of the gesture is still dropped');
  bar.commit();
  assert.deepEqual(chosen, [1], 'the pick is made when the lens lands');
  assert.equal(bar.swallowUntil, 0, 'the pick click must not be dropped as the gesture click');
  bar.commit();
  assert.deepEqual(chosen, [1], 'a pick is made once');
});

test('a press before the last pick landed makes that pick first', () => {
  /** @type {number[]} */
  const chosen = [];
  const nav = tabNav();
  const tabs = [0, 1, 2].map(() => ({ contains: () => false }));
  const bar = new GlassBar(/** @type {any} */ (nav), {
    ...tabBar(/** @type {any} */ (nav)),
    items: () => /** @type {any} */ (tabs),
    selected: () => 0,
    choose: i => chosen.push(i),
  });
  bar.wake = () => {};
  bar.measure = () => {
    bar.rects = LTR;
  };
  bar.hold = () => {};
  bar.chosen = 2;
  bar.down(/** @type {any} */ ({ target: nav, clientX: 30, pointerId: 3 }));
  assert.deepEqual(chosen, [2]);
});

test('a press on the lens, which clips the tab under it, still finds that tab', () => {
  assert.equal(nearestItem(LTR, 95), 1);
  assert.equal(nearestItem(LTR, -40), 0, 'never before the first item');
  assert.equal(nearestItem(LTR, 400), 2, 'never past the last item');
  assert.equal(nearestItem(RTL, 150), 0, 'right to left, the first item is on the right');
  const nav = tabNav();
  const tabs = [0, 1, 2].map(() => ({ contains: () => false }));
  const bar = new GlassBar(/** @type {any} */ (nav), {
    ...tabBar(/** @type {any} */ (nav)),
    items: () => /** @type {any} */ (tabs),
    selected: () => 0,
  });
  bar.wake = () => {};
  bar.box = { left: 0, w: 180, h: 32, dx: 0, dy: 0 };
  bar.measure = () => {
    bar.rects = LTR;
  };
  bar.hold = () => {};
  bar.down(/** @type {any} */ ({ target: nav, clientX: 150, pointerId: 4 }));
  assert.equal(bar.hit, 2);
  assert.equal(bar.lifted, true, 'any press lifts the lens onto the pressed tab');
  assert.equal(bar.pos.t, 2);
});

test('a press during the settle lifts the lens again', () => {
  const nav = tabNav();
  const bar = new GlassBar(/** @type {any} */ (nav), tabBar(/** @type {any} */ (nav)));
  bar.wake = () => {};
  bar.lift();
  bar.grow.to(0);
  bar.landing = true;
  bar.lift();
  assert.equal(bar.grow.t, 1, 'a lens on its way down grows again');
  assert.equal(bar.landing, false);
});

test('past an end tab the lens pulls the bar toward the drag, and nowhere else', () => {
  assert.equal(edgePull(LTR, 1, 0.2), 0);
  assert.equal(edgePull(LTR, 0, 0.2), 0);
  assert.equal(edgePull(LTR, 2, 0.2), 0);
  assert.ok(Math.abs(edgePull(LTR, 2.1, 0.2) - 1.2) < 1e-9, 'a tenth of a tab past the end pulls 1.2 px right');
  assert.ok(Math.abs(edgePull(LTR, -0.1, 0.2) + 1.2) < 1e-9);
  assert.ok(edgePull(RTL, 2.1, 0.2) < 0, 'right to left, the last tab is on the left');
  assert.equal(edgePull(LTR.slice(0, 1), 3, 0.2), 0);
});

test('with Reduce Motion the bar does not swell', () => {
  const nav = tabNav();
  const bar = new GlassBar(/** @type {any} */ (nav), tabBar(/** @type {any} */ (nav)));
  bar.wake = () => {};
  media = ['prefers-reduced-motion'];
  bar.lift();
  media = [];
  assert.equal(bar.swell.t, 0);
  bar.stop();
  bar.lift();
  assert.equal(bar.swell.t, 1);
});

test('under Reduce Motion a press moves a plain pill: no lens growth, no swell, a short highlight', () => {
  const nav = tabNav();
  const tabs = [0, 1, 2].map(() => ({ contains: () => false }));
  const bar = new GlassBar(/** @type {any} */ (nav), {
    ...tabBar(/** @type {any} */ (nav)),
    items: () => /** @type {any} */ (tabs),
    selected: () => 0,
    choose() {},
  });
  bar.wake = () => {};
  bar.box = { left: 0, w: 180, h: 32, dx: 0, dy: 0 };
  bar.measure = () => {
    bar.rects = LTR;
  };
  bar.hold = () => {};
  media = ['prefers-reduced-motion'];
  bar.down(/** @type {any} */ ({ target: nav, clientX: 150, pointerId: 5 }));
  media = [];
  assert.equal(bar.plain, true);
  assert.equal(bar.lifted, true);
  assert.equal(bar.grow.t, 0, 'the pill keeps its size');
  assert.equal(bar.swell.t, 0, 'the bar keeps its size');
  assert.equal(bar.flash.v, 1, 'the pill lights up on the press');
  assert.equal(bar.pos.t, 2);
  bar.end(false);
  assert.equal(bar.flash.t, 0, 'the highlight fades after the release');
  assert.match(
    css,
    /\.mtabbar\.glass-plain > \.mtab-lens::after\{opacity:var\(--hl,0\);/,
    'the highlight fades by opacity, not by repainting the pill colour',
  );
  assert.doesNotMatch(css, /\.mtab-lens::before\{[^}]*color-mix/);
  assert.equal(bar.chosen, 2);
});

test('a segmented control pressed during the shrink keeps shrinking, as before the tab bar lens', () => {
  const nav = tabNav();
  const bar = new GlassBar(/** @type {any} */ (nav), {
    ...segmented(/** @type {any} */ (nav)),
    items: () => [],
    selected: () => 0,
    choose() {},
  });
  bar.wake = () => {};
  bar.rects = LTR;
  bar.lift();
  bar.grow.to(0);
  const liftAt = bar.liftAt;
  bar.pointer = { id: 1, x0: 150, moved: false };
  bar.hit = 2;
  bar.end(false);
  assert.equal(bar.grow.t, 0);
  assert.equal(bar.liftAt, liftAt);
});

test('under Reduce Motion a release after a drag does not light the pill again or restart the landing wait', () => {
  const nav = tabNav();
  const bar = new GlassBar(/** @type {any} */ (nav), {
    ...tabBar(/** @type {any} */ (nav)),
    items: () => [],
    selected: () => 0,
    choose() {},
  });
  bar.wake = () => {};
  bar.rects = LTR;
  bar.plain = true;
  bar.lift();
  bar.flash.snap(0);
  const liftAt = bar.liftAt;
  bar.pointer = { id: 1, x0: 30, moved: true };
  bar.pos.snap(1.9);
  bar.end(false);
  assert.equal(bar.flash.v, 0);
  assert.equal(bar.liftAt, liftAt);
});

test('a resize during a gesture measures the tabs again; at rest it also puts the lens back', () => {
  const nav = tabNav();
  const bar = new GlassBar(/** @type {any} */ (nav), {
    ...tabBar(/** @type {any} */ (nav)),
    items: () => [],
    selected: () => 0,
    choose() {},
  });
  let measured = 0;
  let woke = 0;
  bar.measure = () => {
    measured++;
    bar.rects = LTR;
  };
  bar.wake = () => woke++;
  bar.render = () => {};
  bar.pointer = { id: 1, x0: 30, moved: true };
  bar.pos.snap(1.4);
  bar.resettle();
  assert.equal(measured, 1, 'mid-gesture the old tab places would pick the wrong tab');
  assert.equal(bar.pos.v, 1.4, 'the lens stays under the finger');
  assert.equal(woke, 1);
  bar.pointer = null;
  bar.resettle();
  assert.equal(measured, 2);
  assert.equal(bar.pos.v, 0, 'at rest the lens goes back to the selected tab');
});

test('lens bends come in steps of 0.01, so their profile cache stays small', () => {
  assert.equal(profileBend(0.123456), 0.12);
  assert.equal(profileBend(0.355), 0.36);
  assert.equal(new Set(Array.from({ length: 1000 }, (_, i) => profileBend(i / 1000))).size, 101);
});

test('the lens holds the tab icons still while it is up', () => {
  /** @type {boolean[]} */
  const still = [];
  const nav = tabNav();
  const held = new GlassBar(/** @type {any} */ (nav), {
    ...tabBar(/** @type {any} */ (nav)),
    still: on => still.push(on),
  });
  held.wake = () => {};
  held.lift();
  assert.deepEqual(still, [true]);
  held.stop();
  assert.deepEqual(still, [true, false]);
});

test('the tab bar hands its lens to the pill without a gap, and a long press selects nothing', () => {
  assert.match(css, /\.mtabbar>\.gs-pill\{[^}]*transition:transform [^}]*\}/, 'a pill fading in after the lens blinks');
  assert.doesNotMatch(/\.mtabbar>\.gs-pill\{[^}]*\}/.exec(css)?.[0] ?? '', /opacity/);
  assert.match(css, /\.mtabbar,\.mtabbar > \.mtab\{[^}]*-webkit-user-select:none;[^}]*-webkit-touch-callout:none\}/);
  assert.match(css, /\.mtabbar\.glass-lifted\.glass-bending > \.mtab\.active\{color:var\(--dm\)\}/);
});

test('colours read from computed styles, including color() and translucent layers', () => {
  assert.deepEqual(parseColour('rgb(10, 20, 30)'), [10, 20, 30, 1]);
  assert.deepEqual(parseColour('rgba(10, 20, 30, 0.5)'), [10, 20, 30, 0.5]);
  assert.deepEqual(parseColour('rgb(10 20 30 / 25%)'), [10, 20, 30, 0.25]);
  assert.deepEqual(parseColour('color(srgb 1 0.5 0 / 0.4)'), [255, 127.5, 0, 0.4]);
  assert.deepEqual(parseColour('color(display-p3 0 0 1)'), [0, 0, 255, 1]);
  assert.deepEqual(over([0, 0, 0, 0.5], [255, 255, 255, 1]), [127.5, 127.5, 127.5, 1]);
  assert.deepEqual(over([10, 20, 30, 1], [255, 255, 255, 1]), [10, 20, 30, 1]);
});

test('lens pictures stay on the GPU per owner and key, dropping the least recently used', () => {
  let made = 0;
  const deleted = new Set();
  const gl = {
    TEXTURE_2D: 0,
    createTexture: () => ({ id: made++ }),
    bindTexture() {},
    texParameteri() {},
    texImage2D() {},
    deleteTexture: (/** @type {{ id: number }} */ t) => deleted.add(t.id),
  };
  const slot = /** @type {any} */ ({ gl, pics: new Map() });
  const a = {};
  const b = {};
  let draws = 0;
  const draw = () => {
    draws++;
    return /** @type {any} */ ({});
  };
  const first = lensPicture(slot, a, 'k0', draw);
  assert.equal(lensPicture(slot, a, 'k0', draw), first, 'the same picture is reused');
  assert.notEqual(lensPicture(slot, b, 'k0', draw), first, 'owners never share a key');
  assert.equal(draws, 2);
  for (let i = 1; i < 15; i++) lensPicture(slot, a, `k${i}`, draw);
  assert.equal(slot.pics.size, 16);
  lensPicture(slot, a, 'k0', draw);
  lensPicture(slot, a, 'k15', draw);
  assert.equal(slot.pics.size, 16, 'the GPU keeps a fixed number of pictures');
  assert.ok(!deleted.has(first.id), 'a picture just used stays');
  assert.equal(deleted.size, 1);
});

test('the tab bar lens goes after the sliding pill, which moving-pill takes as the first child', () => {
  /** @type {string[]} */
  const order = ['gs-pill', 'mtab'];
  const tab = {
    before: (/** @type {{ className: string }} */ n) => order.splice(order.indexOf('mtab'), 0, n.className),
  };
  const bar = Object.assign(fakeEl('nav'), {
    querySelector: (/** @type {string} */ q) => (q === ':scope > .mtab' ? tab : null),
    querySelectorAll: () => [],
    prepend: () => assert.fail('nothing goes in front of the pill'),
  });
  const g = new GlassBar(/** @type {any} */ (bar), {
    items: () => [],
    selected: () => 0,
    choose() {},
    pill: () => null,
    pillColour: '--tab-pill',
    P: /** @type {any} */ ({}),
    css: true,
  });
  assert.deepEqual(order, ['gs-pill', 'mtab-lens', 'mtab']);
  assert.equal(/** @type {any} */ (g.lensEl).placedBefore[0], g.cv, 'the bent copy sits under the lens rim');
});

test('the lens shows only while a control is held, and the CSS control stays underneath', () => {
  assert.match(css, /\.tr \.glass-lens\{[^}]*display:none/);
  assert.match(css, /\.tog\.glass-on \.glass-lens\{display:block\}/);
  assert.match(css, /\.slider-wrap > \.glass-lens,\.hsb-track > \.glass-lens\{[^}]*display:none/);
  assert.match(css, /\.segr > \.glass-lens\{[^}]*display:none/);
  assert.match(css, /\.glass-lens\[hidden\]\{display:none!important\}/, 'a lent lens canvas stays hidden');
  assert.match(css, /\.mtab-lens\{[^}]*display:none/);
  assert.match(css, /@media \(forced-colors: active\)\{\.segr\.glass-moving > \.segr-pill\{display:none\}\}/);
});
