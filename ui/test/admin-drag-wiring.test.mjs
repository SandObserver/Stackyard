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

test('a mouse drop redraws the list as soon as the drag ends', async () => {
  const { initDrag, redrawHeld } = await import('../js/admin-drag.js');
  const { state } = await import('../js/admin-state.js');
  state.items = [
    { id: 'a', type: 'app', label: 'A' },
    { id: 'b', type: 'app', label: 'B' },
  ];
  let drawn = 0;
  let saved = 0;
  initDrag(
    () => saved++,
    () => {},
    () => {
      if (!redrawHeld()) drawn++;
    },
  );
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  const live = () => {
    const on = Object.create(null);
    return {
      on,
      dataset: { group: 'home' },
      classList: { add() {}, remove() {}, contains: () => false },
      addEventListener(type, fn) {
        on[type] = fn;
      },
    };
  };
  const rowA = live();
  const rowB = live();
  wireRowDrag(rowA, live(), { item: state.items[0], indent: false, folderId: null, childIdx: null });
  wireRowDrag(rowB, live(), { item: state.items[1], indent: false, folderId: null, childIdx: null });
  let data = '';
  const dataTransfer = {
    setData: (_t, v) => {
      data = v;
    },
    getData: () => data,
  };
  rowA.on.dragstart({ dataTransfer });
  rowB.on.drop({ preventDefault() {}, dataTransfer });
  rowA.on.dragend({});
  assert.deepEqual(
    state.items.map(i => i.id),
    ['b', 'a'],
  );
  assert.equal(saved, 1);
  assert.equal(drawn, 1, 'the rows keep their old order until the save returns');
});

test('a row opens its editor by item id, never by its position', async () => {
  const fs = await import('node:fs');
  const list = fs.readFileSync(new URL('../js/admin-list.js', import.meta.url), 'utf8');
  const admin = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  const opens = list.match(/_page\.openModal\([^)]*\)/g) || [];
  assert.equal(opens.length, 2);
  for (const call of opens) assert.equal(call, '_page.openModal(item.id)');
  assert.doesNotMatch(list, /state\.items\.indexOf\(/);
  assert.match(
    admin,
    /function openModal\(id\) \{\s*const editing = id != null \? state\.items\.find\(i => i\?\.id === id\) : null;/,
  );
  assert.doesNotMatch(admin, /state\.items\[idx\]/);
});
