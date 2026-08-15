const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const backoff = require('../src/poll-backoff');

const { FAILURES_BEFORE_BACKOFF: N, FIRST_DELAY_MS, MAX_DELAY_MS } = backoff;

beforeEach(() => backoff.reset());

test('a target is polled normally until the failures add up', () => {
  const now = 1000;
  for (let i = 1; i < N; i++) {
    backoff.failure('k', { value: 0 }, now);
    assert.equal(backoff.skip('k', now), false, `still polled after ${i} failure(s)`);
  }
  backoff.failure('k', { value: 0 }, now);
  assert.equal(backoff.skip('k', now), true);
});

test('the wait grows with each further failure and stops at the ceiling', () => {
  let now = 0;
  const waits = [];
  for (let i = 0; i < 12; i++) {
    backoff.failure('k', { value: 0 }, now);
    if (backoff.skip('k', now)) {
      let wait = 1;
      while (backoff.skip('k', now + wait)) wait++;
      waits.push(wait);
      now += wait;
    }
  }
  assert.equal(waits[0], FIRST_DELAY_MS);
  assert.ok(waits[1] > waits[0], 'the second wait is longer');
  assert.ok(
    waits.every(w => w <= MAX_DELAY_MS),
    'no wait exceeds the ceiling',
  );
  assert.equal(waits.at(-1), MAX_DELAY_MS);
});

test('a skipped target reports what it reported last', () => {
  const now = 0;
  for (let i = 0; i < N; i++) backoff.failure('k', { value: 0, error: 'Timed out' }, now);
  assert.equal(backoff.skip('k', now), true);
  assert.deepEqual(backoff.remembered('k'), { value: 0, error: 'Timed out' });
});

test('one success clears the backoff outright', () => {
  const now = 0;
  for (let i = 0; i < N + 3; i++) backoff.failure('k', { value: 0 }, now);
  assert.equal(backoff.skip('k', now), true);
  backoff.success('k');
  assert.equal(backoff.skip('k', now), false);
  assert.equal(backoff.remembered('k'), undefined);
});

test('the attempt after the wait is not skipped', () => {
  let now = 0;
  for (let i = 0; i < N; i++) backoff.failure('k', { value: 0 }, now);
  now += FIRST_DELAY_MS;
  assert.equal(backoff.skip('k', now), false, 'the target must be retried when its time comes');
});

test('targets back off independently', () => {
  const now = 0;
  for (let i = 0; i < N; i++) backoff.failure('dead', { value: 0 }, now);
  assert.equal(backoff.skip('dead', now), true);
  assert.equal(backoff.skip('alive', now), false);
});

test('a config save clears every backoff', () => {
  const now = 0;
  for (let i = 0; i < N; i++) backoff.failure('k', { value: 0 }, now);
  backoff.reset();
  assert.equal(backoff.skip('k', now), false);
});
