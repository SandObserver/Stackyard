/* Regression tests for the mobile folder overlay.

   Two defects, both in the overlay that opens when a folder is tapped on a
   phone.

   A badge sits outside its icon's top-right corner by design. The pages of a
   folder were laid out flush against each other in one strip, each page exactly
   as wide as three icons and two gaps, and one viewport clipped the strip. A
   badge on the right-hand column therefore rendered in the next page's space:
   trimmed while its own page was shown, and visible as a sliver at the left
   edge after a swipe. The top row lost the same 7px upwards.

   The fix insets each page by the overhang and lets the page clip itself, so a
   badge stays inside the page it belongs to. The inset comes out of the box
   padding, so the icons do not move.

   The second defect: the overlay trapped focus without saying what to focus,
   the trap fell back to the first focusable element, and that is the first app
   link. iOS Safari paints its own focus ring for a script-driven focus on an
   anchor, which the stylesheet only styles for :focus-visible. Opening a folder
   also should not move focus onto an item nobody asked for.

   Source-shape tests: the geometry is written in JavaScript against a real
   layout, which is not available here. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const ui = read('js/ui.js');
const css = read('css/dashboard.css');

const overlay = ui.slice(ui.indexOf('export function openFolderMobile('), ui.indexOf('export function buildMobile('));
assert.ok(overlay.length > 0, 'openFolderMobile was renamed or moved');

test('the page is inset by the badge overhang', () => {
  assert.match(
    overlay,
    /badgeOvh = Math\.min\(Math\.ceil\(7 \* \(sc \|\| 1\)\)/,
    'the inset must follow the badge scale',
  );
  assert.match(overlay, /pageW = gridInnerW \+ badgeOvh \* 2/);
  assert.match(overlay, /pageH = gridH \+ badgeOvh \* 2/);
});

test('the inset comes out of the box padding, so the icons keep their place', () => {
  assert.match(overlay, /'--pt': padVT - badgeOvh/);
  assert.match(overlay, /'--ph': padH - badgeOvh/);
  assert.match(overlay, /'--pb': padVB - badgeOvh/);
});

test('the inset never exceeds the padding it is taken from', () => {
  assert.match(overlay, /Math\.min\(Math\.ceil\(7 \* \(sc \|\| 1\)\), padH, padVT, padVB\)/);
});

test('the icon grid itself is unchanged', () => {
  assert.match(overlay, /folderIconW = Math\.min\(Math\.floor\(\(innerW - gap \* 2\) \/ 3\), isz\)/);
  assert.match(css, /\.dyn-page-grid\s*{[^}]*grid-template-columns:repeat\(3,var\(--fiw\)\)/);
});

test('the strip is measured and moved in padded pages', () => {
  assert.match(overlay, /width: pages\.length \* pageW \+ 'px'/);
  assert.match(overlay, /translateX\(-\$\{curPage \* pageW\}px\)/);
  assert.doesNotMatch(overlay, /curPage \* gridInnerW/, 'a page step shorter than the page leaves the seam visible');
});

test('the viewport is one padded page', () => {
  assert.match(overlay, /css\(clipW, \{ '--gw': pageW \+ 'px', '--gh': pageH \+ 'px' \}\)/);
});

test('a page clips its own overflow', () => {
  const rule = css.match(/\.dyn-page-grid\s*{[^}]*}/);
  assert.ok(rule, '.dyn-page-grid rule not found');
  assert.match(rule[0], /overflow:hidden/, 'without this the badge crosses into the next page');
  assert.match(rule[0], /padding:var\(--ovh,0\)/);
  assert.match(overlay, /'--ovh': badgeOvh \+ 'px'/);
});

test('the overlay takes focus itself, not the first app', () => {
  assert.match(overlay, /ov\.tabIndex = -1/);
  assert.match(overlay, /trapFocus\(ov, \{ onClose: closeMob, initialFocus: ov \}\)/);
  assert.doesNotMatch(overlay, /trapFocus\(ov, \{ onClose: closeMob \}\)/);
});

test('the native focus ring cannot render on a folder app link', () => {
  assert.match(css, /\.folder-overlay-mobile:focus, \.dyn-fold-anchor:focus \{ outline:none; \}/);
  const reset = css.indexOf('.dyn-fold-anchor:focus {');
  const visible = css.indexOf('.dyn-fold-anchor:focus-visible');
  assert.ok(visible > reset, 'the accent ring must be declared after the reset or it never applies');
});
