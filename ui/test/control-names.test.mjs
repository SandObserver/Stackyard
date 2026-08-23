/* Every control the settings page ships has to say what it is.

   Three of them did not. A toggle was written as a label wrapping a bare
   checkbox, with the name on the label: aria-label is prohibited on an element
   with no role, so it was discarded and the checkbox reached a screen reader as
   "checkbox, not checked". All six read that way. The inline-edit fields were
   never linked to the row label beside them, so each announced as an unnamed
   edit box once the pencil opened it, the password field included.

   The visible label is the one the catalog already translates, so pointing at
   it with aria-labelledby names the control and keeps it in step with the
   language. A second aria-label would be a second string to translate and a
   second one to forget. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const admin = read('admin/index.html');

const { uniqueTitle } = await import('../js/widget-types.js');

/* ── the toggles ──────────────────────────────────────────────────────────── */

const TOGGLES = [...admin.matchAll(/<label class="tog"[^>]*>\s*<input type="checkbox"([^>]*)>/g)].map(m => m[1]);

test('every toggle is found', () => {
  assert.equal(TOGGLES.length, 6, 'the toggle markup changed shape');
});

test('every toggle is named by the row label beside it', () => {
  const unnamed = [];
  for (const attrs of TOGGLES) {
    const id = /\bid="([^"]+)"/.exec(attrs)?.[1] || '(no id)';
    const points = /\baria-labelledby="([^"]+)"/.exec(attrs)?.[1];
    if (!points) {
      unnamed.push(`${id} has no aria-labelledby`);
      continue;
    }
    const target = new RegExp(`<span class="rl" id="${points}"([^>]*)>`).exec(admin);
    if (!target) unnamed.push(`${id} points at ${points}, which is not a row label`);
    else if (!/data-i18n="/.test(target[1])) unnamed.push(`${id} is named by an untranslated label`);
  }
  assert.deepEqual(unnamed, [], `Toggles a screen reader cannot name:\n  ${unnamed.join('\n  ')}`);
});

/* aria-label on an element with no role is discarded, so a name written there
   is not a name at all. */
test('no toggle carries its name on the label element', () => {
  assert.doesNotMatch(admin, /<label class="tog" aria-label=/);
});

/* ── the inline-edit fields ───────────────────────────────────────────────── */

const shared = read('js/admin-shared.js');

test('an inline-edit field is named by its row label', () => {
  const fn = shared.slice(shared.indexOf('export function initInlineEdit'));
  assert.match(fn, /q\('\.rl', row\)/, 'the row label is what carries the translated name');
  assert.match(fn, /setAttribute\('aria-labelledby'/);
});

/* This runs at module load, before the catalog is fetched, so a placeholder
   read then is the key rather than its translation. */
test('an inline-edit placeholder is read when it is used, not when it is wired', () => {
  const fn = shared.slice(shared.indexOf('export function initInlineEdit'));
  assert.match(fn, /typeof placeholder === 'function' \? placeholder\(\)/);
  assert.doesNotMatch(fn, /inp\.placeholder = placeholder;/);
});

test('the password placeholder is passed as a function', () => {
  assert.match(read('js/admin.js'), /placeholder: \(\) => t\('general\.passwordPh'\)/);
});

/* ── widget frame names ───────────────────────────────────────────────────── */

/* Two widgets of one type share a manifest label, and the frame list then holds
   several entries with one name and no way to tell them apart. */
test('a repeated title is numbered from the second one', () => {
  const used = new Set();
  assert.equal(uniqueTitle('Clock', used), 'Clock');
  assert.equal(uniqueTitle('Clock', used), 'Clock 2');
  assert.equal(uniqueTitle('Clock', used), 'Clock 3');
});

test('a title that is already distinct is left alone', () => {
  const used = new Set();
  assert.equal(uniqueTitle('Clock', used), 'Clock');
  assert.equal(uniqueTitle('Weather', used), 'Weather');
});

/* The numbered form is itself a title someone can have typed. */
test('a numbered title does not collide with a generated one', () => {
  const used = new Set();
  assert.equal(uniqueTitle('Clock', used), 'Clock');
  assert.equal(uniqueTitle('Clock 2', used), 'Clock 2');
  assert.equal(uniqueTitle('Clock', used), 'Clock 3');
});

test('both dashboard builders number their frames', () => {
  for (const f of ['js/dashboard.js', 'js/ui.js']) {
    assert.match(read(f), /uniqueTitle\(/, `${f} builds widget frames without numbering them`);
  }
});
