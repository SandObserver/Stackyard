import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* The eleven text styles, at every Dynamic Type step the project declares.

   The reference publishes each style as an absolute pair. The stylesheet stores
   a unitless ratio and an em instead, so a size scaled by --sc or by browser
   zoom carries its leading and tracking with it. A ratio rounded too hard stops
   reproducing the pair it came from, so the pairs are checked rather than the
   ratios. */

const cssDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../css');
const tokens = fs.readFileSync(path.join(cssDir, 'tokens.css'), 'utf8');

/* Tracking is one absolute value per style, the same at every step. An em that
   reproduces -0.43px at 17 does not reproduce it at 15, so each step stores its
   own em and each is checked against the same published tracking.

   [style, size, leading, tracking] */
const STEPS = {
  'Large (Default)': [
    ['large-title', 34, 41, 0.4],
    ['title-1', 28, 34, 0.38],
    ['title-2', 22, 28, -0.26],
    ['title-3', 20, 25, -0.45],
    ['headline', 17, 22, -0.43],
    ['body', 17, 22, -0.43],
    ['callout', 16, 21, -0.31],
    ['subheadline', 15, 20, -0.23],
    ['footnote', 13, 18, -0.08],
    ['caption-1', 12, 16, 0],
    ['caption-2', 11, 13, 0.06],
  ],
  Small: [
    ['large-title', 32, 39, 0.4],
    ['title-1', 26, 32, 0.38],
    ['title-2', 20, 24, -0.26],
    ['title-3', 18, 23, -0.45],
    ['headline', 15, 20, -0.43],
    ['body', 15, 20, -0.43],
    ['callout', 14, 19, -0.31],
    ['subheadline', 13, 18, -0.23],
    ['footnote', 12, 16, -0.08],
    ['caption-1', 11, 13, 0],
    ['caption-2', 11, 13, 0.06],
  ],
};

/* The two blocks are read separately. Scanning the whole file would let the step
   block overwrite the default one and the check would pass against itself. */
const bare = tokens.replace(/\/\*[\s\S]*?\*\//g, '');

/* Located by a declaration the block contains, then bounded by the braces
   either side of it. */
function block(marker) {
  const at = bare.indexOf(marker);
  assert.ok(at >= 0, `${marker} is not in tokens.css`);
  const open = bare.lastIndexOf('{', at);
  const close = bare.indexOf('}', at);
  const out = new Map();
  for (const m of bare.slice(open, close).matchAll(/(--(?:fs|lh|tr)-[\w-]+)\s*:\s*([^;{}]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const BLOCKS = {
  'Large (Default)': block('--fs-large-title:34px'),
  Small: block('--fs-large-title:32px'),
};

for (const [step, scale] of Object.entries(STEPS)) {
  const declared = BLOCKS[step];

  test(`${step}: every style declares all three tokens`, () => {
    const missing = [];
    for (const [name] of scale) {
      for (const p of ['fs', 'lh', 'tr']) {
        if (!declared.has(`--${p}-${name}`)) missing.push(`--${p}-${name}`);
      }
    }
    assert.deepEqual(missing, [], `A style is only part applied without all three:\n  ${missing.join('\n  ')}`);
  });

  test(`${step}: each size is the published size`, () => {
    const wrong = [];
    for (const [name, size] of scale) {
      const actual = declared.get(`--fs-${name}`);
      if (actual !== `${size}px`) wrong.push(`--fs-${name}: ${actual}, expected ${size}px`);
    }
    assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
  });

  /* Half a pixel: the ratio is stored to four places, and the point of the check
     is that it still lands on the published leading, not that it is exact. */
  test(`${step}: each ratio multiplies back out to the published leading`, () => {
    const wrong = [];
    for (const [name, size, leading] of scale) {
      const ratio = Number(declared.get(`--lh-${name}`));
      assert.ok(Number.isFinite(ratio), `--lh-${name} is not a unitless number: ${declared.get(`--lh-${name}`)}`);
      const got = ratio * size;
      if (Math.abs(got - leading) > 0.5)
        wrong.push(`--lh-${name}: ${got.toFixed(2)}px, published leading is ${leading}`);
    }
    assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
  });

  test(`${step}: each tracking multiplies back out to the published tracking`, () => {
    const wrong = [];
    for (const [name, size, , tracking] of scale) {
      const raw = declared.get(`--tr-${name}`);
      const em = raw === '0' ? 0 : Number(/^(-?[\d.]+)em$/.exec(raw)?.[1]);
      assert.ok(Number.isFinite(em), `--tr-${name} is not 0 or an em value: ${raw}`);
      const got = em * size;
      if (Math.abs(got - tracking) > 0.02)
        wrong.push(`--tr-${name}: ${got.toFixed(3)}px, published tracking is ${tracking}`);
    }
    assert.deepEqual(wrong, [], `\n  ${wrong.join('\n  ')}`);
  });
}

/* A rule that sets a size from the scale and takes its leading from somewhere
   else looks applied and is not. Rules that set their own line-height on
   purpose are listed, with the reason. */
const OWN_LINE_HEIGHT = new Set([
  '.badge', // a count in a fixed circle
  '#mob-search-pill .msp-icon',
  '.setup-sub',
  '.grp-tip', // prose, deliberately looser than the style
  '.hint',
]);

test('a rule using a size token takes its leading from the scale', () => {
  const offenders = [];
  for (const file of ['admin.css', 'dashboard.css']) {
    const src = fs.readFileSync(path.join(cssDir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const [, sel, body] = m;
      if (!/font-size:\s*(calc\()?var\(--fs-/.test(body)) continue;
      const name = sel.trim().split('\n').pop().trim();
      if (OWN_LINE_HEIGHT.has(name)) continue;
      if (!/line-height:\s*var\(--lh-/.test(body)) offenders.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(offenders, [], `Size from the scale, leading from elsewhere:\n  ${offenders.join('\n  ')}`);
});

/* Radii that have to follow the thing they round.

   An app icon's corner is 22.37% of its width, and the grid draws two widths:
   72 with a label under it and 78 without. A fixed radius lands on the ratio at
   one of them and is wrong at the other.

   A widget tile's corner is 28 at design size, and WIDGET_DESIGN's small is 170
   square against the reference's 165, so it is the reference value unchanged. It
   has to scale with the tile or the corners tighten as the dashboard grows. */
test('icon and tile radii are derived, not literal', () => {
  const dash = fs.readFileSync(path.join(cssDir, '..', 'js', 'dashboard.js'), 'utf8');
  assert.match(dash, /const ICON_R = 0\.2237;/);
  assert.match(dash, /mkWrap\(item, iw, Math\.round\(iw \* ICON_R\)/, 'the grid icon derives its corner');
  assert.match(dash, /mkWrap\(item, 78, Math\.round\(78 \* ICON_R\)/, 'the dock icon derives its corner');
  assert.match(dash, /const WIDGET_R = 28;/);
  assert.match(dash, /borderRadius = Math\.round\(WIDGET_R \* gm\.scale\)/, 'a tile corner scales with the tile');
});
