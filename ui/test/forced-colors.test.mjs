/* Windows High Contrast replaces declared colours with the user's palette, but
   it does not remove background images or backdrop-filter. Unhandled, the
   wallpaper and the glass survive while everything over them is flattened, so
   two states paint the same.

   The mode cannot be emulated in a stylesheet parser, so these read the
   rules. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'css');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

const tokens = read('tokens.css');
const dashboard = read('dashboard.css');
const admin = read('admin.css');

/** Every `@media (forced-colors: active)` block in a file, with where its body starts and ends. */
function forcedRanges(css) {
  const out = [];
  const re = /@media\s*\(forced-colors:\s*active\)\s*\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1,
      i = re.lastIndex;
    for (; i < css.length && depth; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    out.push({ from: re.lastIndex, to: i - 1 });
    re.lastIndex = i;
  }
  return out;
}

/** The body of every `@media (forced-colors: active)` block in a file. */
const forcedBlocks = css => forcedRanges(css).map(r => css.slice(r.from, r.to));

/** `selector { declarations }` rules in a stretch of CSS, with their offsets. Comments removed. */
function rules(css, offset = 0) {
  const out = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
  for (const m of clean.matchAll(/([^{}@;]+)\{([^{}]*)\}/g)) {
    const props = [...m[2].matchAll(/([\w-]+)\s*:/g)].map(p => p[1]);
    out.push({ selector: m[1].trim().replace(/\s+/g, ' '), props, at: offset + m.index });
  }
  return out;
}

const shared = forcedBlocks(tokens).join('\n');
const dash = forcedBlocks(dashboard).join('\n');
const adm = forcedBlocks(admin).join('\n');

test('the mode is handled at all', () => {
  assert.ok(shared.length, 'tokens.css has no forced-colors block');
  assert.ok(dash.length, 'dashboard.css has no forced-colors block');
});

/* Both pages paint the wallpaper from tokens.css, so suppressing it there is
   what covers the admin page too. */
test('the wallpaper is suppressed for both pages', () => {
  assert.match(shared, /html::before\s*\{[^}]*background-image:\s*none/);
  assert.match(shared, /html::before\s*\{[^}]*background-color:\s*Canvas/);
});

/* A named list of blurred surfaces goes stale. dashboard.css alone sets
   backdrop-filter in more than twenty places. */
test('every blurred surface loses its blur, including ones added later', () => {
  assert.match(shared, /\*,\s*\*::before,\s*\*::after/, 'the blur override is not universal');
  assert.match(shared, /backdrop-filter:\s*none\s*!important/);
  assert.match(shared, /-webkit-backdrop-filter:\s*none\s*!important/);
});

/* The two dots must not paint the same colour. */
test('the current page is marked by shape, not only by fill', () => {
  assert.match(dash, /\.dot\s*\{[^}]*border:\s*1px solid CanvasText/, 'an inactive dot has no outline');
  assert.match(dash, /\.dot\.on\s*\{[^}]*background:\s*Highlight/, 'the active dot does not use the system highlight');
});

/* Status is information the system palette cannot express, which is the only
   thing that justifies opting out. */
test('the badge keeps its status colour, and keeps its shape', () => {
  assert.match(dash, /\.badge\s*\{[^}]*forced-color-adjust:\s*none/);
  assert.match(dash, /\.badge\s*\{[^}]*border:\s*1px solid CanvasText/, 'the pill loses its shape without a border');
});

/* Opting the whole page out would override a setting the user turned on. */
test('nothing outside the badge opts out of the mode', () => {
  const all = [tokens, dashboard, read('admin.css')].join('\n');
  const optOuts = [...all.matchAll(/([^{}]*)\{[^}]*forced-color-adjust:\s*none/g)].map(m =>
    m[1].trim().split('\n').pop().trim(),
  );
  assert.deepEqual(optOuts, ['.badge'], `unexpected opt-outs: ${optOuts.join(', ')}`);
});

/* System colour keywords only. A literal here would be replaced anyway, and
   would read as though it were doing something. */
test('the blocks use system colours, not literals', () => {
  for (const [name, block] of [
    ['tokens.css', shared],
    ['dashboard.css', dash],
    ['admin.css', adm],
  ]) {
    assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/, `${name} declares a colour literal inside forced colors`);
    assert.doesNotMatch(block, /rgba?\(/, `${name} declares an rgb colour inside forced colors`);
  }
});

/* A switch is a filled track and knob with no border. Both states otherwise
   paint Canvas on Canvas. */
test('Settings switches keep a shape and show on and off', () => {
  assert.match(adm, /\.tr\{[^}]*border:\s*1px solid CanvasText/, 'the track has no outline');
  assert.match(adm, /\.tr::after\{[^}]*background:\s*CanvasText/, 'the knob has no system colour');
  assert.match(adm, /\.tog input:checked\+\.tr\{[^}]*background:\s*Highlight/, 'on looks the same as off');
  assert.match(
    adm,
    /\.tog input:checked\+\.tr::after\{[^}]*background:\s*HighlightText/,
    'the knob vanishes on Highlight',
  );
});

test('the selected segment and filter chip are marked', () => {
  assert.match(adm, /\.segr-opt:has\(input:checked\)\{[^}]*background:\s*Highlight/);
  assert.match(adm, /\.segr-opt:has\(input:checked\) span\{[^}]*color:\s*HighlightText/);
  assert.match(adm, /\.chip\.on\{[^}]*background:\s*Highlight/);
});

/* Focus stays in the search field. The row Enter opens is marked by class only. */
test('the keyboard row in search and the icon picker is outlined', () => {
  assert.match(dash, /\.sr\.sel\s*\{[^}]*outline:\s*2px solid Highlight/);
  assert.match(adm, /\.ipr\.kb-active\{[^}]*outline:\s*2px solid Highlight/);
});

test('the first-run password field shows its edge and its focus', () => {
  assert.match(dash, /\.setup-pw\s*\{[^}]*border:\s*1px solid CanvasText/);
  assert.match(dash, /\.setup-pw:focus\s*\{[^}]*outline:\s*2px solid Highlight/);
});

/* A media query adds no specificity. A plain rule for the same selector later
   in the file wins, and the forced-colors rule never applies. */
test('no forced-colors rule is overridden by a later plain rule', () => {
  const overlaps = (a, b) => a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);
  const bad = [];
  for (const [name, css] of [
    ['tokens.css', tokens],
    ['dashboard.css', dashboard],
    ['admin.css', admin],
  ]) {
    const ranges = forcedRanges(css);
    const inside = at => ranges.some(r => at >= r.from && at < r.to);
    const plain = rules(css).filter(r => !inside(r.at));
    for (const range of ranges) {
      for (const forced of rules(css.slice(range.from, range.to), range.from)) {
        for (const later of plain) {
          if (later.at < range.to || later.selector !== forced.selector) continue;
          const prop = forced.props.find(p => later.props.some(q => overlaps(p, q)));
          if (prop) bad.push(`${name}: ${forced.selector} { ${prop} }`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});
