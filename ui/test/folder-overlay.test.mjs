/* The mobile folder overlay.

   A badge sits outside its icon's top-right corner by design, so each page is
   inset by the overhang and clips itself. Pages laid flush in one strip render
   a right-column badge in the next page's space: trimmed while its own page is
   shown, and a sliver at the far edge after a swipe. The inset comes out of the
   box padding, so the icons do not move.

   The overlay takes focus itself. A focus trap falling back to the first
   focusable element lands on the first app link, and WebKit paints its own ring
   for a script-driven focus on an anchor.

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
  assert.match(overlay, /translateX\(\$\{-pageDir\(\) \* curPage \* pageW\}px\)/);
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

/* showModal focuses the first thing it can find, which is the first app in the
   folder. The overlay takes focus itself so a reader is told which folder
   opened before hearing its contents. */
test('the overlay takes focus itself, not the first app', () => {
  assert.match(overlay, /ov\.tabIndex = -1/);
  assert.match(overlay, /ov\.showModal\(\);\s*ov\.focus\(\)/);
});

test('the native focus ring cannot render on a folder app link', () => {
  assert.match(css, /\.folder-overlay-mobile:focus, \.dyn-fold-anchor:focus,/);
  assert.match(css, /\.folder-overlay:focus, \.folder-icon-link:focus \{ outline:none; \}/);
  for (const [reset, visible] of [
    ['.dyn-fold-anchor:focus,', '.dyn-fold-anchor:focus-visible'],
    ['.folder-icon-link:focus ', '.folder-icon-link:focus-visible'],
  ]) {
    assert.ok(
      css.indexOf(visible) > css.indexOf(reset),
      `${visible}: the accent ring must be declared after the reset or it never applies`,
    );
  }
});

/* Desktop WebKit paints the same ring as the phone. */
test('the desktop overlay takes focus itself too', () => {
  const desktop = ui.slice(ui.indexOf('export function openFolderDesktop('), ui.indexOf('function mFolder('));
  assert.match(desktop, /ov\.tabIndex = -1/);
  assert.match(desktop, /ov\.showModal\(\);\s*ov\.focus\(\)/);
});
