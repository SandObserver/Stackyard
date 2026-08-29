/* A glyph per widget type in the Settings item list.

   The row already names the widget and its size in words, so the icon column
   was saying the size a second time. A type glyph says something the row does
   not, in a column that is scanned rather than read.

   The glyphs are inline SVG rather than a file each: they are stroked with
   currentColor, so they follow the theme and the increased-contrast block with
   no rule of their own, which an <img> cannot do. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
const { widgetGlyph, GLYPH_NAMES } = await import('../js/widget-glyphs.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const widgets = fs
  .readdirSync(path.join(root, 'widgets'), { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name);

test('every widget declares a glyph, and it is one that exists', () => {
  for (const w of widgets) {
    const m = JSON.parse(read(`widgets/${w}/widget.json`));
    assert.ok(m.glyph, `${w} declares no glyph`);
    assert.ok(GLYPH_NAMES.includes(m.glyph), `${w} names "${m.glyph}", which is not a glyph`);
  }
});

/* Two widgets sharing a glyph would put the list back where it started. */
test('no two widgets share a glyph', () => {
  const used = widgets.map(w => JSON.parse(read(`widgets/${w}/widget.json`)).glyph);
  assert.equal(new Set(used).size, used.length, `duplicated: ${used.join(', ')}`);
});

test('a glyph is drawn on the same grid and weight as the other icons', () => {
  for (const name of GLYPH_NAMES) {
    const svg = widgetGlyph(name);
    assert.match(svg, /viewBox="0 0 24 24"/, `${name} is not on the 24-unit grid`);
    assert.match(svg, /stroke="currentColor"/, `${name} will not follow the theme`);
    assert.match(svg, /stroke-width="1.6"/, `${name} does not carry the shared weight`);
    assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,6}|rgba?\(/, `${name} hardcodes a colour`);
  }
});

/* A widget that names no glyph, or one that has been removed, must still draw
   something: the size icon it drew before. */
test('an unknown or missing glyph falls back rather than throwing', () => {
  for (const v of [undefined, null, '', 'not-a-glyph', 42, {}]) {
    assert.equal(widgetGlyph(/** @type {any} */ (v)), null);
  }
  const admin = read('js/admin.js');
  assert.match(
    admin,
    /glyph \|\| SIZE_ICONS\[item\.widgetSize\] \|\| SIZE_ICONS\.medium/,
    'no fallback to the size icon',
  );
});

test('the list draws the glyph from the widget registry', () => {
  const admin = read('js/admin.js');
  assert.match(admin, /widgetGlyph\(state\._widgetReg\?\.\[item\.widgetType\]\?\.glyph\)/);
});

/* The validator has its own copy of the names, because the API is CommonJS and
   this module is ESM. */
test('the manifest validator knows exactly the same glyphs', () => {
  const api = fs.readFileSync(path.join(root, '..', 'api/src/widgets.js'), 'utf8');
  const block = api.slice(api.indexOf('const VALID_GLYPHS'), api.indexOf(']);', api.indexOf('const VALID_GLYPHS')));
  const declared = [...block.matchAll(/'([\w-]+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(declared, [...GLYPH_NAMES].sort(), 'the two lists have drifted');
});

/* The stamp is written by the release build and must never be committed. */
test('no manifest carries a build stamp', () => {
  for (const w of widgets) {
    assert.equal(JSON.parse(read(`widgets/${w}/widget.json`)).entryVersions, undefined, `${w} carries entryVersions`);
  }
});

/* The list reads the glyph from the widget registry, which is built from what
   the API sends. A manifest field the endpoint does not forward never arrives,
   and the list quietly falls back to the size icon. */
test('the widgets endpoint forwards the glyph', () => {
  const api = fs.readFileSync(path.join(root, '..', 'api/src/widgets.js'), 'utf8');
  const entry = api.slice(api.indexOf('label: m.label'), api.indexOf('entryVersions: m.entryVersions'));
  assert.match(entry, /glyph: m\.glyph/, 'the glyph never reaches the browser');
});
