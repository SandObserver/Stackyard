import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { declarations } from './css-source.mjs';

/* The token layer: a palette named by hue, and roles named by job that point at
   it. Two classes of bug this guards.

   A var() naming a token nobody defines is invalid at computed-value time, so
   the property silently falls back to its initial value and nothing says so.

   A theme colour written as a literal escapes the palette, so one job ends up
   with a different value per stylesheet. */

const cssDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../css');
const files = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
const read = f => strip(fs.readFileSync(path.join(cssDir, f), 'utf8'));
const all = files.map(f => [f, read(f)]);
/* The markup, which the css helper's directory does not reach. */
const read2 = f => fs.readFileSync(path.resolve(cssDir, '..', f), 'utf8');

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

/* The functional forms the hex check above cannot see. A shadow is depth, not
   theme, so it may draw in neutral black or white. */
const COLOUR_FN = /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color)\((?:[^()]|\([^()]*\))*\)/g;
const NEUTRAL = /^rgba?\(\s*(?:0[\s,]+0[\s,]+0|255[\s,]+255[\s,]+255)\b/;
const SHADOW = /^(?:box-shadow|text-shadow)$/;

function colourFunctions(css) {
  const found = [];
  for (const d of declarations(css)) {
    if (d.prop.startsWith('--')) continue;
    for (const [lit] of d.value.matchAll(COLOUR_FN)) {
      if (SHADOW.test(d.prop) && NEUTRAL.test(lit)) continue;
      found.push(`line ${d.line}: ${d.prop}: ${lit}`);
    }
  }
  return found;
}

test('no colour function outside tokens.css', () => {
  const offenders = [];
  for (const f of files) {
    if (f === 'tokens.css') continue;
    for (const hit of colourFunctions(fs.readFileSync(path.join(cssDir, f), 'utf8'))) offenders.push(`${f} ${hit}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `Colour written as a literal. Use a role from tokens.css, or declare a page-scoped token in that file's :root:\n${offenders.join('\n')}`,
  );
});

test('the colour function check reads every form', () => {
  assert.deepEqual(colourFunctions('a{color:rgb(1 2 3 / .5)}').length, 1);
  assert.deepEqual(colourFunctions('a{background:linear-gradient(oklch(.7 .1 200), red)}').length, 1);
  assert.deepEqual(colourFunctions('a{border:1px solid var(--x, hsl(0 0% 50%))}').length, 1);
  assert.deepEqual(colourFunctions('a{box-shadow:0 1px 2px rgba(10,20,30,.2)}').length, 1);
  assert.deepEqual(colourFunctions('@media (x){a{b{color:rgba(0,0,0,.5)}}}').length, 1);
  assert.deepEqual(
    colourFunctions('a{box-shadow:0 1px 2px rgba(0,0,0,.2), inset 0 0 0 1px rgb(255 255 255 / .1)}'),
    [],
  );
  assert.deepEqual(colourFunctions('a{--t:rgba(1,2,3,.4)}'), []);
});

/* The rules both pages need live in one file, not written out in each. */
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

/* ── A class says what a thing is, not what colour it is ──────────────────── */

/* Rule 2 in design-system.md: never name a palette entry in a rule, in the
   selector included. Naming one gives a single action a different colour per
   pane. */

const PALETTE_WORDS = [
  'red',
  'orange',
  'yellow',
  'green',
  'mint',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'purple',
  'pink',
  'brown',
];

/* The badge's colour is its state, chosen in the config and read back in
   badge-logic.js, so here the hue is the thing being named. They are the only
   ones, and a new colour-named class is what this is watching for. */
const STATE_CLASSES = ['red', 'blue', 'green'];

/** Every class name a stylesheet defines. Comments are already stripped. */
function classNames(css) {
  return [...new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]))];
}

