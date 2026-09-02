/* wireRowDrag wired the touch handler twice, so a touch drag built two ghosts,
   captured the pointer twice and committed the move twice.

   Counting the listeners is the point. Any assertion that dragging still works
   passes with the handler attached twice. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

globalThis.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelectorAll: () => [],
  getElementById: () => null,
};

const { wireRowDrag } = await import('../js/admin-drag.js');

/* An element only as real as wireRowDrag touches, counting what it listens for. */
const element = () => ({
  counts: Object.create(null),
  dataset: {},
  classList: { add() {}, remove() {}, contains: () => false },
  addEventListener(type) {
    this.counts[type] = (this.counts[type] ?? 0) + 1;
  },
});

const wire = () => {
  const row = element();
  const handle = element();
  wireRowDrag(row, handle, {
    item: { id: 'a1', type: 'link' },
    indent: false,
    folderId: null,
    childIdx: null,
  });
  return { row, handle };
};

test('the touch handler is wired once per row', () => {
  const { handle } = wire();
  assert.equal(handle.counts.pointerdown, 1);
});

test('every drag listener is wired once per row', () => {
  const { row, handle } = wire();
  for (const [type, count] of Object.entries({ ...row.counts, ...handle.counts })) {
    assert.equal(count, 1, `${type} wired ${count} times`);
  }
  assert.deepEqual(Object.keys(row.counts).sort(), ['dragend', 'dragleave', 'dragover', 'dragstart', 'drop']);
});
