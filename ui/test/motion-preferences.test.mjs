/* Regression tests for P12-3: the Admin page ignored accessibility preferences.

   An operating system lets someone ask for reduced motion, reduced transparency
   or increased contrast, and people turn these on for real reasons: motion
   sensitivity, vestibular disorders, low vision.

   The dashboard honoured all three. Admin honoured none, because the blocks
   lived in dashboard.css and only the dashboard loads that file. Someone with
   reduced motion turned on got a calm dashboard and a Settings page that still
   slid and sprang, which is worse than being consistently wrong: the setting
   appears to work until you open Settings.

   The general rules moved to tokens.css, which both pages load. Contrast could
   not simply move, since the dashboard's block overrides tokens defined in
   dashboard.css; Admin has its own block against its own tokens. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const tokens = read('css/tokens.css');
const dashboard = read('css/dashboard.css');
const admin = read('css/admin.css');

/* Which stylesheets each page actually loads, read from the markup rather than
   assumed, since that is what decides whether a rule reaches a page. */
function stylesheetsOf(page) {
  return [...read(page).matchAll(/href="\/css\/([a-z-]+\.css)/g)].map(m => m[1]);
}

test('both pages load tokens.css', () => {
  /* The whole approach rests on this. */
  for (const page of ['index.html', 'admin/index.html']) {
    assert.ok(stylesheetsOf(page).includes('tokens.css'), `${page} does not load tokens.css`);
  }
});

test('only the dashboard loads dashboard.css', () => {
  assert.ok(
    !stylesheetsOf('admin/index.html').includes('dashboard.css'),
    'if Admin loaded it, none of this would have been necessary',
  );
});

/* ── every page honours motion and transparency ───────────────────────────── */

test('reduced motion is handled in the shared stylesheet', () => {
  assert.match(tokens, /@media \(prefers-reduced-motion: reduce\)/);
});

test('reduced transparency is handled in the shared stylesheet', () => {
  assert.match(tokens, /@media \(prefers-reduced-transparency: reduce\)/);
});

/* A duration of exactly 0 skips the transitionend event some code waits on, so
   the value has to be small rather than zero. */
test('reduced motion neutralises rather than removes transitions', () => {
  const block = tokens.slice(tokens.indexOf('@media (prefers-reduced-motion'));
  assert.match(block, /transition-duration: \.01ms !important/);
  assert.match(block, /animation-duration: \.01ms !important/);
  assert.doesNotMatch(block.slice(0, block.indexOf('}')), /duration: 0s/);
});

test('every page ends up honouring all three preferences', () => {
  const forPage = page => {
    const sheets = stylesheetsOf(page)
      .map(f => read(`css/${f}`))
      .join('\n');
    return {
      motion: /@media \(prefers-reduced-motion: reduce\)/.test(sheets),
      transparency: /@media \(prefers-reduced-transparency: reduce\)/.test(sheets),
      contrast: /@media \(prefers-contrast: more\)/.test(sheets),
    };
  };
  for (const page of ['index.html', 'admin/index.html']) {
    assert.deepEqual(
      forPage(page),
      { motion: true, transparency: true, contrast: true },
      `${page} does not honour every preference`,
    );
  }
});

/* ── the split is clean ───────────────────────────────────────────────────── */

/* Rules naming dashboard elements would be inert on Admin, so they stay where
   they mean something. */
test('the shared stylesheet holds no page-specific selectors', () => {
  const blocks = tokens.slice(tokens.indexOf('@media (prefers-'));
  for (const sel of ['#pages', '.icon:hover', '.dot', '.ilabel', '.widget']) {
    assert.ok(!blocks.includes(sel), `${sel} means nothing outside the dashboard`);
  }
});

test('the dashboard keeps its own selectors and token overrides', () => {
  const motion = dashboard.slice(dashboard.indexOf('@media (prefers-reduced-motion'));
  assert.match(motion.slice(0, 300), /#pages/);
  const transparency = dashboard.slice(dashboard.indexOf('@media (prefers-reduced-transparency'));
  assert.match(transparency.slice(0, 200), /--glass-blur: none/);
});

/* The general rules are in one place, so no page can drift from another. */
test('the universal rules are not duplicated', () => {
  const universal = /\*, \*::before, \*::after \{/;
  const motionBlock = css => {
    const at = css.indexOf('@media (prefers-reduced-motion');
    return at === -1 ? '' : css.slice(at, css.indexOf('\n}', at));
  };
  assert.match(motionBlock(tokens), universal);
  assert.doesNotMatch(motionBlock(dashboard), universal, 'a second copy would drift');
  assert.doesNotMatch(motionBlock(admin), universal);
});

/* ── admin contrast ───────────────────────────────────────────────────────── */

test('admin raises its own tokens for increased contrast', () => {
  const block = admin.slice(admin.indexOf('@media (prefers-contrast: more)'));
  for (const token of ['--dm', '--bd', '--tx']) {
    assert.ok(block.slice(0, block.indexOf('\n  }')).includes(`${token}:`), `${token} is not raised`);
  }
});

/* Measured against the page's own background rather than chosen by eye. WCAG
   asks 4.5 for body text and 3.0 for a UI border. */
test('the raised colours meet the contrast they are raised for', () => {
  const lin = c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = hex => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  /* Tokens point at other tokens now, so measuring means resolving the chain the
     browser would. Declarations outside a contrast block are the base; those
     inside it, from either file, are layered on top; then var() is followed to a
     hex. This is what the page actually computes in increased-contrast mode. */
  const contrastBlock = src => {
    const i = src.indexOf('@media (prefers-contrast: more)');
    return i === -1 ? '' : src.slice(i, src.indexOf('\n}', i));
  };
  const declarations = src => {
    const out = new Map();
    for (const m of src.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) out.set(m[1], m[2].trim());
    return out;
  };
  const withoutContrast = src => src.replace(/@media \(prefers-contrast: more\)[\s\S]*?\n}/g, '');

  const map = new Map([
    ...declarations(withoutContrast(tokens)),
    ...declarations(withoutContrast(admin)),
    ...declarations(contrastBlock(tokens)),
    ...declarations(contrastBlock(admin)),
  ]);
  const resolve = (name, seen = new Set()) => {
    if (seen.has(name)) return null;
    seen.add(name);
    const v = map.get(name);
    if (!v) return null;
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    const ref = /^var\(\s*(--[\w-]+)/.exec(v);
    return ref ? resolve(ref[1], seen) : null;
  };

  const pane = resolve('--pane');
  assert.ok(pane, 'the panel background does not resolve to a hex');
  for (const [token, min, what] of [
    ['--dm', 4.5, 'body text'],
    ['--bd', 3, 'a UI border'],
  ]) {
    const value = resolve(token);
    assert.ok(value, `${token} does not resolve to a hex`);
    const got = ratio(value, pane);
    assert.ok(got >= min, `${token} is ${got.toFixed(2)} against ${pane}, below the ${min} for ${what}`);
  }
});

/* The custom controls draw their own focus ring, so a generic rule would miss
   exactly the ones a keyboard user relies on. */
test('increased contrast widens every focus ring, including the custom ones', () => {
  const block = admin.slice(admin.indexOf('@media (prefers-contrast: more)'));
  for (const sel of ['button:focus-visible', '.tog input:focus-visible+.tr', '.row-dd-list li:focus-visible']) {
    assert.ok(block.includes(sel), `${sel} keeps a thin ring in high contrast`);
  }
  assert.match(block, /outline-width:3px/);
});