test('no class name states a colour', () => {
  const offenders = [];
  for (const sheet of ['admin.css', 'dashboard.css', 'tokens.css']) {
    for (const name of classNames(read(sheet))) {
      if (STATE_CLASSES.includes(name)) continue;
      const parts = name.toLowerCase().split(/[-_]/);
      if (PALETTE_WORDS.some(w => parts.includes(w))) offenders.push(`${sheet}: .${name}`);
    }
  }
  assert.deepEqual(offenders, [], `A class names a role, not a hue:\n  ${offenders.join('\n  ')}`);
});

/* One action, one colour. Save is the primary button on every pane. */
test('every Save is the same button', () => {
  const html = read2('admin/index.html');
  const saves = [...html.matchAll(/<button[^>]*id="[\w-]*save"[^>]*>/g)].map(m => m[0]);
  assert.ok(saves.length >= 3, `expected the Save buttons, found ${saves.length}`);
  for (const s of saves) assert.match(s, /class="btn bp /, `a Save is not the primary button: ${s}`);
});

/* [id, why it is a second primary in its view]. Adding one is a design
   decision, not a fix for this test. */
const SECOND_PRIMARY = [['btn-add', 'the icon-only Add beside Save in the dashboard list']];

/* A view runs from one section header to the next header or the section end. */
test('a Settings view has one primary action', () => {
  const html = read2('admin/index.html');
  const listed = new Set(SECOND_PRIMARY.map(([id]) => id));
  const starts = [...html.matchAll(/class="sec-hdr"/g)].map(m => m.index);
  assert.ok(starts.length >= 5, `expected a header per view, found ${starts.length}`);
  const found = new Set();
  for (const [i, at] of starts.entries()) {
    const end = Math.min(starts[i + 1] ?? html.length, html.indexOf('</section>', at));
    const ids = [...html.slice(at, end).matchAll(/<button[^>]*class="[^"]*\bbp\b[^"]*"[^>]*>/g)].map(
      m => /id="([^"]+)"/.exec(m[0])?.[1] ?? m[0],
    );
    for (const id of ids) found.add(id);
    const counted = ids.filter(id => !listed.has(id));
    assert.ok(counted.length <= 1, `${counted.length} primary actions in one view: ${counted.join(', ')}`);
  }
  assert.deepEqual(
    [...listed].filter(id => !found.has(id)),
    [],
    'SECOND_PRIMARY names a button that is not primary',
  );
});

/* ── Spacing ──────────────────────────────────────────────────────────────── */

const SPACING = [2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 44];

test('every spacing step is declared, and names its own value', () => {
  const tokens = read('tokens.css');
  for (const step of SPACING) {
    const m = tokens.match(new RegExp(`--sp-${step}:\\s*(\\d+)px`));
    assert.ok(m, `--sp-${step} is not declared`);
    assert.equal(Number(m[1]), step, `--sp-${step} is ${m[1]}px`);
  }
});

test('the token file declares no step outside the scale', () => {
  const declared = [...read('tokens.css').matchAll(/--sp-(\d+):/g)].map(m => Number(m[1])).sort((a, b) => a - b);
  assert.deepEqual(declared, SPACING);
});

/* A fallback naming an undeclared token resolves to nothing. */
test('every custom property a stylesheet falls back to is declared', () => {
  const declared = new Set();
  for (const [, css] of all) for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);
  const missing = [];
  for (const [file, css] of all) {
    for (const m of css.matchAll(/var\(\s*--[\w-]+\s*,\s*var\(\s*(--[\w-]+)\s*\)/g)) {
      if (!declared.has(m[1])) missing.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], `A fallback that is not declared resolves to nothing:\n  ${missing.join('\n  ')}`);
});

/* Margins, paddings and gaps name a step. Insets and sizes are geometry and
   are not read. */
const SPACING_PROP = /^(?:margin|padding|gap|row-gap|column-gap|scroll-margin|scroll-padding)(?:-[a-z-]+)?$/;
const PX = /(?<![\w.-])(-?\d*\.?\d+)px(?![\w])/g;

