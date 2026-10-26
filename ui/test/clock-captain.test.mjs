import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beerLevel, changedFigures, fitSize, partOfDay, splitLine } from '../js/clock-captain.js';

test('the wall changes at 6, 10, 17, 20 and midnight', () => {
  const at = [0, 5, 6, 9, 10, 16, 17, 19, 20, 23].map(partOfDay);
  assert.deepEqual(at, ['late', 'late', 'morning', 'morning', 'day', 'day', 'dusk', 'dusk', 'night', 'night']);
});

test('the glass is never empty and never overflows', () => {
  assert.equal(
    beerLevel(() => 0),
    0.22,
  );
  assert.ok(Math.abs(beerLevel(() => 1) - 0.92) < 1e-9);
});

test('text shrinks to fit and stops at its floor', () => {
  assert.equal(fitSize(100, 24, 200), 24);
  assert.equal(fitSize(300, 24, 200), 16);
  assert.equal(fitSize(300, 24, 200, 22), 22);
  assert.equal(fitSize(0, 24, 200), 24);
});

test('only the figures that changed move', () => {
  assert.deepEqual(changedFigures('16:59', '17:00'), [1, 3, 4]);
  assert.deepEqual(changedFigures('12:34', '12:35'), [4]);
  assert.deepEqual(changedFigures('۱۲:۳۴', '۱۲:۳۵'), [4]);
});

test('a line too long for the balloon breaks after its comma', () => {
  assert.deepEqual(splitLine('کاپیتان، امروز چهارشنبه‌ست!'), ['کاپیتان،', 'امروز چهارشنبه‌ست!']);
  assert.deepEqual(splitLine('Kapitän, es ist Donnerstag!'), ['Kapitän,', 'es ist Donnerstag!']);
  assert.deepEqual(splitLine('No comma here'), ['No comma here']);
});
