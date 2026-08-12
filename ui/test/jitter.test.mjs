/* Several pollers started at the same moment keep firing at the same moment,
   which lands on a service in bursts. The dashboard already spread its own
   polls; widgets polled on an exact cadence. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jitter } from '../js/jitter.js';

const withRandom = (value, fn) => {
  const real = Math.random;
  Math.random = () => value;
  try {
    return fn();
  } finally {
    Math.random = real;
  }
};

test('the delay stays within 15% of the interval, either way', () => {
  assert.equal(
    withRandom(0, () => jitter(1000)),
    850,
  );
  assert.equal(
    withRandom(1, () => jitter(1000)),
    1150,
  );
  assert.equal(
    withRandom(0.5, () => jitter(1000)),
    1000,
  );
});

test('every delay across many draws stays inside the band', () => {
  for (let i = 0; i < 500; i++) {
    const d = jitter(30_000);
    assert.ok(d >= 25_500 && d <= 34_500, `${d} is outside ±15%`);
  }
});

test('two pollers on the same interval do not keep the same delay', () => {
  const draws = new Set(Array.from({ length: 50 }, () => jitter(30_000)));
  assert.ok(draws.size > 1, 'a fixed delay would defeat the point');
});

/* A caller that has no interval yet must not schedule into the past or be
   handed NaN, which setTimeout treats as zero and turns into a busy loop. */
test('an unusable interval gives zero, not NaN', () => {
  for (const v of [0, -5, NaN, undefined, null, 'soon', {}]) {
    assert.equal(jitter(v), 0, String(v));
  }
});
