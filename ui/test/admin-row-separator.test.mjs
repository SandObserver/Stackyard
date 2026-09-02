import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* A settings row's separator belongs between two rows the user can see.

   `:last-child` asks about position in the DOM, not about what is on screen, so
   a group ending in hidden rows draws a border under its visible last row with
   nothing beneath it.

   Both halves have to hold: the stylesheet asks whether a later row is visible,
   and a hidden row is hidden in a way CSS can see. An inline
   style="display:none" is invisible to a selector, so rows use .d-none.

   The separator is drawn as .row::after rather than a border, because a grouped
   list insets it to the leading edge of the label and a border cannot be
   inset. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/admin.css');
const html = read('admin/index.html');

test('the separator is removed from the last visible row, not the last child', () => {
  assert.match(
    css,
    /\.row:not\(:has\(~ \.row:not\(\.d-none\), ~ \.row-wrap:not\(\.d-none\)\)\)::after\{content:none\}/,
    'the visibility-aware rule is gone',
  );
  assert.doesNotMatch(
    css,
    /\.row(\.\w+)?:last-child(::after)?\{(border-bottom:none|content:none)\}/,
    'a :last-child exemption is back; it cannot see a hidden trailing row',
  );
});

test('a wrapped field draws the separator, and drops it when last visible', () => {
  assert.match(
    css,
    /\.row-wrap::after\{content:'';position:absolute/,
    'a wrapped field draws no separator, so a hinted row runs into the next one',
  );
  assert.match(
    css,
    /\.row-wrap:not\(:has\(~ \.row:not\(\.d-none\), ~ \.row-wrap:not\(\.d-none\)\)\)::after\{content:none\}/,
    'a trailing wrapped field draws a separator with nothing under it',
  );
});

test('a row hides with the class, never with an inline style', () => {
  const offenders = [...html.matchAll(/<div[^>]*class="row[^"]*"[^>]*>/g)]
    .map(m => m[0])
    .filter(tag => /style="[^"]*display\s*:\s*none/.test(tag))
    .map(tag => {
      const id = /id="([^"]+)"/.exec(tag);
      return id ? id[1] : '(no id)';
    });
  assert.deepEqual(
    offenders,
    [],
    `These rows hide in a way the stylesheet cannot see. Use class="… d-none":\n  ${offenders.join('\n  ')}`,
  );
});

test('nothing toggles a row back to an inline display', () => {
  const offenders = [];
  for (const file of ['js/admin.js', 'js/admin-settings.js']) {
    const src = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/(\w*[Rr]ow\w*)\.style\.display\s*=/g)) {
      offenders.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Use classList.toggle('d-none', …) so the separator rule still applies:\n  ${offenders.join('\n  ')}`,
  );
});

/* The class has to actually hide, and to win against the row's own display. */
test('d-none is defined and beats the row layout', () => {
  assert.match(css, /\.d-none\{display:none!important\}/);
});
