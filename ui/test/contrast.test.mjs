import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/* WCAG contrast for the admin greys, computed rather than recorded.

   Secondary text sat at 3.48 against a card and 4.27 against the pane, where
   1.4.3 asks 4.5; borders sat at 1.90 and 2.33 against the 3.0 of 1.4.11. The
   numbers had been measured by hand and written into a comment, which is how
   they went stale: the palette moved to the system greys underneath them
   and nothing recomputed anything.

   So the ratios are computed here from the files themselves. A colour change
   that drops a pair below its threshold fails, and no one has to remember to
   re-measure.

   Only the pairs that carry a requirement are listed. A decorative separator is
   not a UI component under 1.4.11, and asserting a threshold on one would mean
   raising it for no reason a user could name. */

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'css');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

const tokens = read('tokens.css');
const admin = read('admin.css');
const dashboard = read('dashboard.css');

/* ── resolving a token to a hex value ─────────────────────────────────────── */

/* The page has two themes and each has a raised variant, so a declaration has to
   be read with the selector and the media query it sits under. Splitting the
   file at the contrast block was enough while there was one theme; it would now
   fold the light values into the dark map.

   Every rule in these two files, with the at-rule it is nested in. One level of
   nesting is all either file has. */
function rules(src) {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  let media = null;
  while (i < s.length) {
    const open = s.indexOf('{', i);
    if (open < 0) break;
    const prelude = s.slice(i, open).trim();
    if (prelude.startsWith('@')) {
      media = prelude;
      i = open + 1;
      continue;
    }
    let depth = 1;
    let j = open + 1;
    while (j < s.length && depth > 0) {
      if (s[j] === '{') depth++;
      else if (s[j] === '}') depth--;
      j++;
    }
    out.push({ media, selectors: prelude.split(',').map(x => x.trim()), body: s.slice(open + 1, j - 1) });
    while (/\s/.test(s[j] || '')) j++;
    /* The next brace to close is the at-rule's own. */
    if (s[j] === '}') {
      media = null;
      j++;
    }
    i = j;
  }
  return out;
}

/* Declarations from the rules a theme selects, in file order, last one
   winning. */
function declarations(src, wanted) {
  const out = new Map();
  for (const rule of rules(src)) {
    if (!wanted(rule)) continue;
    /* Not anchored to the line start: tokens.css writes two declarations per
       line, a grey and its -hi partner. */
    for (const m of rule.body.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) out.set(m[1], m[2].trim());
  }
  return out;
}

const RAISED = '@media (prefers-contrast: more)';
const LIGHT = 'html[data-theme="light"]';

/* Four resolvers: each theme, and what each becomes after someone asks their
   system for more contrast. A theme layers its own rules over the defaults, and
   the raised block layers over both. */
function resolver({ raised = false, light = false, extra = [] } = {}) {
  const wants = rule => {
    if (rule.media && rule.media !== RAISED) return false;
    if (rule.media === RAISED && !raised) return false;
    const isLight = rule.selectors.includes(LIGHT);
    const isBase = rule.selectors.includes(':root');
    /* The light theme inherits every :root default and overrides some of them.
       The dark theme never reads a light-only rule. */
    return light ? isBase || isLight : isBase;
  };
  const sources = [tokens, admin, ...extra];
  const base = new Map(sources.flatMap(src => [...declarations(src, wants)]));
  function resolve(name, seen = new Set()) {
    assert.ok(!seen.has(name), `${name} resolves in a cycle`);
    seen.add(name);
    const value = base.get(name);
    assert.ok(value, `${name} is not declared`);
    const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
    if (ref) return resolve(ref[1], seen);
    const mix = MIX.exec(value);
    if (mix) {
      const [, colour, pct, other] = mix;
      const a = hexOf(resolve, colour, seen);
      /* A tint over nothing is not a colour yet. Only the opaque form resolves
         here; tintOf carries the transparent one to its backdrop. */
      assert.notEqual(other.trim(), 'transparent', `${name} is a tint, not a colour`);
      return blend(a, hexOf(resolve, other, seen), Number(pct) / 100);
    }
    assert.match(value, /^#[0-9a-fA-F]{6}$/, `${name} is not a plain hex value: ${value}`);
    return value;
  }
  /* The declared value, before it is resolved to a colour. */
  resolve.raw = name => {
    const value = base.get(name);
    assert.ok(value, `${name} is not declared`);
    const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
    return ref ? resolve.raw(ref[1]) : value;
  };
  return resolve;
}

const MIX = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)$/;

