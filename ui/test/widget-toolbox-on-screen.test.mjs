import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };

const listeners = new Set();
globalThis.document = {
  hidden: false,
  addEventListener: (type, fn) => type === 'visibilitychange' && listeners.add(fn),
  removeEventListener: (type, fn) => type === 'visibilitychange' && listeners.delete(fn),
};
let observer = null;
globalThis.IntersectionObserver = class {
  constructor(fn) {
    this.fn = fn;
    this.disconnected = false;
    observer = this;
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
};

const { whileOnScreen } = await import('../js/widget-toolbox.js');

const setHidden = hidden => {
  document.hidden = hidden;
  for (const fn of listeners) fn();
};
const intersect = isIntersecting => observer.fn([{ isIntersecting }]);

test('reports on screen only while the element intersects and the tab is visible', () => {
  const seen = [];
  const watch = whileOnScreen({}, v => seen.push(v));
  assert.deepEqual(seen, [], 'nothing is reported before the first intersection entry');
  intersect(true);
  setHidden(true);
  setHidden(false);
  intersect(false);
  setHidden(true);
  setHidden(false);
  assert.deepEqual(seen, [true, false, true, false]);
  watch.stop();
});

test('a tab returning while the element is off screen reports nothing', () => {
  const seen = [];
  const watch = whileOnScreen({}, v => seen.push(v));
  intersect(false);
  setHidden(true);
  setHidden(false);
  assert.deepEqual(seen, [false]);
  watch.stop();
});

test('stop disconnects the observer and the visibility listener', () => {
  const watch = whileOnScreen({}, () => {});
  const before = listeners.size;
  watch.stop();
  assert.equal(observer.disconnected, true);
  assert.equal(listeners.size, before - 1);
});

test('without IntersectionObserver, visibility alone decides', () => {
  const saved = globalThis.IntersectionObserver;
  delete globalThis.IntersectionObserver;
  try {
    const seen = [];
    const watch = whileOnScreen({}, v => seen.push(v));
    setHidden(true);
    setHidden(false);
    assert.deepEqual(seen, [true, false, true]);
    watch.stop();
  } finally {
    globalThis.IntersectionObserver = saved;
  }
});
