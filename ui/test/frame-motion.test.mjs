import { test } from 'node:test';
import assert from 'node:assert/strict';

/* One fake frame clock for the whole file: the module keeps its own queue. */
const frames = [];
globalThis.requestAnimationFrame = fn => frames.push(fn);
globalThis.matchMedia = () => ({ matches: false });
const attrs = new Set();
globalThis.document = {
  documentElement: { toggleAttribute: (name, on) => (on ? attrs.add(name) : attrs.delete(name)) },
};

const { animate, cubicBezier, easing, glide, onFrame, setScripted, isScripted, stopGlide } = await import(
  '../js/frame-motion.js'
);

/** Runs queued frames at the given timestamps. */
const run = (...times) => {
  for (const t of times) {
    const queued = frames.splice(0);
    for (const fn of queued) fn(t);
  }
};

test('a cubic-bezier curve ends where CSS ends it', () => {
  const ease = cubicBezier(0.32, 0.72, 0, 1);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.ok(ease(0.5) > 0.85, 'the page curve is mostly done at half time');
  const linear = cubicBezier(0, 0, 1, 1);
  for (const p of [0.1, 0.5, 0.9]) assert.ok(Math.abs(linear(p) - p) < 1e-4);
});

test('easing reads a cubic-bezier and the keywords, and anything else as linear', () => {
  assert.ok(Math.abs(easing('cubic-bezier(.32,.72,0,1)')(0.5) - cubicBezier(0.32, 0.72, 0, 1)(0.5)) < 1e-9);
  assert.ok(Math.abs(easing('ease-out')(0.5) - cubicBezier(0, 0, 0.58, 1)(0.5)) < 1e-9);
  assert.equal(easing('steps(4)')(0.3), 0.3);
  assert.equal(easing('cubic-bezier(a,b,c,d)')(0.3), 0.3);
  assert.equal(easing('linear')(2), 1);
});

test('an animation is timed from its first frame, not from when it was asked for', () => {
  const seen = [];
  let done = false;
  animate(
    100,
    p => p,
    p => seen.push(p),
    () => {
      done = true;
    },
  );
  run(5000, 5050, 5100);
  assert.deepEqual(seen, [0, 0.5, 1]);
  assert.ok(done);
});

test('the frame hooks run after every animation has stepped', () => {
  const order = [];
  const off = onFrame(() => order.push('hook'));
  animate(
    10,
    p => p,
    () => order.push('step'),
  );
  run(0);
  assert.deepEqual(order, ['step', 'hook']);
  off();
  run(10);
});

test('a new glide on an element replaces the one running, and a stopped one stays put', () => {
  const el = {};
  const a = [];
  const b = [];
  glide(
    el,
    100,
    p => p,
    p => a.push(p),
  );
  run(0);
  glide(
    el,
    100,
    p => p,
    p => b.push(p),
  );
  run(50, 100);
  assert.deepEqual(a, [0], 'the first glide still moves');
  assert.deepEqual(b, [0, 0.5]);
  stopGlide(el);
  run(150);
  assert.deepEqual(b, [0, 0.5]);
});

test('scripted motion is marked on the root for the CSS that hands it over', () => {
  setScripted(true);
  assert.ok(isScripted());
  assert.ok(attrs.has('data-glass-live'));
  setScripted(false);
  assert.ok(!attrs.has('data-glass-live'));
});
