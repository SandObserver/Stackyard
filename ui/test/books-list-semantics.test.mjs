/* The books shelf is a list, and it has to say so in markup. role="listitem"
   with no list above it is dropped, and each book reaches a reader as
   unpositioned focusable text with no count. */

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

test('the shelf holds the list and nothing else', () => {
  assert.match(books, /<div class="shelf" id="shelf">\s*<ul class="books" id="books"><\/ul>\s*<\/div>/);
});

/* The tile scales down on a phone. Below 10px here the line drops under 9. */
test('no line under the shelf is under 10px', () => {
  for (const cls of ['t', 'a', 'p']) {
    const px = new RegExp(`\\.foot \\.${cls}\\{[^}]*font-size:(\\d+)px`).exec(books);
    assert.ok(px, `.foot .${cls} has no size`);
    assert.ok(Number(px[1]) >= 10, `.foot .${cls} is ${px[1]}px`);
  }
});

test('the line under the shelf is hidden from readers, the books carry the same text', () => {
  assert.match(books, /<div class="foot" id="foot" aria-hidden="true">/);
  assert.match(books, /el\.setAttribute\('aria-label',describe\(b\)\)/);
});

test('a shelf filled under two thirds starts at the edge and leans its last book', () => {
  assert.match(books, /const sparse=shown\.length>1&&used<room\*2\/3;/);
  assert.match(books, /sparse&&i===shown\.length-1\?' lean':''/);
  assert.match(books, /\.books\.sparse\{justify-content:flex-start/);
});

test('a leaning book mirrors in right-to-left text', () => {
  assert.match(books, /\.bk\.lean:dir\(rtl\)\{transform-origin:right bottom;transform:rotate\(8deg\)\}/);
});

/* A frame on a page not yet shown measures zero width. */
test('a zero-width shelf shows every book rather than one', () => {
  assert.match(books, /room=cw>0\?cw-4:Infinity/);
});
