/* Placeholders are styled by a bare element default, not one selector at a
   time. A field nobody remembered falls back to the user agent's grey, which
   assumes a light page and fails 1.4.3 on these surfaces.

   The contrast gate cannot see this: it measures declarations, and the defect
   is an absence. These tests read the absence instead. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const admin = read('css/admin.css');
const dashboard = read('css/dashboard.css');

/* A bare element default is what makes the set closed: a field added later is
   covered before anyone thinks about it. */
const DEFAULT = /(^|[\s,{}])input::placeholder/m;

test('each stylesheet declares a default placeholder colour', () => {
  for (const [name, css] of [
    ['admin.css', admin],
    ['dashboard.css', dashboard],
  ]) {
    assert.match(css, DEFAULT, `${name} has no input::placeholder default`);
  }
});

test('the default resolves to a colour, not to nothing', () => {
  for (const [name, css] of [
    ['admin.css', admin],
    ['dashboard.css', dashboard],
  ]) {
    const rule = css.slice(css.search(DEFAULT));
    const decl = rule.slice(0, rule.indexOf('}'));
    assert.match(decl, /color:\s*\S+/, `${name}'s default declares no colour`);
  }
});

/* Every field that shows a placeholder, whether or not it has a rule of its
   own. */
test('every placeholder in the markup is covered', () => {
  const markup = read('admin/index.html') + read('index.html');
  const fields = [...markup.matchAll(/<input\b[^>]*placeholder=/g)];
  assert.ok(fields.length >= 4, 'expected the known placeholder fields');
  for (const [, css] of [
    ['admin.css', admin],
    ['dashboard.css', dashboard],
  ]) {
    assert.match(css, DEFAULT);
  }
});

/* ── The dashboard default has to survive being composited ───────────────── */

const over = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const luminance = c => {
  const s = c.map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
};
const ratio = (a, b) => {
  const l1 = luminance(a),
    l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/** rgba(r,g,b,a) out of a declared block. */
function rgba(css, selector) {
  const at = css.indexOf(selector);
  assert.ok(at > -1, `${selector} is not declared`);
  const block = css.slice(at, css.indexOf('}', at));
  const m = block.match(/background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  assert.ok(m, `${selector} declares no rgba background`);
  return { rgb: [+m[1], +m[2], +m[3]], a: +m[4] };
}

/* The dialog is three translucent layers over a wallpaper the project does not
   control, so the ink has to clear the threshold at both extremes of one. */
test('the first-run password placeholder clears 4.5:1 over any wallpaper', () => {
  const card = rgba(dashboard, '.setup-card {');
  const field = rgba(dashboard, '.setup-pw {');
  const rule = dashboard.slice(dashboard.search(DEFAULT));
  const ink = rule.slice(0, rule.indexOf('}')).match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/);
  assert.ok(ink, 'the dashboard default is not an rgba the compositor can read');
  const inkRgb = [+ink[1], +ink[2], +ink[3]];
  const inkA = +ink[4];

  for (const wallpaper of [
    [255, 255, 255],
    [0, 0, 0],
  ]) {
    let fill = over([0, 0, 0], 0.5, wallpaper); /* .setup-overlay */
    fill = over(card.rgb, card.a, fill);
    fill = over(field.rgb, field.a, fill);
    const text = over(inkRgb, inkA, fill);
    const r = ratio(text, fill);
    assert.ok(r >= 4.5, `over rgb(${wallpaper}) the placeholder measures ${r.toFixed(2)}:1`);
  }
});

/* The spotlight keeps its own rule, and it is below the threshold. Pinning it
   here stops the default being "fixed" to match it. */
test('the spotlight rule still overrides the default', () => {
  assert.match(dashboard, /#sin::placeholder/);
  assert.ok(
    dashboard.search(DEFAULT) < dashboard.indexOf('#sin::placeholder'),
    'the default must come first, or specificity is doing the work by accident',
  );
});
