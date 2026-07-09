const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectNumbers, extractPath, computeBadgeValue } = require('../src/badge-extract');

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
  let deep = 0; for (let i = 0; i < 50; i++) deep = { d: deep };
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
