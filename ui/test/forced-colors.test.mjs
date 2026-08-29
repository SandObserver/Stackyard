/* Regression tests for W-04: forced colors was entirely unhandled.

   Windows High Contrast replaces declared colours with the user's palette, but
   it does not remove background images or backdrop-filter. So the wallpaper and
   the glass survived while everything over them was flattened: the active page
   dot measured 1.00:1 against an inactive one, and a red "needs attention"
   badge became a bare exclamation mark with no fill and no shape.

   The mode cannot be emulated in a stylesheet parser, so these read the rules.
   The runtime half belongs to harness item H-2. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'css');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

const tokens = read('tokens.css');
const dashboard = read('dashboard.css');

/** The body of every `@media (forced-colors: active)` block in a file. */
function forcedBlocks(css) {
  const out = [];
  let at = 0;
  for (;;) {
    const start = css.indexOf('@media (forced-colors: active)', at);
    if (start === -1) return out;
    let depth = 0,
      i = css.indexOf('{', start);
    const from = i;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) break;
    }
    out.push(css.slice(from + 1, i));
    at = i;
  }
}

const shared = forcedBlocks(tokens).join('\n');
const dash = forcedBlocks(dashboard).join('\n');

test('the mode is handled at all', () => {
  assert.ok(shared.length, 'tokens.css has no forced-colors block');
  assert.ok(dash.length, 'dashboard.css has no forced-colors block');
});

/* Both pages paint the wallpaper from tokens.css, so suppressing it there is
   what covers the admin page too. */
test('the wallpaper is suppressed for both pages', () => {
  assert.match(shared, /html::before\s*\{[^}]*background-image:\s*none/);
  assert.match(shared, /html::before\s*\{[^}]*background-color:\s*Canvas/);
});

/* A named list of blurred surfaces goes stale. dashboard.css alone sets
   backdrop-filter in more than twenty places. */
test('every blurred surface loses its blur, including ones added later', () => {
  assert.match(shared, /\*,\s*\*::before,\s*\*::after/, 'the blur override is not universal');
  assert.match(shared, /backdrop-filter:\s*none\s*!important/);
  assert.match(shared, /-webkit-backdrop-filter:\s*none\s*!important/);
});

/* The failure that made this critical: both dots painted the same colour. */
test('the current page is marked by shape, not only by fill', () => {
  assert.match(dash, /\.dot\s*\{[^}]*border:\s*1px solid CanvasText/, 'an inactive dot has no outline');
  assert.match(dash, /\.dot\.on\s*\{[^}]*background:\s*Highlight/, 'the active dot does not use the system highlight');
});

/* Status is information the system palette cannot express, which is the only
   thing that justifies opting out. */
test('the badge keeps its status colour, and keeps its shape', () => {
  assert.match(dash, /\.badge\s*\{[^}]*forced-color-adjust:\s*none/);
  assert.match(dash, /\.badge\s*\{[^}]*border:\s*1px solid CanvasText/, 'the pill loses its shape without a border');
});

/* Opting the whole page out would override a setting the user turned on. */
test('nothing outside the badge opts out of the mode', () => {
  const all = [tokens, dashboard, read('admin.css')].join('\n');
  const optOuts = [...all.matchAll(/([^{}]*)\{[^}]*forced-color-adjust:\s*none/g)].map(m =>
    m[1].trim().split('\n').pop().trim(),
  );
  assert.deepEqual(optOuts, ['.badge'], `unexpected opt-outs: ${optOuts.join(', ')}`);
});

/* System colour keywords only. A literal here would be replaced anyway, and
   would read as though it were doing something. */
test('the blocks use system colours, not literals', () => {
  for (const [name, block] of [
    ['tokens.css', shared],
    ['dashboard.css', dash],
  ]) {
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, `${name} declares a colour literal inside forced colors`);
    assert.doesNotMatch(block, /rgba?\(/, `${name} declares an rgb colour inside forced colors`);
  }
});
