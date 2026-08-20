import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyBrightness,
  cellsForRect,
  contrastRatio,
  coverSourceRect,
  gridFromPixels,
  relativeLuminance,
  toneForLuminances,
  toneForRect,
} from '../js/label-contrast.js';

test('relative luminance matches the WCAG anchors', () => {
  assert.equal(relativeLuminance(255, 255, 255), 1);
  assert.equal(relativeLuminance(0, 0, 0), 0);
  assert.ok(Math.abs(relativeLuminance(119, 119, 119) - 0.1845) < 0.001);
});

test('contrast ratio spans 1 to 21', () => {
  assert.ok(Math.abs(contrastRatio(1, 0) - 21) < 1e-9);
  assert.equal(contrastRatio(0.5, 0.5), 1);
  assert.equal(contrastRatio(1, 0), contrastRatio(0, 1));
});

test('a light background takes dark labels and a dark one takes light labels', () => {
  assert.equal(toneForLuminances([relativeLuminance(240, 240, 240)]), 'dark');
  assert.equal(toneForLuminances([relativeLuminance(20, 22, 26)]), 'light');
});

test('a patch of mixed brightness takes the tone with the better worst case', () => {
  const mixed = [relativeLuminance(255, 255, 255), relativeLuminance(90, 90, 90)];
  assert.equal(toneForLuminances(mixed), 'dark');
});

test('no samples leaves the labels light', () => {
  assert.equal(toneForLuminances([]), 'light');
});

test('cover crops the long axis and keeps the centre', () => {
  const wide = coverSourceRect(2000, 1000, 1000, 1000);
  assert.deepEqual(wide, { sx: 500, sy: 0, sw: 1000, sh: 1000 });
  const tall = coverSourceRect(1000, 2000, 1000, 1000);
  assert.deepEqual(tall, { sx: 0, sy: 500, sw: 1000, sh: 1000 });
  assert.deepEqual(coverSourceRect(800, 600, 1600, 1200), { sx: 0, sy: 0, sw: 800, sh: 600 });
});

test('brightness multiplies the channel and clamps', () => {
  assert.equal(applyBrightness(100, 0.5), 50);
  assert.equal(applyBrightness(200, 2), 255);
  assert.equal(applyBrightness(10, 0), 0);
});

test('the page brightness is part of the measurement', () => {
  const white = [255, 255, 255, 255];
  assert.equal(toneForLuminances(gridFromPixels(white, 1, 1, 1)), 'dark');
  assert.equal(toneForLuminances(gridFromPixels(white, 1, 1, 0.25)), 'light');
});

test('a rectangle maps to every cell it covers', () => {
  const rect = { left: 0, top: 0, right: 50, bottom: 50 };
  assert.deepEqual(cellsForRect(rect, 100, 100, 2, 2), [0]);
  assert.deepEqual(cellsForRect({ left: 0, top: 0, right: 100, bottom: 100 }, 100, 100, 2, 2), [0, 1, 2, 3]);
});

test('a rectangle off the edge of the viewport still lands on the grid', () => {
  const cells = cellsForRect({ left: -40, top: -40, right: 10, bottom: 10 }, 100, 100, 2, 2);
  assert.deepEqual(cells, [0]);
  assert.deepEqual(cellsForRect({ left: 90, top: 90, right: 400, bottom: 400 }, 100, 100, 2, 2), [3]);
});

test('a rectangle with no viewport to sit in yields no cells', () => {
  assert.deepEqual(cellsForRect({ left: 0, top: 0, right: 1, bottom: 1 }, 0, 0, 2, 2), []);
});

test('two labels on one photo can take different tones', () => {
  /* Left half white, right half near black. */
  const grid = [relativeLuminance(255, 255, 255), relativeLuminance(10, 10, 10)];
  const left = { left: 0, top: 0, right: 40, bottom: 100 };
  const right = { left: 60, top: 0, right: 100, bottom: 100 };
  assert.equal(toneForRect(grid, 2, 1, 100, 100, left), 'dark');
  assert.equal(toneForRect(grid, 2, 1, 100, 100, right), 'light');
});
