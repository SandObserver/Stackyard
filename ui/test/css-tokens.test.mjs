import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* The token layer: a palette named by hue, and roles named by job that point at
   it. P12-4 and P12-5.

   Two classes of bug this guards.

   A var() naming a token nobody defines is invalid at computed-value time, so
   the property silently falls back to its initial value. --card was referenced
   twice in admin.css and had never been defined anywhere in the repo's history:
   the mobile back button and the drag ghost were drawing a transparent
   background and nothing said so.

   A theme colour written as a literal escapes the palette. The accent used to be
   #027aff in admin.css and #0a84ff in dashboard.css, two different blues doing
   one job, which is what made changing it a hunt rather than an edit. */

const cssDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../css');
const files = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const read = f => strip(fs.readFileSync(path.join(cssDir, f), 'utf8'));
const all = files.map(f => [f, read(f)]);

/* Set from JavaScript at runtime rather than declared in CSS: the wallpaper and
   its brightness come from settings, and the dashboard's layout engine writes
   per-element sizing onto inline styles. A var() naming one of these is correct
   even though no stylesheet defines it. */
const RUNTIME = new Set([
  '--bg-image',
  '--bg-brightness',
  '--bg-color',
  '--sc',
  '--sz',
  '--iw',
  '--rh',
  '--cw',
  '--lfs',
  '--lw',
  '--br',
  '--gap',
  '--pad',
  '--gw',
  '--gh',
  '--fiw',
  '--dsz',
  '--tfs',
  '--left',
  '--bw',
  '--bh',
  '--top',
  '--pt',
  '--ph',
  '--pb',
]);

const defined = new Set();
for (const [, src] of all) for (const m of src.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);

test('the scan sees the token layer', () => {
  assert.ok(defined.has('--accent'), 'the accent role must be defined');
  assert.ok(defined.has('--sy-teal'), 'the palette must be defined');
  assert.ok(defined.size > 30, `only ${defined.size} tokens found, the scan is probably wrong`);
});

/* The --card class of bug. */
test('every var() names a token that exists', () => {
  const missing = [];
  for (const [f, src] of all) {
    for (const m of src.matchAll(/var\(\s*(--[\w-]+)\s*(,|\))/g)) {
      const [, name, next] = m;
      if (defined.has(name) || RUNTIME.has(name)) continue;
      if (next === ',') continue; /* has a fallback, so it degrades on purpose */
      missing.push(`${name} in ${f}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Undefined token with no fallback. The declaration is dropped at computed-value time and the property silently reverts:\n${missing.join('\n')}`,
  );
});

test('the accent is teal, through the role and not a literal', () => {
  const tokens = read('tokens.css');
  assert.match(tokens, /--accent:\s*var\(--sy-teal\)/, 'the accent role must point at the palette');
  assert.match(tokens, /--sy-teal:\s*#00D2E0/i);
  assert.match(tokens, /--sy-teal-hi:\s*#3BDDEC/i);
});

/* Every hue carries its increased-contrast partner, because the contrast block
   swaps the palette wholesale and a missing -hi would resolve to nothing. */
test('every palette hue has an increased-contrast partner', () => {
  const tokens = read('tokens.css');
  const hues = [...tokens.matchAll(/--sy-([a-z]+\d?):\s*#/g)].map(m => m[1]);
  assert.ok(hues.length >= 18, `expected the twelve hues and six greys, found ${hues.length}`);
  for (const h of hues) {
    assert.match(tokens, new RegExp(`--sy-${h}-hi:\\s*#`), `--sy-${h} has no -hi partner`);
  }
});

test('increased contrast moves the palette to the -hi values', () => {
  const tokens = read('tokens.css');
  const block = tokens.slice(tokens.indexOf('@media (prefers-contrast: more)'));
  for (const h of ['red', 'green', 'teal', 'blue', 'gray', 'gray6']) {
    assert.match(block, new RegExp(`--sy-${h}:\\s*var\\(--sy-${h}-hi\\)`), `${h} is not raised`);
  }
});

/* Theme colours belong to the palette. The exceptions are colour-space UI, not
   theme: the picker's hue ramp and its rainbow swatch are the spectrum itself,
   and #fff / #000 as ink on a coloured fill are not palette decisions. */
const LITERAL = /#[0-9a-fA-F]{3,8}\b/g;
const ALLOWED_LITERAL = /^#(fff|ffffff|000|000000)$/i;

test('no theme colour literal outside tokens.css', () => {
  const offenders = [];
  for (const [f, src] of all) {
    if (f === 'tokens.css') continue;
    for (const line of src.split('\n')) {
      if (/hsb-hue|cc-rainbow/.test(line)) continue; /* the colour picker's spectrum */
      for (const m of line.matchAll(LITERAL)) {
        if (ALLOWED_LITERAL.test(m[0])) continue;
        /* a page's own surface and border greys are page-scoped, declared in its
           own :root, and are not part of the system palette */
        if (/^\s*--/.test(line)) continue;
        offenders.push(`${f}: ${m[0]} in ${line.trim().slice(0, 70)}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Theme colour written as a literal. Use a role from tokens.css, or declare a page-scoped token in that file's :root:\n${offenders.join('\n')}`,
  );
});

/* The rules both pages need live in one file. They were written out in full in
   each, so the wallpaper layer was ten identical declarations in two places. */
test('the shared root rules are defined once, in tokens.css', () => {
  for (const sel of ['html::before', '*, *::before, *::after']) {
    const owners = all.filter(([, src]) => src.includes(sel.replace(/, /g, ',')) || src.includes(sel)).map(([f]) => f);
    assert.deepEqual(
      owners,
      ['tokens.css'],
      `${sel} should be defined only in tokens.css, found in ${owners.join(', ')}`,
    );
  }
});
