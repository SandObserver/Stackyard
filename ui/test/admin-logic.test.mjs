import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normBackupSlots, reorderItems } from '../js/admin-logic.js';

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
