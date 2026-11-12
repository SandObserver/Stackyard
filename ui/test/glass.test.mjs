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
  assert.match(js, /if \(img && !blocked\(\) && base\?\.gl\)/);
  assert.match(js, /attributeFilter: \['data-transparency'\]/);
});

test('the wallpaper bitmap never exceeds the GPU texture limit', async () => {
  const { bitmapSize } = await import('../js/glass.js');
  assert.deepEqual(bitmapSize(6000, 1000, 5064, 4096), [4096, 683]);
  assert.deepEqual(bitmapSize(6000, 8000, 3840, 4096), [3072, 4096]);
  assert.deepEqual(bitmapSize(1000, 800, 1600, 4096), [1000, 800], 'a small picture is not enlarged');
  assert.deepEqual(bitmapSize(3000, 2000, 1500, 4096), [1500, 1000], 'a large picture shrinks to its shown width');
});

/** A WebGL2 stand-in: every call succeeds, and texImage2D reports the error given. */
function fakeGl(uploadError = 0) {
  let pending = 0;
  const constants = { NO_ERROR: 0, INVALID_VALUE: 0x501, MAX_TEXTURE_SIZE: 0xd33 };
  return new Proxy(constants, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'getParameter') return () => 4096;
      if (key === 'getError') return () => [pending, (pending = 0)][0];
      if (key === 'texImage2D') return () => (pending = uploadError);
      if (key === 'getProgramParameter') return (_p, what) => (what === undefined ? 0 : true);
      if (key === 'getShaderParameter') return () => true;
      if (key === 'getActiveUniform') return () => null;
      return () => ({});
    },
  });
}

test('the renderer refuses a picture the GPU cannot take, so the glass stays CSS', async () => {
  const { createGlassRenderer } = await import('../js/glass-gpu.js');
  const canvas = gl => /** @type {any} */ ({ getContext: () => gl });
  const ok = createGlassRenderer(canvas(fakeGl()));
  assert.ok(ok);
  assert.equal(ok.maxSize, 4096);
  assert.equal(ok.setWallpaper(/** @type {any} */ ({ width: 4096, height: 683 }), [0, 0, 1, 1], 0), true);
  assert.equal(ok.setWallpaper(/** @type {any} */ ({ width: 5064, height: 844 }), [0, 0, 1, 1], 0), false);
  assert.equal(ok.setWallpaper(null, [0, 0, 1, 1], 0), true);
  const refused = createGlassRenderer(canvas(fakeGl(0x501)));
  assert.equal(refused?.setWallpaper(/** @type {any} */ ({ width: 100, height: 100 }), [0, 0, 1, 1], 0), false);
});

test('a folder panel drops its CSS fill only while its glass is drawn', () => {
  const css = read('css/dashboard.css');
  const js = read('js/glass.js');
  assert.match(
    css,
    /:is\(\.folder-overlay, \.folder-overlay-mobile\)\[data-glass-drawn\] \.glass-surface \{ background:transparent \}/,
  );
  assert.doesNotMatch(css, /html\[data-glass-live\] :is\(\.folder-overlay/);
  assert.match(js, /ov\.setAttribute\(DRAWN, ''\)/);
  assert.match(
    js,
    /'webglcontextlost'[\s\S]{0,400}layer\.last = null;\s*canvas\.hidden = true;\s*if \(panel\) \{\s*panel\.ov\.removeAttribute\(DRAWN\);/,
  );
  assert.match(js, /if \(!folder\?\.gl \|\| !wallpaper\) return;/);
  assert.doesNotMatch(js, /\bwaiting\b/, 'an open folder never swaps its fill for the glass mid-view');
});

test('glass elements removed from the page are forgotten without a wallpaper', () => {
  const js = read('js/glass.js');
  assert.match(js, /removed \|\|= r\.removedNodes\.length > 0;/);
  assert.match(js, /if \(removed\) forgetRemoved\(\);/);
});

test('a translucent card turns solid under reduced transparency', () => {
  assert.match(
    read('css/dashboard.css'),
    /html\[data-transparency="reduce"\] :is\(\.widget, \.mob-widget-card\)\[data-card="translucent"\] \{\s*background:var\(--glass-card-solid\); -webkit-backdrop-filter:none; backdrop-filter:none;/,
  );
});
