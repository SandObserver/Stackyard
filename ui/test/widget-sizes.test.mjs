/* The grid span classes are built as `c${cols}` and `r${rows}` from the tables
   in widget-types.js, so none of these names appears literally in any source
   file. A scan for unreferenced CSS reported .c2 as dead and it was deleted;
   every medium, large and extra-large widget then rendered one column wide.

   This pairs the tables with the stylesheet, so a rule cannot be removed while
   a size still asks for it. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'css/dashboard.css'), 'utf8');
const { WIDGET_COLS, WIDGET_ROWS } = await import('../js/widget-types.js');

const declares = selector => new RegExp(`\\${selector}\\s*\\{`).test(css);

/* Only the desktop grid uses these classes. A mobile widget is placed by
   absolute coordinates, so its table maps to no stylesheet rule. */
test('every column span a widget size can ask for is styled', () => {
  const missing = [];
  for (const [size, cols] of Object.entries(WIDGET_COLS.desktop)) {
    if (!declares(`.c${cols}`)) missing.push(`${size} wants .c${cols}`);
  }
  assert.deepEqual(missing, [], `a widget would render at the wrong width:\n  ${missing.join('\n  ')}`);
});

test('every row span a widget size can ask for is styled', () => {
  const missing = [];
  for (const [size, rows] of Object.entries(WIDGET_ROWS.desktop)) {
    /* 0 means the size does not span rows, and 1 is the default. */
    if (rows > 1 && !declares(`.r${rows}`)) missing.push(`${size} wants .r${rows}`);
  }
  assert.deepEqual(missing, [], `a widget would render at the wrong height:\n  ${missing.join('\n  ')}`);
});
