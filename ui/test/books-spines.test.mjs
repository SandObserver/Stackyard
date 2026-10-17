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
