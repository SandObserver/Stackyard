import { test } from 'node:test';
import assert from 'node:assert/strict';

const { ICONS, symbol } = await import('../js/icon-set.js');

test('the logo draws one accent arc and three ink strokes inside the grid', () => {
  const { sym } = symbol('logo', ICONS.logo);
  assert.equal((sym.match(/class="sy-a"/g) || []).length, 1);
  assert.equal((sym.match(/class="sy-i"/g) || []).length, 3);
  const nums = [...sym.matchAll(/\sd="([^"]+)"/g)].flatMap(m => m[1].match(/-?\d+(\.\d+)?/g).map(Number));
  assert.ok(
    nums.every(n => n >= 0 && n <= 24),
    'every coordinate stays on the 24 grid',
  );
});

test('line styles draw the logo as strokes, not outlined areas', () => {
  const { sym } = symbol('logo', ICONS.logo, 'stroke');
  assert.equal((sym.match(/fill="none"/g) || []).length, 4);
});

test('the docs section icons are in the set', () => {
  for (const id of ['start', 'run', 'create']) assert.ok(ICONS[id], id);
});
