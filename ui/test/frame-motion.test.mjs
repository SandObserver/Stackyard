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

const { animate, cubicBezier, easing, everyFrame, glide, onFrame, rubber, setScripted, isScripted, Spring, stopGlide } =
  await import('../js/frame-motion.js');

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
  assert.deepEqual(a, [0], 'the replaced glide stopped after its first frame');
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

test('a spring settles on its target and goes idle', () => {
  for (const [r, d] of [
    [0.3, 0.8],
    [0.18, 1],
    [0.12, 0.9],
  ]) {
    const s = new Spring(0, r, d).to(1);
    for (let i = 0; i < 240; i++) s.step(1 / 60);
    assert.equal(s.v, 1, `response ${r} did not land`);
    assert.ok(s.idle);
  }
});

test('a very fast spring jumps, and a stiff one with long frames still converges', () => {
  const s = new Spring(0, 0.001, 1).to(1);
  s.step(1 / 60);
  assert.equal(s.v, 1);
  const stiff = new Spring(0, 0.03, 0.3).to(1);
  for (let i = 0; i < 120; i++) stiff.step(0.05);
  assert.ok(Number.isFinite(stiff.v) && Math.abs(stiff.v - 1) < 1e-3, `stiff spring ended at ${stiff.v}`);
});

test('a spring retargeted mid-flight keeps its speed', () => {
  const s = new Spring(0, 0.3, 1).to(1);
  for (let i = 0; i < 6; i++) s.step(1 / 60);
  const vel = s.vel;
  s.to(0);
  assert.equal(s.vel, vel, 'retargeting does not reset velocity');
});

test('rubber band: free inside the range, shrinking and bounded past it', () => {
  assert.equal(rubber(0.4, 0, 1, 2), 0.4);
  const a = rubber(1.5, 0, 1, 2);
  const b = rubber(3, 0, 1, 2);
  assert.ok(a > 1 && b > a && b < 1 + 1 / 2, `${a} ${b}`);
  assert.ok(rubber(-1, 0, 1, 2) < 0 && rubber(-1, 0, 1, 2) > -1 / 2);
});

test('everyFrame passes seconds, caps a long gap, and stops when asked or on false', () => {
  /** @type {number[]} */
  const seen = [];
  everyFrame(dt => {
    seen.push(dt);
    return seen.length < 3;
  });
  run(1000, 1016, 1500, 1516);
  assert.equal(seen.length, 3);
  assert.ok(Math.abs(seen[0] - 1 / 60) < 1e-9, 'the first frame is one frame long');
  assert.ok(Math.abs(seen[1] - 0.016) < 1e-9);
  assert.equal(seen[2], 0.05, 'a long gap counts as 50 ms');
  let n = 0;
  const stop = everyFrame(() => {
    n++;
    return true;
  });
  run(2000);
  stop();
  run(2016, 2032);
  assert.equal(n, 1);
});

test('one animation throwing ends only itself; the others keep their frames', () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    let failed = null;
    let other = 0;
    everyFrame(
      () => {
        throw new Error('boom');
      },
      err => {
        failed = err;
      },
    );
    const stop = everyFrame(() => {
      other++;
      return true;
    });
    run(3000, 3016);
    stop();
    assert.ok(failed instanceof Error);
    assert.equal(other, 2);
  } finally {
    console.warn = warn;
  }
});
