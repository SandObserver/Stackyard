/* The strength bars and their label report on the password field, so they must
   sit with it. Declared at the end of the document they render full width below
   the settings card, where the field they describe is off screen.

   The hidden inputs below them are different: initInlineEdit moves each one into
   its row, so where they are declared does not decide where they appear. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');

const at = id => src.indexOf(`id="${id}"`);

test('the bars and the hint sit in the security section', () => {
  const pwRow = at('ie-pw');
  const revokeTip = at('revoke-tip');
  assert.ok(pwRow > 0 && revokeTip > pwRow, 'expected the password row above the revoke tip');

  for (const id of ['sec-pw-bars', 'sec-pw-hint']) {
    const pos = at(id);
    assert.ok(pos > pwRow, `${id} must come after the password row`);
    assert.ok(pos < revokeTip, `${id} must stay inside the security section, not at the end of the document`);
  }
});

test('nothing moves them at runtime, so the markup decides where they appear', () => {
  const js = fs
    .readdirSync(path.join(root, 'js'))
    .filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(root, 'js', f), 'utf8'))
    .join('\n');

  for (const m of js.matchAll(/(appendChild|insertBefore|append|prepend)\([^)]*\)/g)) {
    assert.doesNotMatch(m[0], /sec-pw-(bars|hint)/, `${m[0]} moves an element the markup places`);
  }
});
