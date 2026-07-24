import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorderItems, isDockBlocked, nextActiveIndex, groupBounds } from '../js/admin-logic.js';

test('reorderItems swaps top-level rows and reports whether it moved', () => {
  const items = [{ id: 'a', type: 'app' }, { id: 'b', type: 'app' }, { id: 'c', type: 'app' }];
  assert.equal(reorderItems(items, items[1], -1), true);
  assert.deepEqual(items.map(i => i.id), ['b', 'a', 'c']);
  assert.equal(reorderItems(items, items[0], -1), false); // already at the top
  assert.deepEqual(items.map(i => i.id), ['b', 'a', 'c']);
});

test('reorderItems skips items nested inside folders when ordering the top level', () => {
  const folder = { id: 'f', type: 'folder', children: ['x'] };
  const items = [folder, { id: 'x', type: 'app' }, { id: 'b', type: 'app' }];
  assert.equal(reorderItems(items, folder, 1), true); // folder moves past nested x to b's slot
  assert.deepEqual(items.map(i => i.id), ['b', 'x', 'f']);
});

test('reorderItems reorders a child within its folder', () => {
  const items = [{ id: 'f', type: 'folder', children: ['x', 'y', 'z'] }];
  assert.equal(reorderItems(items, null, 1, { folderId: 'f', childIdx: 0 }), true);
  assert.deepEqual(items[0].children, ['y', 'x', 'z']);
  assert.equal(reorderItems(items, null, -1, { folderId: 'f', childIdx: 0 }), false); // out of bounds
  assert.equal(reorderItems(items, null, 1, { folderId: 'missing', childIdx: 0 }), false);
});

test('isDockBlocked blocks a new app once the dock is full', () => {
  const items = [1, 2, 3, 4].map(n => ({ id: `a${n}`, type: 'app', dock: true }));
  assert.equal(isDockBlocked(items, { id: 'new', type: 'app' }), true);
  assert.equal(isDockBlocked(items.slice(0, 3), { id: 'new', type: 'app' }), false);
});

test('isDockBlocked never blocks an app already in the dock', () => {
  const items = [1, 2, 3, 4].map(n => ({ id: `a${n}`, type: 'app', dock: true }));
  assert.equal(isDockBlocked(items, items[0]), false);
});

test('isDockBlocked excludes the edited app from the count', () => {
  // four docked, one of them is the app being edited and is being un-docked
  const items = [1, 2, 3, 4].map(n => ({ id: `a${n}`, type: 'app', dock: true }));
  assert.equal(isDockBlocked(items, { id: 'a1', type: 'app', dock: false }), false);
});

test('isDockBlocked only counts docked apps, not widgets or folders', () => {
  const items = [
    ...[1, 2, 3].map(n => ({ id: `a${n}`, type: 'app', dock: true })),
    { id: 'w1', type: 'widget', dock: true },
    { id: 'f1', type: 'folder', dock: true },
    { id: 'a9', type: 'app', dock: false },
  ];
  assert.equal(isDockBlocked(items, { id: 'new', type: 'app' }), false);
});

test('isDockBlocked tolerates junk input', () => {
  assert.equal(isDockBlocked(null, null), false);
  assert.equal(isDockBlocked([null, undefined, {}], { id: 'new' }), false);
});

test('nextActiveIndex moves the active option and clamps at both ends', () => {
  assert.equal(nextActiveIndex('ArrowDown', 0, 3), 1);
  assert.equal(nextActiveIndex('ArrowUp', 2, 3), 1);
  assert.equal(nextActiveIndex('ArrowDown', 2, 3), 2, 'clamps, does not wrap');
  assert.equal(nextActiveIndex('ArrowUp', 0, 3), 0, 'clamps, does not wrap');
  assert.equal(nextActiveIndex('Home', 2, 3), 0);
  assert.equal(nextActiveIndex('End', 0, 3), 2);
});

test('nextActiveIndex ignores keys that do not move the active option', () => {
  for (const k of ['Enter', ' ', 'Escape', 'Tab', 'a']) {
    assert.equal(nextActiveIndex(k, 1, 3), null, k);
  }
});

test('nextActiveIndex handles an empty list', () => {
  assert.equal(nextActiveIndex('ArrowDown', -1, 0), null);
  assert.equal(nextActiveIndex('Home', -1, 0), null);
});

test('nextActiveIndex recovers from an out-of-range active index', () => {
  assert.equal(nextActiveIndex('ArrowDown', 99, 3), 2);
  assert.equal(nextActiveIndex('ArrowUp', -5, 3), 0);
});

test('groupBounds defaults to an open-ended list', () => {
  assert.deepEqual(groupBounds({}, 'medium'), { min: 0, max: 99 });
  assert.deepEqual(groupBounds({ min: 1, max: 5 }, 'medium'), { min: 1, max: 5 });
});

test('groupBounds applies maxBySize and falls back to max for unlisted sizes', () => {
  const f = { min: 1, max: 5, maxBySize: { small: 2 } };
  assert.deepEqual(groupBounds(f, 'small'), { min: 1, max: 2 });
  assert.deepEqual(groupBounds(f, 'medium'), { min: 1, max: 5 });
});

test('groupBounds pins both bounds from countBySize and outranks min/max', () => {
  const f = { min: 1, max: 9, maxBySize: { medium: 7 }, countBySize: { small: 1, medium: 3 } };
  assert.deepEqual(groupBounds(f, 'small'), { min: 1, max: 1 });
  assert.deepEqual(groupBounds(f, 'medium'), { min: 3, max: 3 });
});

test('groupBounds ignores countBySize for a size it does not name', () => {
  assert.deepEqual(groupBounds({ min: 1, max: 4, countBySize: { small: 1 } }, 'large'), { min: 1, max: 4 });
});
