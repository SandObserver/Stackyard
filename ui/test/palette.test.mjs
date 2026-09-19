import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { HUE_NAMES, paletteColor, tileColor } from '../js/palette.js';

const tokens = readFileSync(fileURLToPath(new URL('../css/tokens.css', import.meta.url)), 'utf8');
const block = sel => tokens.slice(tokens.indexOf(sel)).split('}')[0];
const token = (css, name) => new RegExp(`--sy-${name}:(#[0-9A-F]{6})`, 'i').exec(css)?.[1].toUpperCase();

test('every hue matches its tokens.css value in both themes', () => {
  const dark = block(':root {\n  --sy-red');
  const light = block('html[data-theme="light"] {');
  for (const name of HUE_NAMES) {
    assert.equal(paletteColor(name, 'dark'), token(dark, name), `dark ${name}`);
    assert.equal(paletteColor(name, 'light'), token(light, name), `light ${name}`);
  }
});

test('roles follow the tokens.css role mapping', () => {
  assert.equal(paletteColor('danger', 'dark'), paletteColor('red', 'dark'));
  assert.equal(paletteColor('info', 'dark'), paletteColor('blue', 'dark'));
  assert.equal(paletteColor('danger', 'light'), token(block('html[data-theme="light"] {'), 'red-hi'));
});

test('auto follows the theme and the fixed keywords do not', () => {
  assert.notEqual(tileColor('auto', 'dark'), tileColor('auto', 'light'));
  assert.equal(tileColor('dark', 'dark'), tileColor('dark', 'light'));
  assert.equal(tileColor('light', 'dark'), tileColor('light', 'light'));
});

test('unknown names resolve to nothing', () => {
  assert.equal(paletteColor('chartreuse', 'dark'), '');
  assert.equal(tileColor(42, 'light'), '');
});
