import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canJoinFolder, dropTargetKind } from '../js/admin-drag-logic.js';

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
