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

const MOVE = /\.(appendChild|insertBefore|append|prepend|before|after|replaceWith|insertAdjacentElement)\(([^)]*)\)/g;
const sources = fs
  .readdirSync(path.join(root, 'js'))
  .filter(n => n.endsWith('.js'))
  .map(f => [f, fs.readFileSync(path.join(root, 'js', f), 'utf8')]);

/** The text from `from` to the end of the block that holds it. */
function blockFrom(js, from) {
  const lineStart = js.lastIndexOf('\n', from) + 1;
  const indent = /^\s*/.exec(js.slice(lineStart))[0].length;
  const close = new RegExp(`\\n\\s{0,${Math.max(0, indent - 1)}}\\}`, 'g');
  close.lastIndex = from;
  const end = close.exec(js);
  return js.slice(from, end ? end.index : js.length);
}

test('nothing moves them at runtime, so the markup decides where they appear', () => {
  for (const [f, js] of sources) {
    for (const m of js.matchAll(MOVE)) {
      assert.doesNotMatch(m[2], /sec-pw-(bars|hint)/, `${f}: ${m[0]} moves an element the markup places`);
    }
    for (const b of js.matchAll(/(\w+)\s*=\s*[\w.]+\(\s*['"]#?sec-pw-(?:bars|hint)['"]\s*\)/g)) {
      const held = new RegExp(`\\b${b[1]}\\b`);
      for (const m of blockFrom(js, b.index).matchAll(MOVE)) {
        assert.doesNotMatch(m[2], held, `${f}: ${m[0]} moves an element the markup places`);
      }
    }
  }
});

test('nothing they are handed to moves them either', () => {
  const callees = new Set();
  for (const [, js] of sources) {
    for (const m of js.matchAll(/\b(\w+)\([^()]*['"]sec-pw-(?:bars|hint)['"]/g)) callees.add(m[1]);
  }
  for (const lookup of ['el', 'qi', 'getElementById', 'querySelector', 'inpById']) callees.delete(lookup);
  assert.ok(callees.has('wirePasswordStrength'), 'the strength meter is no longer wired by id');
  for (const name of callees) {
    for (const [f, js] of sources) {
      const start = js.search(new RegExp(`function ${name}\\(`));
      if (start < 0) continue;
      const moves = [...blockFrom(js, start).matchAll(MOVE)].map(m => m[0]);
      assert.deepEqual(moves, [], `${f}: ${name} moves what it is handed`);
    }
  }
});
