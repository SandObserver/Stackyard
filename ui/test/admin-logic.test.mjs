import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normBackupSlots, reorderItems, isDockBlocked } from '../js/admin-logic.js';

test('normBackupSlots returns one slot for small and three otherwise', () => {
  assert.equal(normBackupSlots([], 'small').length, 1);
  assert.equal(normBackupSlots([], 'medium').length, 3);
  assert.equal(normBackupSlots(undefined, 'large').length, 3);
});

test('normBackupSlots fills defaults for empty input', () => {
  const [s] = normBackupSlots([], 'small');
  assert.equal(s.provider, null);
  assert.equal(s.useDefault, true);
  assert.equal(s.dupPollSec, 60);
  assert.deepEqual(s.dupJobList, []);
});

test('normBackupSlots marks the first slot of a provider as default', () => {
  const saved = [
    { provider: 'duplicati', dupUrl: 'http://d1' },
    { provider: 'duplicati', dupUrl: 'http://d1' }, // same URL as the default
    { provider: 'duplicati', dupUrl: 'http://d2' }, // different URL -> independent
  ];
  const out = normBackupSlots(saved, 'medium').map(s => s.useDefault);
  assert.deepEqual(out, [true, true, false]);
});

test('normBackupSlots honors an explicit useDefault flag', () => {
  assert.equal(normBackupSlots([{ provider: 'kopia', useDefault: false, kopiaUrl: 'x' }], 'small')[0].useDefault, false);
  assert.equal(normBackupSlots([{ provider: 'kopia', useDefault: true }], 'small')[0].useDefault, true);
});

test('normBackupSlots treats a provider-less slot as default and preserves fields', () => {
  const [s] = normBackupSlots([{ jobId: 'j1', customName: 'Nightly', dupPollSec: 30 }], 'small');
  assert.equal(s.useDefault, true);
  assert.equal(s.jobId, 'j1');
  assert.equal(s.customName, 'Nightly');
  assert.equal(s.dupPollSec, 30);
});

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
