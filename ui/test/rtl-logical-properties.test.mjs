/* Regression tests for P12-2: the layout did not follow the text direction.

   CSS has physical properties, where `margin-left` means the left of the screen
   whatever the language, and logical ones, where `margin-inline-start` means the
   start of the text: left in English, right in Persian.

   The stylesheets used physical properties, so nothing flipped for Persian, and
   a block of [dir="rtl"] rules undid them one by one. That block existed because
   the properties were physical, and its own comment said to refine it against
   real translated content. It could only ever cover what someone had noticed:
   any new rule with `margin-left` in it needed a matching entry, and forgetting
   meant Persian quietly looked wrong, invisibly to anyone working in English.

   Both stylesheets use logical properties now, and all but one override is gone.

   The exception is deliberate. A back chevron is a drawing, not a box, so no
   logical property expresses "point the other way"; it is mirrored explicitly. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const SHEETS = ['css/admin.css', 'css/dashboard.css', 'css/tokens.css', 'css/widget-config-form.css'];

/* Widget pages, whose CSS lives in a <style> block. They were out of scope when
   the pages were converted, and they set no direction of their own, so they
   stayed left-to-right in Persian whatever their properties said. The dashboard
   sets the frame's direction now, which is what makes converting them mean
   something. */
function widgetPages() {
  const out = [];
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) out.push(p);
    }
  };
  walk('widgets');
  return out;
}

/* Only the <style> blocks: the scripts below them mention left and right in
   contexts that have nothing to do with text. */
const widgetCss = file => [...read(file).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
  .map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

/* Comments are stripped, or a comment explaining this rule would trip it. */
const code = file => read(file).replace(/\/\*[\s\S]*?\*\//g, '');

/* ── no physical properties remain ────────────────────────────────────────── */

const PHYSICAL = [
  /margin-left\s*:/, /margin-right\s*:/,
  /padding-left\s*:/, /padding-right\s*:/,
  /border-left\s*:/, /border-right\s*:/,
  /text-align\s*:\s*(left|right)\b/,
  /text-align-last\s*:\s*(left|right)\b/,
];

test('no stylesheet positions anything by screen side', () => {
  for (const sheet of SHEETS) {
    const src = code(sheet);
    for (const pattern of PHYSICAL) {
      const m = pattern.exec(src);
      assert.equal(m, null, `${sheet} uses ${m && m[0]}, which does not flip for Persian`);
    }
  }
});

/* A widget's own CSS is held to the same rule, but only for the properties that
   sit next to text. `left: 0; right: 0` on an absolutely positioned box is
   symmetric and means the same in either direction, `left: 50%` with a
   translate is centring, and a book spine or a tape reel is a drawing rather
   than a line of text. Flipping those would be churn at best and would mirror
   artwork at worst. */
test('no widget page spaces text by screen side', () => {
  const offenders = [];
  for (const file of widgetPages()) {
    const src = widgetCss(file);
    for (const pattern of PHYSICAL) {
      const m = pattern.exec(src);
      if (m) offenders.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(offenders, [],
    `These do not flip for Persian. Use the inline-start/end form:\n  ${offenders.join('\n  ')}`);
});

/* The conversion above is inert unless something sets the direction, and a
   widget page is authored in English with no direction of its own. The
   dashboard sets it when it mounts the frame, so a widget folder needs no code
   of its own to follow the page. */
test('the dashboard gives each widget frame the page direction', () => {
  const utils = read('js/utils.js');
  assert.match(utils, /doc\.documentElement\.setAttribute\('dir'/,
    'nothing sets the direction inside a widget frame');
  assert.match(utils, /addEventListener\('load', applyDir\)/,
    'a reload replaces the document, so this has to run on every load');
});

test('no widget page hard-codes a direction of its own', () => {
  const offenders = widgetPages().filter(f => /<html[^>]*\sdir=/.test(read(f)));
  assert.deepEqual(offenders, [],
    `A widget follows the page direction; it must not pin its own:\n  ${offenders.join('\n  ')}`);
});

/* ── the overrides are gone ───────────────────────────────────────────────── */

test('the dashboard needs no direction overrides at all', () => {
  assert.doesNotMatch(code('css/dashboard.css'), /\[dir="rtl"\]/,
    'an override list can only cover what someone noticed');
});

/* Only the chevrons, which no logical property can express. */
test('admin keeps only the overrides that cannot be logical', () => {
  const overrides = [...code('css/admin.css').matchAll(/\[dir="rtl"\][^{]*\{[^}]*\}/g)].map(m => m[0]);
  assert.equal(overrides.length, 1, `expected only the chevron mirror, found:\n${overrides.join('\n')}`);
  assert.match(overrides[0], /transform:\s*scaleX\(-1\)/, 'a drawing has no logical property');
});

/* ── the logical replacements are actually there ──────────────────────────── */

test('the sidebar divider follows the text direction', () => {
  assert.match(code('css/admin.css'), /border-inline-end:1px solid var\(--bd-inner\)/);
});

test('row values align to the end of the line, not the right', () => {
  assert.match(code('css/admin.css'), /text-align:end/);
  assert.match(code('css/admin.css'), /text-align:start/);
});

test('spacers push towards the end of the text', () => {
  const src = code('css/admin.css');
  assert.match(src, /margin-inline-start:auto/);
  const count = (src.match(/margin-inline-start:auto/g) || []).length;
  assert.ok(count >= 5, `only ${count} spacers converted; some rows will not reverse`);
});

test('absolutely positioned elements use the inline end', () => {
  assert.match(code('css/admin.css'), /inset-inline-end:0/, 'the dropdown menu');
  assert.match(code('css/admin.css'), /inset-inline-end:24px/, 'the toast');
  assert.match(code('css/dashboard.css'), /inset-inline-end:16px/, 'the mobile close button');
});

/* The accent bar sits on the leading edge of a toast, so it moves with the text
   rather than staying on the screen's left. */
test('the toast accent bar follows the text direction', () => {
  const src = code('css/admin.css');
  assert.match(src, /#toast\.ok\{border-inline-start:3px/);
  assert.match(src, /#toast\.err\{border-inline-start:3px/);
});

/* ── the project really does ship a right-to-left language ────────────────── */

test('a right-to-left locale is shipped, so this is not hypothetical', () => {
  const rtl = fs.readdirSync(path.join(root, 'i18n'))
    .filter(f => f.endsWith('.json'))
    .filter(f => JSON.parse(read(`i18n/${f}`))._meta?.dir === 'rtl');
  assert.ok(rtl.length > 0, 'no rtl locale found; this work would be speculative');
});

test('the page sets its direction from the chosen locale', () => {
  /* Logical properties do nothing unless dir is actually set. */
  assert.match(read('js/i18n.js'), /setAttribute\('dir', dirFor\(current\)\)/);
});
