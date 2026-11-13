/* A slot's value and chart take that slot's colour, whatever its type and
   however many slots there are. A colour from config can arrive by import, so
   it is validated before it reaches a style. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location ??= { search: '' };
const { colorOrFallback } = await import('../js/widget-toolbox.js');

const src = fs.readFileSync(new URL('../widgets/system-summary/index.html', import.meta.url), 'utf8');

const fn = src.match(/function slotColour\(slot, i\) \{[\s\S]*?\n\}/);
assert.ok(fn, 'slotColour is defined in the widget');
const defs = src.match(/const SLOT_DEFS = (\[[^\]]*\]);/);
assert.ok(defs, 'SLOT_DEFS is defined in the widget');

const slotColour = new Function('colorOrFallback', `const SLOT_DEFS = ${defs[1]}; ${fn[0]}; return slotColour;`)(
  colorOrFallback,
);

test('a slot with no colour takes the default for its own position', () => {
  assert.equal(slotColour({ type: 'cpu' }, 0), '#FF375F');
  assert.equal(slotColour({ type: 'procs' }, 1), '#30D158');
  assert.equal(slotColour({ type: 'disk' }, 2), '#00D2E0');
});

test('a chosen colour is kept exactly as picked', () => {
  assert.equal(slotColour({ color: '#0091FF' }, 2), '#0091FF');
  assert.equal(slotColour({ color: '#abc' }, 0), '#abc');
  assert.equal(slotColour({ color: 'rgb(255, 255, 255)' }, 0), 'rgb(255, 255, 255)');
});

test('a colour carrying a second declaration falls back', () => {
  assert.equal(slotColour({ color: 'red; background-image: url(x)' }, 1), '#30D158');
});

test('the value, the chart and the bars all take the row colour', () => {
  assert.match(src, /const colour = slotColour\(slot, i\);/);
  assert.match(src, /columns\(\{ count: COLS, color: colour, track: null \}\)/);
  assert.equal(src.match(/barFill\(0, \{[^}]*color: colour \}\)/g)?.length, 2, 'both disk bars');
  assert.match(src, /setProperty\('--ink', contrastInk\(r\.colour, 4\.5\)\)/);
  assert.doesNotMatch(src, /setColor\(|backgroundColor = fill/, 'a fill must keep the colour the user picked');
  assert.match(src, /classList\.toggle\('faint', cardContrast\(r\.colour\) < 1\.5\)/);
});