/* A literal, a var(), or a nested mix. */
function hexOf(resolve, expr, seen) {
  const e = expr.trim();
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(e);
  if (ref) return resolve(ref[1], new Set(seen));
  assert.match(e, /^#[0-9a-fA-F]{6}$/, `not a colour: ${e}`);
  return e;
}

/** `a` at `weight`, the rest `b`. @returns {string} hex */
function blend(a, b, weight) {
  const ch = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const [x, y] = [ch(a), ch(b)];
  return (
    '#' +
    x
      .map((v, i) =>
        Math.round(v * weight + y[i] * (1 - weight))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/* A translucent fill is not a colour until it has a backdrop. Both spellings the
   stylesheets use resolve the same way: rgba() and a mix with transparent. */
function tintOver(resolve, name, surface) {
  const value = resolve.raw(name);
  const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(value);
  if (rgba) {
    const hex =
      '#' +
      rgba
        .slice(1, 4)
        .map(v => Number(v).toString(16).padStart(2, '0'))
        .join('');
    return blend(hex, resolve(surface), Number(rgba[4]));
  }
  const mix = MIX.exec(value);
  assert.ok(mix, `${name} is not a translucent fill: ${value}`);
  assert.equal(mix[3].trim(), 'transparent', `${name} is already opaque`);
  return blend(hexOf(resolve, mix[1]), resolve(surface), Number(mix[2]) / 100);
}

/* ── WCAG 2.1 relative luminance and contrast ─────────────────────────────── */

function luminance(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255);
  const [r, g, b] = c.map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/* Every surface the admin page puts these on. The card is the worst of the
   three and is the one the hand-measured note missed. */
const SURFACES = ['--bg-outer', '--pane', '--cp'];

/* [foreground, minimum, what it is]. 4.5 is 1.4.3 for body text, 3.0 is 1.4.11
   for the boundary of a control. */
const REQUIRED = [
  ['--tx', 4.5, 'primary text'],
  ['--dm', 4.5, 'secondary text, and the placeholder and unset-value text that share it'],
  ['--bd', 3.0, 'the border that delineates a control'],
];

/* A pill and an unselected chip are not text on a surface: each sits on a
   translucent fill, and the ink has to clear 4.5 against the fill composited
   over whatever is behind it. The hue's readable variant does not survive that
   composite on its own, which is how six pills sat between 3.6 and 4.4.

   The pane and the card are the two backdrops these appear on. */
const TINTED = [
  ['--chip-dk-fg', '--chip-dk-bg', 'the dashboard-type pill'],
  ['--chip-wg-fg', '--chip-wg-bg', 'the widget-type pill'],
  ['--chip-hl-fg', '--chip-hl-bg', 'the hidden-item pill'],
  ['--chip-bg-fg', '--chip-bg-bg', 'the badge pill'],
  ['--chip-fl-fg', '--chip-fl-bg', 'the folder-type pill'],
  ['--chip-sy-fg', '--chip-sy-bg', 'the system-item pill'],
  ['--chip-text', '--field-fill', 'an unselected filter chip'],
];

const TINT_BACKDROPS = ['--pane', '--cp'];

for (const light of [false, true]) {
  test(`every tinted label clears 4.5 on both backdrops: ${light ? 'light' : 'dark'}`, () => {
    const resolve = resolver({ light });
    const failures = [];
    for (const [ink, fill, what] of TINTED) {
      for (const backdrop of TINT_BACKDROPS) {
        const r = ratio(resolve(ink), tintOver(resolve, fill, backdrop));
        if (r < 4.5) failures.push(`${ink} on ${fill} over ${backdrop}: ${r.toFixed(2)}, needs 4.5 (${what})`);
      }
    }
    assert.deepEqual(failures, [], `Below the WCAG minimum:\n  ${failures.join('\n  ')}`);
  });
}

test('the resolver reads both files', () => {
  const resolve = resolver();
  assert.equal(resolve('--dm'), '#A3A3A8');
  assert.equal(resolve('--pane'), '#2C2C2E');
  assert.equal(resolve('--cp'), '#3A3A3C');
});

test('the resolver reads the light theme', () => {
  const resolve = resolver({ light: true });
  assert.equal(resolve('--dm'), '#6C6C70');
  assert.equal(resolve('--pane'), '#F2F2F7');
  assert.equal(resolve('--cp'), '#FFFFFF');
});

/* Four combinations, one measurement. The light theme is not exempt from any
   threshold the dark one carries. */
for (const light of [false, true]) {
  for (const raised of [false, true]) {
    const name = `${light ? 'light' : 'dark'}${raised ? ', increased contrast' : ''}`;
    test(`every required pair clears its threshold: ${name}`, () => {
      const resolve = resolver({ raised, light });
      const failures = [];
      for (const [fg, min, what] of REQUIRED) {
        for (const bg of SURFACES) {
          const r = ratio(resolve(fg), resolve(bg));
          if (r < min) failures.push(`${fg} on ${bg}: ${r.toFixed(2)}, needs ${min} (${what})`);
        }
      }
      assert.deepEqual(failures, [], `Below the WCAG minimum (${name}):\n  ${failures.join('\n  ')}`);
    });
  }
}

/* The accent is a link colour and a button fill in both themes, and the light
   hues are drawn for a fill. --accent-strong is what a rule names when the
   accent has to be read as text. */
test('the accent reads as text on every surface it is used on', () => {
  const failures = [];
  for (const light of [false, true]) {
    const resolve = resolver({ light });
    for (const bg of SURFACES) {
      const r = ratio(resolve('--ac2'), resolve(bg));
      if (r < 4.5) failures.push(`${light ? 'light' : 'dark'}: --ac2 on ${bg}: ${r.toFixed(2)}, needs 4.5`);
    }
  }
  assert.deepEqual(failures, [], `Below the WCAG minimum:\n  ${failures.join('\n  ')}`);
});

/* The mode exists to improve the pairs that are close to their limit. It did
   not, on a card: the raised grey reaches only 4.39 there, because the surfaces
   are raised alongside the text.

   Only pairs within twice their threshold are compared. Primary text is at 12:1
   and dips to 12.06 from 12.49, because #ffffff against a lighter surface is a
   fraction worse than #f2f2f7 against a darker one. Requiring an improvement
   there would be arithmetic nobody can see, on a pair that is not the point of
   the mode. */
test('increased contrast improves the pairs that are near their threshold', () => {
  const base = resolver({ raised: false });
  const high = resolver({ raised: true });
  const worse = [];
  for (const [fg, min] of REQUIRED) {
    for (const bg of SURFACES) {
      const b = ratio(base(fg), base(bg));
      if (b >= min * 2) continue;
      const h = ratio(high(fg), high(bg));
      if (h <= b) worse.push(`${fg} on ${bg}: ${h.toFixed(2)} raised, ${b.toFixed(2)} default`);
    }
  }
  assert.deepEqual(worse, [], `Increased contrast has to help where it matters:\n  ${worse.join('\n  ')}`);
});

/* The two greys that are not from the palette exist because its neighbours do not
   land where the thresholds are. If one is ever loosened back to a palette
   step, that has to be a deliberate change with the ratio checked above, not a
   tidy-up that reads like restoring consistency. */
test('the derived greys are declared with their reason', () => {
  assert.match(tokens, /--sy-a11y-dim:\s*#A3A3A8/);
  assert.match(tokens, /--sy-a11y-border:\s*#838387/);
  const at = tokens.indexOf('--sy-a11y-dim:');
  const note = tokens.slice(Math.max(0, at - 1200), at);
  assert.match(note, /WCAG/, 'the derived greys need the note saying why they are not palette values');
});

/* ── the save toast ───────────────────────────────────────────────────────── */

/* The toast reports success and failure, so its text carries 1.4.3 and its
   border carries 1.4.11 as the boundary of the thing being shown. The accent
   cannot be the fill: --gn and --rd behind near-white text measure 2.02 and
   3.43. The fill is a mix of the accent into the page colour instead, with the
   accent at full strength on the border, and both halves are computed here from
   the declaration itself rather than trusted. */

/* color-mix(in srgb, <a> N%, <b>), which is a straight per-channel blend. */
function mixSrgb(a, b, percent) {
  const ch = (hex, i) => parseInt(hex.substr(i, 2), 16);
  const p = percent / 100;
  const out = [1, 3, 5].map(i => Math.round(ch(a, i) * p + ch(b, i) * (1 - p)));
  return `#${out.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/* [class, accent token, mix percentage, page token] read off the stylesheet, so
   changing the recipe re-measures rather than silently drifting from the note. */
function toastRules() {
  const src = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  const re =
    /#toast\.(ok|err)\{background:color-mix\(in srgb,\s*var\((--[\w-]+)\)\s+(\d+)%,\s*var\((--[\w-]+)\)\);border-color:var\((--[\w-]+)\)\}/g;
  const rules = [...src.matchAll(re)].map(m => ({
    cls: m[1],
    accent: m[2],
    percent: Number(m[3]),
    page: m[4],
    border: m[5],
  }));
  assert.equal(rules.length, 2, 'expected an .ok and an .err toast rule in the form the test reads');
  return rules;
}

test('the toast reads its own colours from the stylesheet', () => {
  const rules = toastRules();
  assert.deepEqual(
    rules.map(r => r.cls),
    ['ok', 'err'],
  );
  for (const r of rules) assert.ok(r.percent > 0 && r.percent < 100, `odd mix percentage: ${r.percent}`);
});

for (const raised of [false, true]) {
  test(`the toast clears its thresholds${raised ? ' under increased contrast' : ''}`, () => {
    const resolve = resolver({ raised });
    const failures = [];
    for (const { cls, accent, percent, page, border } of toastRules()) {
      const fill = mixSrgb(resolve(accent), resolve(page), percent);
      const text = ratio(resolve('--tx'), fill);
      if (text < 4.5) failures.push(`.${cls}: text on the fill is ${text.toFixed(2)}, needs 4.5`);
      /* Against the page, not the fill: it is the edge between the toast and
         what is behind it that has to be findable. */
      const edge = ratio(resolve(border), resolve('--bg-outer'));
      if (edge < 3.0) failures.push(`.${cls}: border against the page is ${edge.toFixed(2)}, needs 3.0`);
    }
    assert.deepEqual(failures, [], `Below the WCAG minimum:\n  ${failures.join('\n  ')}`);
  });
}

/* ── ink on a filled control ──────────────────────────────────────────────── */

/* A control filled with a role colour carries its own ink. White failed on
   every dark fill: the accent at 1.86, the success green at 2.02, the danger
   red at 3.43, all under the 4.5 of 1.4.3. --on-fill moves with the theme
   instead, and the pairs are measured here rather than assumed.

   The rules are read off the stylesheet, so a new filled control is measured
   without anyone adding it to a list. */
function filledRules() {
  const found = [];
  for (const rule of rules(admin)) {
    if (!/color:\s*var\(--on-fill\)/.test(rule.body)) continue;
    const bg = /background:\s*var\((--[\w-]+)\)/.exec(rule.body);
    if (bg) found.push({ what: rule.selectors.join(','), fill: bg[1] });
  }
  return found;
}

/* Fills declared by a different rule than the ink, so the scan above cannot
   pair them up. [what, ink, fill]. */
const SPLIT_PAIRS = [
  ['the checked credential box', '--on-fill', '--ac'],
  ['the red app badge', '--on-fill', '--badge-red'],
  ['the blue app badge', '--on-fill', '--badge-blue'],
  ['the green app badge', '--on-fill', '--badge-green'],
];

/* Not text. 1.4.11 asks 3.0 of the glyph against the fill behind it. */
const GRAPHIC_PAIRS = [['the icon on an app tile with no icon yet', '--on-tint', '--tile-placeholder']];

test('every filled control the stylesheet declares is paired with its ink', () => {
  const found = filledRules().map(r => r.what);
  for (const sel of ['.bp', '.login-btn', '.setpw-btn', '.nl.active', '.chip.on']) {
    assert.ok(
      found.includes(sel),
      `${sel} is filled with a role colour and no longer names --on-fill: ${found.join(', ')}`,
    );
  }
});

for (const light of [false, true]) {
  for (const raised of [false, true]) {
    const name = `${light ? 'light' : 'dark'}${raised ? ', increased contrast' : ''}`;
    test(`ink on a filled control clears its threshold: ${name}`, () => {
      const resolve = resolver({ raised, light, extra: [dashboard] });
      const failures = [];
      const check = (what, ink, fill, min) => {
        const r = ratio(resolve(ink), resolve(fill));
        if (r < min) failures.push(`${what}: ${ink} on ${fill} is ${r.toFixed(2)}, needs ${min}`);
      };
      for (const { what, fill } of filledRules()) check(what, '--on-fill', fill, 4.5);
      for (const [what, ink, fill] of SPLIT_PAIRS) check(what, ink, fill, 4.5);
      for (const [what, ink, fill] of GRAPHIC_PAIRS) check(what, ink, fill, 3.0);
      assert.deepEqual(failures, [], `Below the WCAG minimum (${name}):\n  ${failures.join('\n  ')}`);
    });
  }
}

/* --on-tint is the ink on a fill this project does not choose: the colour a
   user picks for an app. No test can measure that pair. It stays white in both
   themes so the ink does not change under the user while the fill does not. */
test('--on-tint is white in both themes', () => {
  assert.equal(resolver()('--on-tint'), '#FFFFFF');
  assert.equal(resolver({ light: true })('--on-tint'), '#FFFFFF');
});
