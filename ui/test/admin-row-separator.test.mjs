import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* A settings row's separator belongs between two rows the user can see.

   The rule was `.row:last-child { border-bottom: none }`, which asks a question
   about position in the DOM rather than about what is on screen. Security's
   group ends with two rows that stay hidden until password protection is on, so
   the exemption landed on a hidden row and the visible last row, Password
   Protection, drew a border under itself with nothing beneath it.

   The fix needs both halves to hold: the stylesheet has to ask whether a later
   row is visible, and a hidden row has to be hidden in a way CSS can see. An
   inline style="display:none" is invisible to a selector, so rows use .d-none. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/admin.css');
const html = read('admin/index.html');

test('the separator is removed from the last visible row, not the last child', () => {
  assert.match(
    css,
    /\.row:not\(:has\(~ \.row:not\(\.d-none\)\)\)\{border-bottom:none\}/,
    'the visibility-aware rule is gone',
  );
  assert.doesNotMatch(
    css,
    /\.row(\.\w+)?:last-child\{border-bottom:none\}/,
    'a :last-child exemption is back; it cannot see a hidden trailing row',
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
