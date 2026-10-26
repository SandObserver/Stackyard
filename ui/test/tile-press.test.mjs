/* Every tile presses the same way on touch-down: the desktop app tile, the
   desktop folder, and the phone app, Dock and folder tiles. Source-shape tests:
   :active needs a real pointer. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/dashboard.css');
const dashboard = read('js/dashboard.js');

const TILES = [
  '.icon:active .iwrap',
  '.icon:active .dyn-folder-box',
  '.dyn-mob-icon:active > .plate',
  '.dyn-dock-icon:active > .plate',
  '.dyn-mob-btn:active > .dyn-box',
  '.dyn-fold-anchor:active > .plate',
];

test('every tile shares the desktop press', () => {
  const rule = css.match(/\.icon:active \.iwrap,[^{]*\{[^}]*\}/)?.[0] ?? '';
  for (const sel of TILES) assert.ok(rule.includes(sel), `${sel} does not press`);
  assert.match(rule, /transform:scale\(\.92\); filter:brightness\(\.88\);/);
  assert.match(rule, /transition:transform \.1s ease-out, filter \.1s ease-out;/);
});

test('the desktop folder lifts on hover like an app tile', () => {
  const rule = css.match(/@media \(hover:hover\) \{\s*\.icon:hover \.iwrap,[^}]*\}/)?.[0] ?? '';
  assert.ok(rule.includes('.icon:hover .dyn-folder-box'));
  assert.match(rule, /transform:scale\(1\.03\)/);
});

/* Keep. Without it Safari leaves the tile scaled after a new tab opens. */
test('a phone tile that opens a new tab resets its press', () => {
  for (const cls of ['dyn-mob-icon', 'dyn-dock-icon', 'dyn-fold-anchor']) {
    assert.match(css, new RegExp(`\\.${cls}\\.settled > \\.plate`), `${cls} has no .settled reset`);
    assert.match(dashboard, new RegExp(`a\\[target="_blank"\\]:is\\([^)]*\\.${cls}`), `${cls} is never settled`);
  }
});

test('a drag that starts on a tile is not a press', () => {
  assert.match(css, /\.dragging :is\(\.plate, \.dyn-box, \.dyn-folder-box\) \{ transform:none; filter:none \}/);
  const press = css.indexOf('.icon:active .iwrap,');
  assert.ok(css.indexOf('.dragging :is(') > press, 'the drag rule must come after the press it cancels');
});

test('a long press on a phone tile shows no link preview', () => {
  for (const cls of ['dyn-mob-icon', 'dyn-dock-icon']) {
    assert.match(css, new RegExp(`\\.${cls}\\s+\\{[^}]*-webkit-touch-callout:none`), cls);
  }
});

test('reduced motion drops the scale on every tile', () => {
  const block = css.slice(css.indexOf('/* Reduced motion: neutralize'));
  for (const sel of [
    '.icon .dyn-folder-box',
    '.dyn-mob-icon > .plate',
    '.dyn-dock-icon > .plate',
    '.dyn-mob-btn > .dyn-box',
  ]) {
    assert.ok(block.slice(0, 800).includes(sel), sel);
  }
});
