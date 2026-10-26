import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const { creditPlacement } = await import('../js/photo-credit.js');

test('the credit sits beside the Dock, limited to the room left of it', () => {
  assert.deepEqual(creditPlacement(1440, { left: 520, right: 920 }, false, 20), { place: 'bottom', maxWidth: 480 });
});

test('in a right-to-left layout the room is measured right of the Dock', () => {
  assert.deepEqual(creditPlacement(1440, { left: 400, right: 1000 }, true, 20), { place: 'bottom', maxWidth: 400 });
});

/* Both are fixed to the bottom edge, so a credit wider than the room overlaps the Dock. */
test('a Dock that leaves too little room moves the credit to the top', () => {
  assert.equal(creditPlacement(800, { left: 100, right: 700 }, false, 20).place, 'top');
});

test('with no Dock the credit keeps the bottom corner', () => {
  assert.deepEqual(creditPlacement(1000, null, false, 20), { place: 'bottom', maxWidth: 480 });
});
