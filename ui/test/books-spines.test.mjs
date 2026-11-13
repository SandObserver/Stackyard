import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const page = fs.readFileSync(new URL('../widgets/books/index.html', import.meta.url), 'utf8');
const source = /function decorate\(books\)\{[\s\S]*?\n {2}\}/.exec(page)?.[0];
const decorateFor = shelves =>
  new Function('SHELVES', 'hash', 'PALETTE', `${source}; return decorate;`)(
    shelves,
    s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7),
    ['#000'],
  );
const titles = Array.from({ length: 60 }, (_, i) => ({ title: `Book ${i} ${'x'.repeat(i % 13)}` }));
const heights = shelves => decorateFor(shelves)(titles).map(b => b._h);

test('books on the three-shelf card stand at least 90% of the shelf', () => {
  const h = heights(3);
  assert.ok(Math.min(...h) >= 90 && Math.max(...h) <= 99, `${Math.min(...h)}-${Math.max(...h)}`);
});

test('one-shelf cards keep their varied heights', () => {
  const h = heights(1);
  assert.ok(Math.min(...h) >= 72 && Math.max(...h) <= 95);
  assert.ok(Math.min(...h) < 90);
});

const { relativeLuminance, contrastRatio, toneForLuminances } = await import('../js/label-contrast.js');
const rgbOf = c => {
  if (/^#[0-9a-f]{3}$/i.test(c)) c = c.replace(/[0-9a-f]/gi, d => d + d);
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  return /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(c).slice(1).map(Number);
};
const lumOf = c => relativeLuminance(...rgbOf(c));
const spineInk = new Function(
  'toneForColor',
  `${/function spineInk\(color\)\{[^\n]*\}/.exec(page)?.[0]}; return spineInk;`,
)(c => toneForLuminances([lumOf(c)]));
const palette = JSON.parse(/const PALETTE=(\[[^\]]*\]);/.exec(page)[1].replaceAll("'", '"'));

test('spine titles reach 4.5:1 on provider colours and the built-in palette', () => {
  for (const fill of ['#FF4245', '#00A000', 'rgb(240, 240, 240)', ...palette]) {
    const ratio = contrastRatio(lumOf(spineInk(fill)), lumOf(fill));
    assert.ok(ratio >= 4.5, `${fill}: ${ratio.toFixed(2)}:1`);
  }
});

test('a cover colour the parser cannot read keeps the light ink', () => {
  const ink = new Function('toneForColor', `${/function spineInk\(color\)\{[^\n]*\}/.exec(page)[0]}; return spineInk;`)(
    () => null,
  );
  assert.equal(ink('nonsense'), '#fff');
});
