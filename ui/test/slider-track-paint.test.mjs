/* A range slider is 44px tall on a phone for touch, and the painted track is
   kept thin by clipping the background to the content box. Assigning the
   `background` shorthand from JS resets background-clip, so the gradient fills
   the whole hit area and the track reads as a fat bar. It looks correct on
   desktop, where the rule does not apply. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const jsFiles = fs
  .readdirSync(path.join(root, 'js'))
  .filter(f => f.endsWith('.js'))
  .map(f => ['js/' + f, read('js/' + f)]);

test('no gradient is painted through the background shorthand', () => {
  const offenders = [];
  for (const [name, src] of jsFiles) {
    for (const m of src.matchAll(/style\.background\s*=\s*[`'"]\s*(?:linear|radial|conic)-gradient/g)) {
      offenders.push(`${name}: ${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(offenders, [], 'use style.backgroundImage; the shorthand resets background-clip');
});

test('every slider gradient takes its direction from --slider-dir', () => {
  const offenders = [];
  const sources = [...jsFiles, ['css/admin.css', read('css/admin.css')]];
  for (const [name, src] of sources) {
    for (const m of src.matchAll(/linear-gradient\(\s*(to\s+[a-z]+|-?[\d.]+deg)/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      const context = src.slice(Math.max(0, m.index - 200), m.index);
      if (/adm-range|hsb-range|hsb-hue|sEl\.style|vEl\.style|el\.style/.test(context)) {
        offenders.push(`${name}:${line} uses ${m[1]}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'a fixed direction leaves the fill running against the handle in RTL');
});

test('--slider-dir reverses under RTL', () => {
  const css = read('css/admin.css');
  assert.match(css, /--slider-dir:\s*90deg/, '--slider-dir has no left-to-right default');
  assert.match(css, /\[dir="rtl"\][^{]*\{[^}]*--slider-dir:\s*270deg/, '--slider-dir is not reversed for RTL');
});

test('the touch-sized sliders still clip their track', () => {
  const css = read('css/admin.css');
  for (const cls of ['.adm-range', '.hsb-range']) {
    const rule = new RegExp(`\\${cls}\\s*\\{[^}]*background-clip:\\s*content-box`);
    assert.match(css, rule, `${cls} no longer clips its track, so the JS fix protects nothing`);
  }
});
