const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  collectNumbers,
  extractPath,
  computeBadgeValue,
  computeLabelValues,
  firstFiringLabel,
} = require('../src/badge-extract');

test('extractPath resolves a plain dot path', () => {
  assert.equal(extractPath({ a: { b: 5 } }, 'a.b'), 5);
});

test('extractPath returns undefined when a segment is missing', () => {
  assert.equal(extractPath({ a: {} }, 'a.b.c'), undefined);
  assert.equal(extractPath({}, 'x.y'), undefined);
});

test('extractPath resolves $count and count on arrays', () => {
  assert.equal(extractPath({ items: [1, 2, 3] }, 'items.$count'), 3);
  assert.equal(extractPath({ items: [1, 2, 3] }, 'items.count'), 3);
  assert.equal(extractPath({ x: 5 }, 'x.count'), undefined); // not an array
});

test('extractPath reads a field named count on an object', () => {
  assert.equal(extractPath({ count: 99 }, 'count'), 99);
  assert.equal(extractPath({ queue: { count: 4 } }, 'queue.count'), 4);
  assert.equal(computeBadgeValue({ count: 99 }, { extract: 'count' }), 99);
});

test('extractPath filters an array by a boolean field then counts', () => {
  const data = { list: [{ on: true }, { on: false }, { on: true }] };
  assert.equal(extractPath(data, 'list.filter(on==true).count'), 2);
  assert.equal(extractPath(data, 'list.filter(on==false).count'), 1);
});

test('extractPath filters by a string field', () => {
  const data = { list: [{ s: 'x' }, { s: 'y' }, { s: 'x' }] };
  assert.equal(extractPath(data, 'list.filter(s==x).count'), 2);
});

test('extractPath handles bare and named index segments', () => {
  assert.equal(extractPath({ arr: [10, 20, 30] }, 'arr.[1]'), 20);
  assert.equal(extractPath({ arr: [10, 20, 30] }, 'arr[2]'), 30);
});

test('extractPath returns undefined when filtering a non-array', () => {
  assert.equal(extractPath({ x: 5 }, 'x.filter(a==true)'), undefined);
});

test('collectNumbers surfaces numeric paths from a nested object', () => {
  const out = collectNumbers({ stats: { total: 14203, blocked: 1876 }, name: 'home' });
  const byPath = Object.fromEntries(out.map(e => [e.path, e.value]));
  assert.equal(byPath['stats.total'], 14203);
  assert.equal(byPath['stats.blocked'], 1876);
  assert.equal(byPath['name'], undefined); // strings are not collected
});

test('collectNumbers emits an array count and boolean filter counts', () => {
  const out = collectNumbers({ sessions: [{ active: true }, { active: false }, { active: true }] });
  const byPath = Object.fromEntries(out.map(e => [e.path, e.value]));
  assert.equal(byPath['sessions.$count'], 3);
  assert.equal(byPath['sessions.filter(active==true).count'], 2);
  assert.equal(byPath['sessions.filter(active==false).count'], 1);
});

test('collectNumbers is null-safe and bounded', () => {
  assert.deepEqual(collectNumbers(null), []);
  // deep nesting must terminate rather than blow the stack
  let deep = 0;
  for (let i = 0; i < 50; i++) deep = { d: deep };
  assert.doesNotThrow(() => collectNumbers(deep));
});

test('computeBadgeValue supports string, array, and object extract specs', () => {
  assert.equal(computeBadgeValue({ a: 5 }, { extract: 'a' }), 5);
  assert.equal(computeBadgeValue({ a: 5, b: 3 }, { extract: ['a', 'b'] }), 8);
  assert.equal(computeBadgeValue({ a: 5 }, { extract: [{ path: 'a' }] }), 5);
  assert.equal(computeBadgeValue({ a: 5 }, { extract: { path: 'a' } }), 5);
});

test('computeBadgeValue ignores non-numeric results and missing extract', () => {
  assert.equal(computeBadgeValue({ a: 'text' }, { extract: 'a' }), 0);
  assert.equal(computeBadgeValue({ a: 5 }, {}), 0);
  assert.equal(computeBadgeValue({}, null), 0);
});

test('computeLabelValues resolves each label independently', () => {
  const data = { queue: { pending: 3, failed: 0 }, items: [{ ok: true }, { ok: false }] };
  const labels = [{ path: 'queue.pending' }, { path: 'queue.failed' }, { path: 'items.$count' }];
  assert.deepEqual(computeLabelValues(data, labels), [3, 0, 2]);
});

test('a label whose path resolves to nothing reads as zero, keeping its slot', () => {
  assert.deepEqual(computeLabelValues({ a: 1 }, [{ path: 'nope' }, { path: 'a' }]), [0, 1]);
});

test('firstFiringLabel returns the earliest label that reaches its own minimum', () => {
  const labels = [{ path: 'a', min: 5 }, { path: 'b' }, { path: 'c' }];
  assert.equal(firstFiringLabel(labels, [4, 2, 9]), 1);
  assert.equal(firstFiringLabel(labels, [5, 2, 9]), 0);
  assert.equal(firstFiringLabel(labels, [0, 0, 0]), -1);
});

test('a labels value that is not an array yields no values', () => {
  for (const bad of [null, undefined, 'pending', 42, {}, true]) {
    assert.deepEqual(computeLabelValues({ a: 1 }, bad), []);
  }
});

test('a label entry that is not an object keeps its slot as zero', () => {
  const got = computeLabelValues({ a: 5 }, [null, 7, [], { path: 'a' }, { path: '' }, { path: 42 }]);
  assert.deepEqual(got, [0, 0, 0, 5, 0, 0]);
});

test('a path resolving to a non-number reads as zero', () => {
  const data = { s: 'x', o: {}, arr: [1, 2], b: true, n: null, nan: Number.NaN, inf: Number.POSITIVE_INFINITY };
  const paths = ['s', 'o', 'arr', 'b', 'n', 'nan', 'inf'].map(p => ({ path: p }));
  assert.deepEqual(computeLabelValues(data, paths), [0, 0, 0, 0, 0, 0, 0]);
});

test('a hostile path does not reach the prototype chain', () => {
  const got = computeLabelValues({ a: 1 }, [{ path: '__proto__.polluted' }, { path: 'constructor.name' }]);
  assert.deepEqual(got, [0, 0]);
  assert.equal({}.polluted, undefined);
});

test('a very deep path resolves iteratively rather than overflowing the stack', () => {
  let data = { n: 1 };
  for (let i = 0; i < 5000; i++) data = { d: data };
  const deep = 'd.'.repeat(5000) + 'n';
  assert.deepEqual(computeLabelValues(data, [{ path: deep }]), [1]);
});

test('firstFiringLabel copes with a values list of the wrong length', () => {
  const labels = [{ path: 'a' }, { path: 'b' }, { path: 'c' }];
  assert.equal(firstFiringLabel(labels, []), -1);
  assert.equal(firstFiringLabel(labels, [0, 0, 4]), 2);
  assert.equal(firstFiringLabel([], [1, 2]), -1);
  for (const bad of [null, undefined, 'x', 7]) assert.equal(firstFiringLabel(bad, [1]), -1);
});

test('a nonsense minimum falls back to one rather than never firing', () => {
  for (const min of [undefined, null, 0, -5, 'x', Number.NaN, {}, []]) {
    assert.equal(firstFiringLabel([{ path: 'a', min }], [1]), 0, `min ${JSON.stringify(min)}`);
  }
  assert.equal(firstFiringLabel([{ path: 'a', min: 1e9 }], [999]), -1);
});
