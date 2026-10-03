import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyBrightness,
  cellsForRect,
  containDestRect,
  contrastRatio,
  coverSourceRect,
  drawPlan,
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

test('fit shows the whole image, centred, with a band on two edges', () => {
  const wide = containDestRect(2000, 1000, 1000, 1000);
  assert.deepEqual(wide, { dx: 0, dy: 250, dw: 1000, dh: 500 });
  const tall = containDestRect(1000, 2000, 1000, 1000);
  assert.deepEqual(tall, { dx: 250, dy: 0, dw: 500, dh: 1000 });
});

test('an image the shape of the viewport has no band in either mode', () => {
  assert.deepEqual(containDestRect(1600, 900, 800, 450), { dx: 0, dy: 0, dw: 800, dh: 450 });
  assert.deepEqual(coverSourceRect(1600, 900, 800, 450), { sx: 0, sy: 0, sw: 1600, sh: 900 });
});

test('fill crops the source and fills the viewport; fit keeps the source whole', () => {
  const fill = drawPlan(2000, 1000, 1000, 1000, 'fill');
  assert.deepEqual(fill, { sx: 500, sy: 0, sw: 1000, sh: 1000, dx: 0, dy: 0, dw: 1000, dh: 1000 });
  const fit = drawPlan(2000, 1000, 1000, 1000, 'fit');
  assert.deepEqual(fit, { sx: 0, sy: 0, sw: 2000, sh: 1000, dx: 0, dy: 250, dw: 1000, dh: 500 });
});

test('an unknown fit is treated as fill', () => {
  assert.deepEqual(drawPlan(2000, 1000, 1000, 1000, 'stretch'), drawPlan(2000, 1000, 1000, 1000, 'fill'));
});

/* A fake 2D canvas that understands #rrggbb, #rrggbbaa and rgba(), keeps its
   previous fill for anything else, and draws over what is already there, as a
   real one does. */
function fakeCanvasDocument() {
  const calls = { canvases: 0, reads: 0 };
  const parse = v => {
    let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(v);
    if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), m[4] ? parseInt(m[4], 16) / 255 : 1];
    m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(v.replace(/\s/g, ''));
    return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
  };
  globalThis.document = {
    createElement() {
      calls.canvases++;
      let fill = [0, 0, 0, 1];
      let px = [0, 0, 0, 0];
      const ctx = {
        set fillStyle(v) {
          fill = parse(v) || fill;
        },
        clearRect() {
          px = [0, 0, 0, 0];
        },
        fillRect() {
          const a = fill[3];
          const out = px[3] * (1 - a) + a;
          px = [0, 1, 2].map(i => (fill[i] * a + px[i] * px[3] * (1 - a)) / (out || 1)).concat(out);
        },
        getImageData() {
          calls.reads++;
          return { data: [...px.slice(0, 3).map(Math.round), Math.round(px[3] * 255)] };
        },
      };
      return { getContext: () => ctx };
    },
  };
  return calls;
}

test('a plate colour is read once, however many tiles share it', async () => {
  const calls = fakeCanvasDocument();
  const { toneForColor } = await import('../js/label-contrast.js');
  for (let i = 0; i < 50; i++) assert.equal(toneForColor('#f0f0f0'), 'dark');
  assert.equal(toneForColor('#101010'), 'light');
  assert.equal(calls.canvases, 1, 'each read made its own canvas');
  assert.equal(calls.reads, 4, 'a repeated colour was parsed again');
});

test('an unreadable colour still answers null when asked again', async () => {
  fakeCanvasDocument();
  const { toneForColor } = await import('../js/label-contrast.js');
  assert.equal(toneForColor('not-a-colour'), null);
  assert.equal(toneForColor('not-a-colour'), null);
});

test('a translucent colour reads the same after another colour as on its own', async () => {
  fakeCanvasDocument();
  const { toneForColor } = await import('../js/label-contrast.js');
  const alone = toneForColor('rgba(120,120,128,.36)');
  assert.ok(alone, 'the translucent plate did not parse');
  toneForColor('#ffffff');
  assert.equal(toneForColor('rgba(121,120,128,.36)'), alone);
  toneForColor('#000000');
  assert.equal(toneForColor('#7978808c'), alone);
});