function spacingLiterals(css) {
  const found = [];
  for (const d of declarations(css)) {
    if (d.prop.startsWith('--') || !SPACING_PROP.test(d.prop)) continue;
    for (const [, n] of d.value.matchAll(PX))
      if (Number(n) !== 0) found.push({ px: `${n}px`, line: d.line, prop: d.prop });
  }
  return found;
}

test('a spacing value on the scale names its step', () => {
  const offenders = [];
  for (const f of files) {
    if (f === 'tokens.css') continue;
    for (const { px, line, prop } of spacingLiterals(fs.readFileSync(path.join(cssDir, f), 'utf8'))) {
      const n = Math.abs(Number.parseFloat(px));
      if (!SPACING.includes(n)) continue;
      offenders.push(`${f} line ${line}: ${prop} ${px} is var(--sp-${n})${px.startsWith('-') ? ' negated' : ''}`);
    }
  }
  assert.deepEqual(offenders, [], `Name the step:\n  ${offenders.join('\n  ')}`);
});

/* Spacing that sits off the scale, per file and value. Moving a rule onto the
   scale lowers a count here; a value not listed fails. */
const OFF_SCALE = {
  'admin.css': {
    '-14px': 2,
    '1px': 4,
    '3px': 7,
    '5px': 7,
    '7px': 7,
    '9px': 1,
    '11px': 3,
    '13px': 3,
    '14px': 13,
    '18px': 8,
    '19px': 2,
    '22px': 4,
    '26px': 2,
    '28px': 2,
    '34px': 1,
    '36px': 1,
    '40px': 1,
    '48px': 2,
    '52px': 1,
    '132px': 1,
  },
  'config-recovery.css': { '52px': 1 },
  'dashboard.css': {
    '-14px': 2,
    '-9px': 1,
    '1px': 2,
    '3px': 4,
    '5px': 4,
    '7px': 1,
    '9px': 2,
    '13px': 4,
    '14px': 5,
    '15px': 3,
    '18px': 4,
    '22px': 3,
    '28px': 1,
    '52px': 2,
    '68px': 1,
    '70px': 1,
    '72px': 2,
    '80px': 1,
    '84px': 2,
    '108px': 1,
    '204px': 1,
  },
  'widget-config-form.css': { '28px': 1 },
};

test('spacing off the scale does not grow', () => {
  const actual = {};
  for (const f of files) {
    if (f === 'tokens.css') continue;
    for (const { px } of spacingLiterals(fs.readFileSync(path.join(cssDir, f), 'utf8'))) {
      if (SPACING.includes(Math.abs(Number.parseFloat(px)))) continue;
      actual[f] ??= {};
      actual[f][px] = (actual[f][px] ?? 0) + 1;
    }
  }
  const changes = [];
  for (const f of new Set([...Object.keys(actual), ...Object.keys(OFF_SCALE)])) {
    for (const px of new Set([...Object.keys(actual[f] ?? {}), ...Object.keys(OFF_SCALE[f] ?? {})])) {
      const was = OFF_SCALE[f]?.[px] ?? 0;
      const now = actual[f]?.[px] ?? 0;
      if (now > was) changes.push(`${f}: ${now - was} more ${px}. Use a step from --sp-*`);
      else if (now < was) changes.push(`${f}: ${px} fell to ${now}. Lower OFF_SCALE to match`);
    }
  }
  assert.deepEqual(changes, [], changes.join('\n'));
});

test('the spacing check reads every form', () => {
  const px = css => spacingLiterals(css).map(s => s.px);
  assert.deepEqual(px('a{padding:8px calc(var(--safe-top) + 13px) 0}'), ['8px', '13px']);
  assert.deepEqual(px('a{margin-inline:-4px;gap:var(--x, 6px)}'), ['-4px', '6px']);
  assert.deepEqual(px('@media (min-width:600px){a{b{padding-top:3px}}}'), ['3px']);
  assert.deepEqual(px('a{border:1.5px solid;inset:4px;width:8px;--g:8px;margin:.5px 0}'), ['.5px']);
});
