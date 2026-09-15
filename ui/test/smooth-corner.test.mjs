import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smoothRectPath } from '../js/smooth-corner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

/* Every endpoint and control point as [x, y]. An arc's radii and flags are not points. */
const points = d =>
  (d.match(/[A-Z][^A-Z]*/g) || []).flatMap(seg => {
    const nums = (seg.slice(1).match(/-?\d+(\.\d+)?/g) || []).map(Number);
    const xy = seg[0] === 'A' ? nums.slice(-2) : nums;
    const out = [];
    for (let i = 0; i < xy.length; i += 2) out.push([xy[i], xy[i + 1]]);
    return out;
  });

test('the path stays inside its box', () => {
  for (const [w, h, r, s] of [
    [375, 108, 40, 0.2],
    [60, 60, 40, 0.6],
    [200, 20, 40, 1],
  ]) {
    const d = smoothRectPath(w, h, r, s);
    assert.ok(d.startsWith('M') && d.endsWith('Z'), d);
    assert.doesNotMatch(d, /NaN|Infinity/, d);
    for (const [x, y] of points(d)) {
      assert.ok(x >= 0 && x <= w, `x=${x} outside ${w} in ${d}`);
      assert.ok(y >= 0 && y <= h, `y=${y} outside ${h} in ${d}`);
    }
  }
});

test('smoothing 0 is a plain rounded rectangle', () => {
  const d = smoothRectPath(100, 80, 20, 0);
  assert.ok(d.startsWith('M20 0L80 0'), d);
  assert.match(d, /A20 20 0 0 1 100 20/);
});

test('a smoothed corner reaches further along the edge than its radius', () => {
  assert.ok(smoothRectPath(375, 108, 40, 0.2).startsWith('M48 0L327 0'));
});

test('the corner never reaches past half the short side', () => {
  assert.ok(smoothRectPath(375, 60, 40, 0.6).startsWith('M30 0'));
});

test('the mobile dock draws the smooth shape at phone width', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /const dockW = Math\.min\(maxDockW, Math\.round\(\(PHONE_W - 18\) \* sc\)\)/);
  assert.match(ui, /observeGlass\(dk, Math\.round\(40 \* sc\), 0\.2\)/);
  assert.doesNotMatch(ui, /border-radius:\$\{Math\.round\(44 \* sc\)\}px/, 'the dock is back to a circular corner');
});
