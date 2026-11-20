import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Two faults in the app editor's icon preview, both invisible until an icon is
   actually chosen, because the markup rendered when the form opens is correct
   and only the redraw was wrong.

   The tile is 34px and the app list's tile is 48px. The redraw carried the
   list's 30px image size as an inline style, which in the smaller tile filled
   it edge to edge and lost the inset every other icon on the dashboard has.

   The redraw also runs per keystroke, so several images load at once and the
   half-typed names fail last. Each failed attempt reset the tile to the letter
   placeholder, including attempts belonging to a name already typed past, so a
   name like "adguard home" never appeared until the value had been saved and
   redrawn once on its own.

   The redraw itself is tested in icon-picker.test.mjs. */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/admin.css');

test('the preview image is sized by the stylesheet, not by a fixed pixel value', () => {
  assert.match(css, /\.icon-prev img\{width:62%;height:62%/, 'the proportional rule is gone');
});
