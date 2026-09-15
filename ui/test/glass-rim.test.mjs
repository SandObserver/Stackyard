import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('every dock and folder surface shares one edge', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /observeGlass\(dk, Math\.round\(40 \* sc\), 0\.2\)/);
  assert.match(ui, /mkGlassRim\(boxW, boxH, boxD\)/);
  assert.match(ui, /mkGlassRim\(eff, eff,/);
  assert.match(ui, /mkGlassRim\(iw, iw,/);
  assert.match(ui, /observeGlass\(box, 28, 0\.2\)/);
  assert.match(read('js/dashboard.js'), /observeGlass\(dk, 45, 0\.2\)/);
});

test('the open phone folder is clipped to the rim path', () => {
  assert.match(read('js/ui.js'), /box\.style\.clipPath = `path\('\$\{boxD\}'\)`/);
});

test('no dock or folder surface carries a gloss band', () => {
  const ui = read('js/ui.js');
  const css = read('css/dashboard.css');
  assert.doesNotMatch(ui, /dyn-fold-sheen|mdock-sheen|folder-icon-grid-sheen/);
  assert.doesNotMatch(css, /dyn-fold-sheen|mdock-sheen|--dock-sheen|folder-icon-grid-sheen/);
});

test('every surface uses one fill', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /box\.className = 'dyn-box-mob glass-surface'/);
  assert.match(ui, /wrap\.className = 'dyn-fold-wrap glass-surface'/);
  assert.match(ui, /wrap\.className = 'folder-icon-grid glass-surface'/);
  assert.match(read('js/glass-rim.js'), /layer\.className = 'glass-layer glass-surface'/);
});
