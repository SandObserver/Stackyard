/* A name the user typed carries its own direction, which is not the
   interface's. A name that inherits the document's direction truncates from the
   wrong end, losing the part that identifies it.

   setUserText sets dir="auto", so each name resolves its own direction from its
   first strong character and clips at its own end.

   This is a ratchet: a render site setting textContent from item.label directly
   reintroduces the defect, so any new one goes through setUserText or is listed
   here. */

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

/* The isolation belongs on the text, not on the block that holds it. `dir` sets
   alignment as well as bidi, so marking the block drags the row's alignment to
   the other edge. */
test('setUserText isolates the name in a bdi and leaves the block alone', async () => {
  const { setUserText } = await import('../js/utils.js');
  const made = [];
  const node = /** @type {any} */ ({
    textContent: '',
    children: [],
    setAttribute(name, value) {
      made.push(['block', name, value]);
    },
    appendChild(child) {
      this.children.push(child);
      this.textContent = child.textContent;
    },
  });
  globalThis.document = {
    createElement(tag) {
      const el = { tag, textContent: '', setAttribute: (n, v) => made.push([tag, n, v]) };
      return el;
    },
  };
  const returned = setUserText(node, 'Backup and Storage');
  assert.equal(node.children.length, 1);
  assert.equal(node.children[0].tag, 'bdi', 'the name is not isolated');
  assert.equal(node.children[0].textContent, 'Backup and Storage');
  assert.deepEqual(
    made.filter(m => m[0] === 'block'),
    [],
    'the block still carries a direction, which sets its alignment too',
  );
  assert.equal(returned, node, 'returns the node so it can be appended inline');
});
