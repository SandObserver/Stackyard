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
});
globalThis.document = /** @type {any} */ ({
  documentElement: { dataset: {} },
  createElement: fakeEl,
});
globalThis.window = /** @type {any} */ (globalThis);

const { glassAllowed } = await import('../js/glass-controls.js');
const { ownClick, GlassControl, CLICK_WINDOW_MS } = await import('../js/glass-control.js');
const { switchNext } = await import('../js/glass-switch.js');
const { fillEnd } = await import('../js/glass-slider.js');
const { indexAt, rectAt, capPath, GlassBar, tabBar } = await import('../js/glass-bar.js');
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

test('a cap path cuts the pill end at the given depth, on the pill outline', () => {
  const w = 80;
  const h = 30;
  const cy = 15;
  const r = 15;
  for (const [side, dd] of [
    [-1, 5],
    [1, 5],
    [-1, 20],
  ]) {
    const m = /^M([\d.-]+) ([\d.-]+)A[\d.]+ [\d.]+ 0 ([01]) ([01]) ([\d.-]+) ([\d.-]+)Z$/.exec(
      capPath(side, dd, w, h, cy, 0),
    );
    assert.ok(m, 'one arc, closed');
    const x = Number(m[1]);
    assert.equal(x, side < 0 ? dd : w - dd, 'the cut is dd in from the edge');
    const xc = side < 0 ? r : w - r;
    const y0 = Number(m[2]);
    assert.ok(Math.abs((x - xc) ** 2 + (y0 - cy) ** 2 - r * r) < 0.1, 'the cut starts on the outline');
    assert.equal(m[3], dd > r ? '1' : '0', 'past the cap middle the arc takes the long way');
  }
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
  new GlassBar(/** @type {any} */ (bar), {
    items: () => [],
    selected: () => 0,
    choose() {},
    pill: () => null,
    pillColour: '--tab-pill',
    P: /** @type {any} */ ({}),
    css: true,
  });
  assert.deepEqual(order, ['gs-pill', 'mtab-lens', 'mtab']);
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
