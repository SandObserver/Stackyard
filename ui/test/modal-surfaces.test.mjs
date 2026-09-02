/* Every surface that covers the page must keep focus inside itself.

   A focus trap stops Tab and nothing else: the page behind stays readable to a
   screen reader. A native dialog makes it inert instead.

   So each surface opens as a modal, no trap or hand-rolled equivalent
   reappears, and the one surface that must not be dismissed by Escape still
   refuses it. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

/* Every modal surface must keep focus inside itself. There are two ways to do
   that and no third: a native dialog opened with showModal, which the browser
   contains and makes the rest of the page inert, or the shared trap here. A
   surface that rolls its own is the defect the next test forbids.

   The list moves as surfaces convert. Each entry names the mechanism it is
   entitled to, so converting one is an edit here rather than a deletion. */
test('every modal surface keeps focus, one way or the other', () => {
  const contains = { dialog: /\bshowModal\(\)/g, trap: /\btrapFocus\(|\bwrapTab\(/g };
  const sites = [
    ['js/ui.js', 'dialog', 2, 'the two folder overlays'],
    ['js/modal.js', 'dialog', 1, 'the admin modal'],
    ['js/dashboard.js', 'dialog', 1, 'the setup prompt'],
    ['js/spotlight.js', 'dialog', 1, 'the search overlay'],
  ];
  /* Comments name these mechanisms while explaining them. */
  const source = file => read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [file, how, count, what] of sites) {
    const found = (source(file).match(contains[how]) || []).length;
    assert.equal(found, count, `${what}: expected ${count} ${how} site(s) in ${file}, found ${found}`);
  }
});

test('a converted surface leaves no trap behind', () => {
  /* A trap released nowhere keeps a listener on a removed element, so a
     converted surface must hold neither a trap nor a handle to release. */
  for (const file of ['js/ui.js', 'js/dashboard.js', 'js/modal.js', 'js/spotlight.js']) {
    assert.doesNotMatch(read(file), /trapFocus/, `${file} still arms the trap`);
    assert.doesNotMatch(read(file), /release\w*Trap/, `${file} still holds a trap handle`);
  }
});

/* Escape closes a dialog unless the page says otherwise. The setup prompt has
   nothing usable behind it and offers Skip as the way past, so it must refuse
   the cancel rather than let a stray keypress dismiss it. */
test('the setup prompt refuses to be cancelled', () => {
  assert.match(
    read('js/dashboard.js'),
    /addEventListener\('cancel', e => e\.preventDefault\(\)\)/,
    'Escape now dismisses the setup prompt, which it never used to',
  );
});

test('nothing keeps its own copy of the trap', () => {
  /* Including an inline copy in one surface, which leaves the others nothing to
     reuse. */
  for (const file of ['js/spotlight.js', 'js/ui.js', 'js/dashboard.js']) {
    assert.doesNotMatch(
      read(file),
      /e\.shiftKey && document\.activeElement === first/,
      `${file} still carries its own trap`,
    );
  }
});
