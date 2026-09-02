/* The books shelf is a list, and it has to say so in markup. role="listitem"
   with no list above it is dropped, and each book reaches a reader as
   unpositioned focusable text with no count.

   The shelf itself cannot be that list: it also holds the two decorative ledge
   strips, which are not books. The list is nested inside it. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const books = fs.readFileSync(path.join(root, 'widgets/books/index.html'), 'utf8');

test('the shelf holds a real list, not a div wearing a role', () => {
  assert.match(books, /<ul class="books" id="books">/);
  assert.match(books, /createElement\('li'\)/, 'a book is a list item');
  assert.doesNotMatch(books, /setAttribute\('role','listitem'\)/, 'a real li needs no role');
});

/* WebKit drops list semantics when the bullets are removed, so the role is
   declared even though the element is already a list. */
test('the list keeps its role despite the bullets being removed', () => {
  assert.match(books, /\.books\{list-style:none/);
  assert.match(books, /list\.setAttribute\('role','list'\)/);
});

/* An empty list that declares the role reports as missing its children, and an
   unconfigured widget renders no rows at all. */
test('the role is dropped while the shelf is empty', () => {
  const render = books.slice(books.indexOf('function render(books,list,shelf)'));
  const drop = render.indexOf("list.removeAttribute('role')");
  const set = render.indexOf("list.setAttribute('role','list')");
  assert.ok(books.includes('function render(books,list,shelf)'), 'the render signature moved');
  assert.ok(drop > -1 && set > -1, 'the role is never toggled');
  assert.ok(drop < set, 'the role has to be cleared before the empty case returns');
});

/* The ledges are shelf furniture. Inside the list they would be children that
   are not list items. */
test('the shelf decorations stay outside the list', () => {
  assert.match(books, /<ul class="books" id="books"><\/ul>/, 'a ledge would otherwise sit inside the list');
  const list = books.indexOf('<ul class="books"');
  const ledge = books.indexOf('class="ledge-top"');
  assert.ok(list > -1 && ledge > list, 'the ledges are siblings after the list, not children of it');
  assert.match(books, /class="ledge-top" aria-hidden="true"/);
  assert.match(books, /class="ledge" aria-hidden="true"/);
});

/* The panel sat at the tile's border box, under the rounded corner and over the
   header, with its smallest line at 9px before the tile's own scaling. */
test('the hover panel is inset from the tile edge', () => {
  const rule = /\.info\{([^}]*)\}/.exec(books);
  assert.ok(rule, 'the info rule is missing');
  for (const side of ['left', 'right', 'top']) {
    const px = new RegExp(`${side}:(\\d+)px`).exec(rule[1]);
    assert.ok(px && Number(px[1]) > 0, `the panel still sits on the tile's ${side} edge`);
  }
  assert.match(rule[1], /border-radius:/, 'an inset panel with square corners reads as a torn-off bar');
});

test('no line in the hover panel is under 10px', () => {
  for (const cls of ['t', 'a', 'p']) {
    const px = new RegExp(`\\.info \\.${cls}\\{font-size:(\\d+)px`).exec(books);
    assert.ok(px, `.info .${cls} has no size`);
    assert.ok(Number(px[1]) >= 10, `.info .${cls} is ${px[1]}px, which the tile's scaling drops below 9`);
  }
});
