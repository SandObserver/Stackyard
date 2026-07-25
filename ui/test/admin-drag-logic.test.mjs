import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canJoinFolder, dropTargetKind, applyDrop } from '../js/admin-drag-logic.js';

/* a, b, w top level; f is a folder holding c. */
const model = () => [
  { id: 'a', type: 'app' },
  { id: 'b', type: 'app' },
  { id: 'f', type: 'folder', children: ['c'] },
  { id: 'c', type: 'app' },
  { id: 'w', type: 'widget' },
];
const order = items => items.map(i => i.id);
const folder = (items, id) => items.find(i => i.id === id).children;

test('only apps may join a folder', () => {
  assert.equal(canJoinFolder('app'), true);
  assert.equal(canJoinFolder('widget'), false);
  assert.equal(canJoinFolder('folder'), false);
});

test('an app dropped on a folder row goes into the folder', () => {
  assert.equal(dropTargetKind({ srcType: 'app', targetIsFolder: true }), 'into-folder');
});

test('an app dropped on a row inside a folder goes into that folder', () => {
  assert.equal(dropTargetKind({ srcType: 'app', indent: true }), 'into-folder');
});

test('a widget or folder never enters a folder, it reorders', () => {
  assert.equal(dropTargetKind({ srcType: 'widget', targetIsFolder: true }), 'reorder');
  assert.equal(dropTargetKind({ srcType: 'widget', indent: true }), 'reorder');
  assert.equal(dropTargetKind({ srcType: 'folder', targetIsFolder: true }), 'reorder');
});

test('an app dropped on a top-level non-folder row reorders', () => {
  assert.equal(dropTargetKind({ srcType: 'app', targetIsFolder: false, indent: false }), 'reorder');
});

test('reorder moves a top-level item below the target', () => {
  const items = model();
  assert.equal(applyDrop(items, { srcId: 'a', srcFolderId: null, targetId: 'b', targetFolderId: null, targetIsFolder: false, indent: false, childIdx: null, dropAbove: false }), true);
  assert.deepEqual(order(items), ['b', 'a', 'f', 'c', 'w']);
});

test('reorder respects dropAbove', () => {
  const items = model();
  applyDrop(items, { srcId: 'w', srcFolderId: null, targetId: 'a', targetFolderId: null, targetIsFolder: false, indent: false, childIdx: null, dropAbove: true });
  assert.deepEqual(order(items), ['w', 'a', 'b', 'f', 'c']);
});

test('an app dropped on a folder row joins that folder', () => {
  const items = model();
  applyDrop(items, { srcId: 'a', srcFolderId: null, targetId: 'f', targetFolderId: null, targetIsFolder: true, indent: false, childIdx: null, dropAbove: false });
  assert.deepEqual(folder(items, 'f'), ['c', 'a']);
});

test('an app dropped on a child row inserts at that index', () => {
  const items = model();
  applyDrop(items, { srcId: 'a', srcFolderId: null, targetId: 'c', targetFolderId: 'f', targetIsFolder: false, indent: true, childIdx: 0, dropAbove: false });
  assert.deepEqual(folder(items, 'f'), ['a', 'c']);
});

test('a child dragged onto a top-level row leaves its folder', () => {
  const items = model();
  applyDrop(items, { srcId: 'c', srcFolderId: 'f', targetId: 'b', targetFolderId: null, targetIsFolder: false, indent: false, childIdx: null, dropAbove: false });
  assert.deepEqual(folder(items, 'f'), []);
  assert.deepEqual(order(items), ['a', 'b', 'c', 'f', 'w']);
});

test('a child moves from one folder to another', () => {
  const items = [
    { id: 'a', type: 'app' },
    { id: 'f', type: 'folder', children: ['c'] },
    { id: 'c', type: 'app' },
    { id: 'g', type: 'folder', children: ['d'] },
    { id: 'd', type: 'app' },
  ];
  applyDrop(items, { srcId: 'c', srcFolderId: 'f', targetId: 'g', targetFolderId: null, targetIsFolder: true, indent: false, childIdx: null, dropAbove: false });
  assert.deepEqual(folder(items, 'f'), []);
  assert.deepEqual(folder(items, 'g'), ['d', 'c']);
});

test('a widget dropped on a folder row reorders, it does not join', () => {
  const items = model();
  applyDrop(items, { srcId: 'w', srcFolderId: null, targetId: 'f', targetFolderId: null, targetIsFolder: true, indent: false, childIdx: null, dropAbove: false });
  assert.deepEqual(folder(items, 'f'), ['c']);
  assert.deepEqual(order(items), ['a', 'b', 'f', 'w', 'c']);
});

test('dropping an item on itself changes nothing', () => {
  const items = model();
  assert.equal(applyDrop(items, { srcId: 'a', srcFolderId: null, targetId: 'a', targetFolderId: null, targetIsFolder: false, indent: false, childIdx: null, dropAbove: false }), false);
  assert.deepEqual(order(items), ['a', 'b', 'f', 'c', 'w']);
});
