const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { latest: latestWithTime, reset, _size } = require('../src/latest');

const latest = async (...args) => {
  const outcome = await latestWithTime(...args);
  if (!outcome) return outcome;
  const { at, ...rest } = outcome;
  return rest;
};

const OPTS = { holdMs: 30, keepMs: 60_000 };
const wait = ms => new Promise(r => setTimeout(r, ms));

beforeEach(reset);

test('a refresh that settles within the hold answers with its result', async () => {
  assert.deepEqual(await latest('k', async () => 1, OPTS), { ok: true, value: 1 });
});

test('a failed refresh is an outcome, not a rejection', async () => {
  const error = new Error('down');
  assert.deepEqual(
    await latest(
      'k',
      async () => {
        throw error;
      },
      OPTS,
    ),
    { ok: false, error },
  );
});

test('a slow refresh answers with nothing when there is no earlier result', async () => {
  assert.equal(await latest('k', () => wait(200).then(() => 1), OPTS), null);
});

test('a slow refresh answers with the last result and stores the new one for later', async () => {
  await latest('k', async () => 'old', OPTS);
  assert.deepEqual(await latest('k', () => wait(80).then(() => 'new'), OPTS), { ok: true, value: 'old' });
  await wait(100);
  assert.deepEqual(await latest('k', () => wait(200).then(() => 'newer'), OPTS), { ok: true, value: 'new' });
});

test('only one refresh per key runs at a time', async () => {
  let runs = 0;
  const slow = () => {
    runs++;
    return wait(100).then(() => runs);
  };
  await Promise.all([latest('k', slow, OPTS), latest('k', slow, OPTS), latest('k', slow, OPTS)]);
  assert.equal(runs, 1);
});

test('a caller after the hold has passed does not wait again', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const stall = () => new Promise(() => {});
  const first = latest('k', stall, OPTS);
  t.mock.timers.tick(OPTS.holdMs);
  assert.equal(await first, null);
  let answered = false;
  const second = latest('k', stall, OPTS).then(v => {
    answered = true;
    return v;
  });
  t.mock.timers.tick(0);
  await new Promise(r => setImmediate(r));
  assert.ok(answered, 'answered without a second hold');
  assert.equal(await second, null);
});

test('a result older than keepMs is not used', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  await latest('k', async () => 'old', OPTS);
  t.mock.timers.tick(OPTS.keepMs);
  assert.equal(await latest('k', () => new Promise(() => {}), { holdMs: 0, keepMs: OPTS.keepMs }), null);
});

test('a short keepMs on one key does not drop another key kept longer', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  await latest('long', async () => 'kept', { holdMs: 30, keepMs: 15 * 60_000 });
  t.mock.timers.tick(5 * 60_000);
  await latest('short', async () => 'other', { holdMs: 30, keepMs: 2 * 60_000 });
  assert.deepEqual(await latest('long', () => new Promise(() => {}), { holdMs: 0, keepMs: 15 * 60_000 }), {
    ok: true,
    value: 'kept',
  });
});

test('different keys do not share a result', async () => {
  await latest('a', async () => 'a', OPTS);
  assert.deepEqual(await latest('b', async () => 'b', OPTS), { ok: true, value: 'b' });
});

test('a group keeps at most maxPerGroup entries, dropping the oldest settled ones', async () => {
  const opts = { ...OPTS, group: 'w1', maxPerGroup: 3 };
  for (let i = 0; i < 10; i++) await latest(`w1?${i}`, async () => i, opts);
  assert.equal(_size(), 3);
  assert.deepEqual(await latest('w1?9', () => wait(50).then(() => 'again'), { ...opts, holdMs: 0 }), {
    ok: true,
    value: 9,
  });
});

test('the cap never drops a refresh in flight, and leaves other groups alone', async () => {
  await latest('other', async () => 0, OPTS);
  const opts = { ...OPTS, holdMs: 0, group: 'w1', maxPerGroup: 2 };
  const slow = () => wait(100).then(() => 1);
  for (let i = 0; i < 5; i++) await latest(`w1?${i}`, slow, opts);
  assert.equal(_size(), 6, 'five refreshes in flight plus the other group');
  await wait(150);
  await latest('w1?new', async () => 2, opts);
  assert.equal(_size(), 3);
  assert.deepEqual(await latest('other', () => wait(50).then(() => 'x'), { ...OPTS, holdMs: 0 }), {
    ok: true,
    value: 0,
  });
});

test('an outcome carries the time it settled, and a stored one keeps it', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  assert.equal((await latestWithTime('k', async () => 'old', OPTS)).at, 1_000_000);
  t.mock.timers.tick(10_000);
  const stored = await latestWithTime('k', () => new Promise(() => {}), { holdMs: 0, keepMs: OPTS.keepMs });
  assert.deepEqual(stored, { ok: true, value: 'old', at: 1_000_000 });
});
