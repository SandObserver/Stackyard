/* An app with no icon shows its first letter on the colour the user picked, so
   the ink is computed. Hardcoded white fails 1.4.3 on seven of the eight
   swatches the picker offers, and the picker's free colour wheel means a list
   of exceptions cannot close it. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
const { relativeLuminance, contrastRatio, toneForLuminances } = await import('../js/label-contrast.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const AA = 4.5;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

/* Read them from the control rather than restating them, so a swatch added
   there is measured here without anyone remembering to. */
function swatches() {
  const src = read('js/admin-color-control.js');
  const out = new Set();
  for (const m of src.matchAll(/'(#[0-9a-fA-F]{6})'/g)) out.add(m[1].toLowerCase());
  assert.ok(out.size >= 8, 'the swatch lists could not be read');
  return [...out];
}

/* The two inks the renderer chooses between. */
function inks() {
  const tokens = read('css/tokens.css');
  const light = tokens.match(/--on-tint:\s*(#[0-9A-Fa-f]{6})/);
  const dark = tokens.match(/--on-tint-dark:\s*(#[0-9A-Fa-f]{6})/);
  assert.ok(light && dark, 'the ink pair is not declared');
  return { light: hex(light[1]), dark: hex(dark[1]) };
}

const lumOf = rgb => relativeLuminance(rgb[0], rgb[1], rgb[2]);

test('every colour the picker offers carries a readable initial', () => {
  const { light, dark } = inks();
  for (const swatch of swatches()) {
    const plate = lumOf(hex(swatch));
    const tone = toneForLuminances([plate]);
    const ink = tone === 'dark' ? dark : light;
    const r = contrastRatio(lumOf(ink), plate);
    assert.ok(r >= AA, `${swatch} with ${tone} ink measures ${r.toFixed(2)}:1`);
  }
});

/* The wheel makes any hex reachable, so the rule has to hold for colours nobody
   listed. */
test('the rule holds across the whole colour space, not just the swatches', () => {
  const { light, dark } = inks();
  let worst = { r: Infinity, hex: null };
  for (let r8 = 0; r8 <= 255; r8 += 51)
    for (let g8 = 0; g8 <= 255; g8 += 51)
      for (let b8 = 0; b8 <= 255; b8 += 51) {
        const plate = relativeLuminance(r8, g8, b8);
        const ink = toneForLuminances([plate]) === 'dark' ? dark : light;
        const r = contrastRatio(lumOf(ink), plate);
        if (r < worst.r) worst = { r, hex: [r8, g8, b8].join(',') };
      }
  assert.ok(worst.r >= AA, `rgb(${worst.hex}) measures ${worst.r.toFixed(2)}:1`);
});

/* White alone is the defect, so a revert to it is reported here. */
test('a single fixed ink cannot pass, which is why the pair exists', () => {
  const { light } = inks();
  const failures = swatches().filter(s => contrastRatio(lumOf(light), lumOf(hex(s))) < AA);
  assert.ok(failures.length >= 5, 'white ink used to fail most of the palette; the premise has changed');
});

test('the ink pair is opaque', () => {
  const tokens = read('css/tokens.css');
  for (const name of ['--on-tint', '--on-tint-dark']) {
    const m = tokens.match(new RegExp(`${name}:\\s*([^;]+);`));
    assert.ok(m, `${name} is not declared`);
    assert.doesNotMatch(m[1], /rgba|hsla|\/\s*[\d.]+/, `${name} carries alpha, which breaks the guarantee`);
  }
});

test('the renderer measures the plate instead of assuming it', () => {
  const utils = read('js/utils.js');
  assert.match(utils, /toneForColor\(/, 'the initial does not read its plate');
  const css = read('css/dashboard.css');
  assert.doesNotMatch(css, /\.fb[^{]*\{[^}]*color:rgba\(255,255,255,\.85\)/, 'the translucent white ink is back');
  assert.match(css, /\.fb\.fb-on-light\s*\{\s*color:var\(--on-tint-dark\)/);
});

/* One implementation. A second copy of the tone rule drifts from this one. */
/* The folder preview draws the same initial on the same user colour. */
test('the folder preview initial is measured too', () => {
  const css = read('css/dashboard.css');
  assert.doesNotMatch(css, /\.folder-mini-fb\s*\{[^}]*rgba\(255,255,255,\.85\)/, 'the translucent white ink is back');
  assert.match(css, /\.folder-mini-fb\.fb-on-light\s*\{\s*color:var\(--on-tint-dark\)/);
  assert.match(read('js/ui.js'), /toneForColor\(plate\)/, 'the folder preview does not read its plate');
});

test('the tone rule is not duplicated', () => {
  const dashboard = read('js/dashboard.js');
  assert.doesNotMatch(dashboard, /function toneForColor\(/, 'dashboard.js declares its own copy');
  assert.match(dashboard, /toneForColor/, 'dashboard.js should use the shared one');
});
