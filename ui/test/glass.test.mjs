import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

globalThis.document = { documentElement: { clientWidth: 400 } };
globalThis.innerHeight = 800;
const { wallpaperBox } = await import('../js/glass.js');

test('the wallpaper box matches a covering background', () => {
  assert.deepEqual(wallpaperBox(1600, 1600, 'cover'), [-200, 0, 800, 800]);
  assert.deepEqual(wallpaperBox(400, 200, 'cover'), [-600, 0, 1600, 800]);
});

test('the wallpaper box matches a contained background', () => {
  assert.deepEqual(wallpaperBox(1600, 1600, 'contain'), [0, 200, 400, 400]);
});

/* The GPU draws glass where CSS draws it. A selector in one list and not the
   other gives glass with no bend, or a bend with no glass. */
test('the GPU glass list and the CSS rim list name the same elements', () => {
  const js = read('js/glass.js');
  const list = /const GLASS =\s*'([^']+)'/.exec(js)?.[1];
  assert.ok(list, 'the glass list moved');
  const css = read('css/dashboard.css');
  const rim = /(\.glass-surface::before,[^{]+)\{/.exec(css)?.[1] ?? '';
  const fromCss = rim
    .split(',')
    .map(s => s.trim().replace(/::before$/, ''))
    .filter(Boolean)
    .sort();
  assert.deepEqual(
    list
      .split(',')
      .map(s => s.trim())
      .sort(),
    fromCss,
  );
});

test('the GPU layer stays out of reach of the pointer and of assistive tech', () => {
  const js = read('js/glass.js');
  assert.match(js, /canvas\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(read('css/dashboard.css'), /\.glass-canvas, \.glass-folder-canvas \{[^}]*pointer-events:none/);
});

test('a lost GPU context is rebuilt with its last picture', () => {
  const js = read('js/glass.js');
  assert.match(js, /'webglcontextlost', e => \{\s*e\.preventDefault\(\);/);
  assert.match(
    js,
    /'webglcontextrestored'[\s\S]{0,400}if \(layer\.last\) layer\.gl\?\.draw\(layer\.last\.items, layer\.last\.look\);/,
  );
});

test('reduce transparency and forced colours leave the glass to CSS', () => {
  const js = read('js/glass.js');
  assert.match(js, /dataset\.transparency === 'reduce' \|\| !!forcedColors\?\.matches/);
  assert.match(js, /if \(img && !blocked\(\)\)/);
  assert.match(js, /attributeFilter: \['data-transparency'\]/);
});
