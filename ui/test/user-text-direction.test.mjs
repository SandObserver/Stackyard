/* A name the user typed carries its own direction, which is not the interface's.

   With the dashboard in Persian the document is right-to-left, so an English
   app or folder name inherits that direction and truncates from the wrong end:
   "Backup and Storage" rendered as "…nd Storage", losing the part that
   identifies it. The reverse happens to a Persian name in an English
   dashboard.

   setUserText sets dir="auto", so each name resolves its own direction from
   its first strong character and clips at its own end, whatever the interface
   language.

   This is a ratchet, not a unit test: the risk is a future render site setting
   textContent from item.label directly and quietly reintroducing the bug. Any
   new one has to go through setUserText or be listed here. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const JS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js');

/* An initial for a fallback icon is a single character, so it has no direction
   to get wrong. Matched on taking [0] or a first-character slice. */
const INITIAL_ONLY = /\[0\]|\.charAt\(0\)|\.slice\(0, ?1\)/;

function offendingLines(file) {
  const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  return src.split('\n').flatMap((line, i) => {
    if (!/\.textContent\s*=/.test(line)) return [];
    /* Only names that came from the user's own config. A manifest's field
       label is translated, so it follows the interface language and must not
       be marked auto-direction. */
    if (!/\b(item|child|app|folder|f)\.label\b/.test(line)) return [];
    if (INITIAL_ONLY.test(line)) return [];
    return [`${file}:${i + 1}: ${line.trim()}`];
  });
}

test('no render site writes a user-supplied name straight to textContent', () => {
  const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
  const offenders = files.flatMap(offendingLines);
  assert.deepEqual(offenders, [], 'use setUserText(node, name) so the name keeps its own direction');
});

test('setUserText is what the dashboard, folders, search and admin all use', () => {
  /* Named individually so removing the call from one of them fails here rather
     than only showing up as a truncated name in a right-to-left language. */
  for (const file of ['ui.js', 'dashboard.js', 'spotlight.js', 'admin.js', 'admin-settings.js']) {
    const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    assert.match(src, /setUserText/, `${file} should render user-supplied names through setUserText`);
  }
});

test('setUserText sets the text and marks it auto-direction', async () => {
  const { setUserText } = await import('../js/utils.js');
  const calls = [];
  const node = /** @type {any} */ ({
    textContent: '',
    setAttribute(name, value) {
      calls.push([name, value]);
    },
  });
  const returned = setUserText(node, 'Backup and Storage');
  assert.equal(node.textContent, 'Backup and Storage');
  assert.deepEqual(calls, [['dir', 'auto']]);
  assert.equal(returned, node, 'returns the node so it can be appended inline');
});
