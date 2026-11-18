import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

/** @type {Set<Function>} */
const capture = new Set();
globalThis.document = /** @type {any} */ ({
  documentElement: { dataset: {} },
  addEventListener: (/** @type {string} */ type, /** @type {Function} */ fn, /** @type {boolean} */ cap) => {
    if (type === 'click' && cap) capture.add(fn);
  },
  removeEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => capture.delete(fn),
});
globalThis.window = /** @type {any} */ (globalThis);
globalThis.matchMedia = /** @type {any} */ (() => ({ matches: false, addEventListener() {} }));

const { dropNextClick } = await import('../js/listbox.js');

const area = /** @type {DOMRect} */ ({ left: 100, right: 300, top: 100, bottom: 400 });

/** @param {number} detail @param {number} timeStamp @param {number} [x] @param {number} [y] */
const click = (detail, timeStamp, x = 200, y = 200) => {
  const e = { detail, timeStamp, clientX: x, clientY: y, dropped: false, preventDefault() {}, stopPropagation() {} };
  e.preventDefault = () => {
    e.dropped = true;
  };
  for (const fn of [...capture]) fn(e);
  return e.dropped;
};

test('the click after a press-and-slide pick never reaches what lies under the closing list', () => {
  dropNextClick(area);
  const now = performance.now();
  assert.equal(click(1, now), true);
  assert.equal(click(1, now), false, 'only that one click is dropped');
});

test('a tap outside the list right after a slide pick is a new press', () => {
  dropNextClick(area);
  const now = performance.now();
  assert.equal(click(1, now, 20, 500), false);
  assert.equal(click(1, now), true, 'the list click that follows is still dropped');
});

test('a keyboard click or a much later tap is never dropped', () => {
  dropNextClick(area);
  assert.equal(click(0, performance.now()), false);
  dropNextClick(area);
  assert.equal(click(1, performance.now() + 1000), false);
  assert.equal(capture.size, 0, 'the blocker removes itself');
});
