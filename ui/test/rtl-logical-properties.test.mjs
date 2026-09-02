/* The stylesheets must use logical properties. A physical one does not follow
   the text direction, so Persian looks wrong invisibly to anyone working in
   English.

   The overrides that remain are deliberate. A back chevron is a drawing, not a
   box, so no logical property expresses "point the other way". */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const SHEETS = ['css/admin.css', 'css/dashboard.css', 'css/tokens.css', 'css/widget-config-form.css'];

/* Widget pages, whose CSS lives in a <style> block. The dashboard sets the
   frame's direction, so their logical properties resolve. */
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
const styleBlocks = src =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map(m => m[1])
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const widgetCss = file => styleBlocks(read(file));

/* Comments are stripped, or a comment explaining this rule would trip it. */
const code = file => read(file).replace(/\/\*[\s\S]*?\*\//g, '');

/* ── no physical properties remain ────────────────────────────────────────── */

const PHYSICAL = [
  /margin-left\s*:/,
  /margin-right\s*:/,
  /padding-left\s*:/,
  /padding-right\s*:/,
  /border-left\s*:/,
  /border-right\s*:/,
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

/* A widget's own CSS is held to the same rule, but only for the properties
   that sit next to text. A symmetric pair, centring with a translate, and
   artwork are exempt: mirroring a drawing is worse than leaving it. */
test('no widget page spaces text by screen side', () => {
  const offenders = [];
  for (const file of widgetPages()) {
    const src = widgetCss(file);
    for (const pattern of PHYSICAL) {
      const m = pattern.exec(src);
      if (m) offenders.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `These do not flip for Persian. Use the inline-start/end form:\n  ${offenders.join('\n  ')}`,
  );
});

/* The dashboard sets the direction when it mounts the frame. A widget folder
   needs no code of its own to follow the page. */
test('the dashboard gives each widget frame the page direction', () => {
  const utils = read('js/utils.js');
  assert.match(utils, /doc\.documentElement\.setAttribute\('dir'/, 'nothing sets the direction inside a widget frame');
  assert.match(
    utils,
    /addEventListener\('load', applyDir\)/,
    'a reload replaces the document, so this has to run on every load',
  );
});

/* A widget may pin the direction of a fragment: an IP address table or a log
   tail reads the same in every language. It may not pin its whole document.
   That is the one the dashboard sets, and overriding it stops the widget
   following the app.

   The line is the document, not the idea. `<div dir="ltr">` and a rule on a
   container are fine; `<html dir>`, `<body dir>` and `html`/`body`/`:root
   { direction }` are not. */
const DOC_SELECTOR = /(^|,)\s*(html|body|:root)\b/;
const DIRECTION_DECL = /(?<![\w-])direction\s*:/;

/* How a page pins its document direction, or null. Takes the source rather than
   a path, so the same check runs against a hand-written sample below. */
function pinsDocumentDirection(src) {
  if (/<(?:html|body)[^>]*\sdir=/.test(src)) return 'a dir attribute on the document';
  for (const m of styleBlocks(src).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (DOC_SELECTOR.test(m[1]) && DIRECTION_DECL.test(m[2])) {
      return `direction on ${m[1].trim().split('\n').join(' ')}`;
    }
  }
  return null;
}

test('no widget page pins the direction of its own document', () => {
  const offenders = [];
  for (const file of widgetPages()) {
    const how = pinsDocumentDirection(read(file));
    if (how) offenders.push(`${file}: ${how}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `A widget follows the page direction. To pin content that reads the same in
every language, put dir or direction on a wrapper inside the widget instead:
  ${offenders.join('\n  ')}`,
  );
});

/* The other half of the same rule: pinning a fragment has to stay possible, or
   the rule above pushes an author towards the document-level pin it forbids. */
test('pinning a fragment is still allowed', () => {
  const allowed = [
    '<html><body><div dir="ltr">10.0.0.1</div></body></html>',
    '<html><style>.log{direction:ltr}</style><body><pre class="log"></pre></body></html>',
    '<html><style>.pad{flex-direction:column}</style><body></body></html>',
  ];
  for (const src of allowed) {
    assert.equal(pinsDocumentDirection(src), null, `should be allowed: ${src}`);
  }
});

test('the document-level forms are all caught', () => {
  const pinned = [
    '<html dir="ltr"><body></body></html>',
    '<html><body dir="ltr"></body></html>',
    '<html><style>body{direction:ltr}</style></html>',
    '<html><style>html,body{font-size:12px;direction:ltr}</style></html>',
    '<html><style>:root{direction:ltr}</style></html>',
  ];
  for (const src of pinned) {
    assert.notEqual(pinsDocumentDirection(src), null, `should be caught: ${src}`);
  }
});

/* ── the overrides are gone ───────────────────────────────────────────────── */

test('the dashboard needs no direction overrides at all', () => {
  assert.doesNotMatch(
    code('css/dashboard.css'),
    /\[dir="rtl"\]/,
    'an override list can only cover what someone noticed',
  );
});

/* Only the chevrons, the gradient angle and the toggle knob's travel, none of
   which a logical property can express. */
test('admin keeps only the overrides that cannot be logical', () => {
  const allowed = [/transform:\s*scaleX\(-1\)/, /--slider-dir:\s*270deg/, /transform:\s*translateX\(-22px\)/];
  const overrides = [...code('css/admin.css').matchAll(/\[dir="rtl"\][^{]*\{[^}]*\}/g)].map(m => m[0]);
  assert.equal(overrides.length, allowed.length, `unexpected override list, found:\n${overrides.join('\n')}`);
  for (const rule of allowed) {
    assert.ok(
      overrides.some(o => rule.test(o)),
      `no override matches ${rule}`,
    );
  }
});

/* ── the logical replacements are actually there ──────────────────────────── */

test('the divider between the navigation and the section follows the text direction', () => {
  /* It sits on the content pane rather than the sidebar. The sidebar is sticky
     and one viewport tall, so a border there stopped partway down a section
     longer than the screen; the pane is as tall as its content. Still logical,
     so it moves to the other side in Persian. */
  const src = code('css/admin.css');
  assert.match(src, /\.cp\{[^}]*border-inline-start:1px solid var\(--bd-inner\)/);
  assert.doesNotMatch(src, /\.sb\{[^}]*border-inline-(start|end)/, 'the sidebar should no longer carry the divider');
  assert.match(
    src,
    /html\.is-mobile \.cp\{[^}]*border-inline-start:none/,
    'there is no sidebar on mobile, so no divider either',
  );
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

/* The toast is a tinted fill with a border on every side, so it has no leading
   edge to place. Neither rule may name a side. */
test('the toast state has no edge that could point the wrong way', () => {
  const src = code('css/admin.css');
  const rules = [...src.matchAll(/#toast\.(?:ok|err)\{([^}]*)\}/g)].map(m => m[1]);
  assert.equal(rules.length, 2, 'expected an .ok and an .err toast rule');
  for (const body of rules) {
    assert.doesNotMatch(
      body,
      /border-(left|right|inline-start|inline-end)/,
      `a one-sided toast border is back: ${body}`,
    );
    assert.match(body, /border-color:/, 'the state should colour the whole border');
  }
});

/* ── the project really does ship a right-to-left language ────────────────── */

test('a right-to-left locale is shipped, so this is not hypothetical', () => {
  const rtl = fs
    .readdirSync(path.join(root, 'i18n'))
    .filter(f => f.endsWith('.json'))
    .filter(f => JSON.parse(read(`i18n/${f}`))._meta?.dir === 'rtl');
  assert.ok(rtl.length > 0, 'no rtl locale found; this work would be speculative');
});

test('the page sets its direction from the chosen locale', () => {
  /* Logical properties do nothing unless dir is actually set. */
  assert.match(read('js/i18n.js'), /setAttribute\('dir', dirFor\(current\)\)/);
});

/* ── insets ───────────────────────────────────────────────────────────────── */

/* `left` and `right` are the same defect as `margin-left`.

   Three uses are allowed. A pair with the same value on both sides is
   symmetric. `left: 50%` with a transform is centring. An invisible element has
   no reading direction: the safe-area probe is measured, never seen.

   Widget pages are out of scope: their absolute positions place artwork. */
const INSET = /(?<![\w-])(left|right)\s*:\s*([^;}]+)/g;
const RULES = /([^{}]+)\{([^{}]*)\}/g;

const insetOffenders = css => {
  const out = [];
  for (const rule of css.matchAll(RULES)) {
    const [selector, body] = [rule[1].trim().split('\n').pop().trim(), rule[2]];
    const sides = new Map();
    for (const d of body.matchAll(INSET)) sides.set(d[1], d[2].trim());
    if (sides.size === 0) continue;
    if (/visibility\s*:\s*hidden/.test(body)) continue;
    if (sides.size === 2 && sides.get('left') === sides.get('right')) continue;
    if ([...sides.values()].every(v => v === '50%') && /transform\s*:/.test(body)) continue;
    for (const [side, value] of sides) out.push(`${selector}: ${side}: ${value}`);
  }
  return out;
};

test('no stylesheet places anything by screen side', () => {
  const offenders = [];
  for (const sheet of SHEETS) {
    for (const hit of insetOffenders(code(sheet))) offenders.push(`${sheet} ${hit}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `These do not flip for Persian. Use inset-inline-start/end:\n  ${offenders.join('\n  ')}`,
  );
});

test('the inset check still recognises what it is meant to allow', () => {
  assert.deepEqual(insetOffenders('.a{left:0;right:0}'), [], 'a symmetric pair is not a defect');
  assert.deepEqual(insetOffenders('.b{left:50%;transform:translateX(-50%)}'), [], 'centring is not a defect');
  assert.deepEqual(insetOffenders('.c{left:0;visibility:hidden}'), [], 'an invisible probe has no direction');
  assert.deepEqual(insetOffenders('.d{margin-left:2px}'), [], 'the check above owns the margin form');
  assert.deepEqual(insetOffenders('.e{left:2px}'), ['.e: left: 2px'], 'a one-sided inset is a defect');
  assert.deepEqual(
    insetOffenders('.f{left:0;right:8px}'),
    ['.f: left: 0', '.f: right: 8px'],
    'an uneven pair is a defect',
  );
});
