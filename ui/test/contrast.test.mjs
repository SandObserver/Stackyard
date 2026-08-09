import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* WCAG contrast for the admin greys, computed rather than recorded.

   Secondary text sat at 3.48 against a card and 4.27 against the pane, where
   1.4.3 asks 4.5; borders sat at 1.90 and 2.33 against the 3.0 of 1.4.11. The
   numbers had been measured by hand and written into a comment, which is how
   they went stale: the palette moved to Apple's system greys underneath them
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

/* ── resolving a token to a hex value ─────────────────────────────────────── */

/* Declarations from a block, last one winning, which is how the cascade reads a
   single :root. */
function declarations(src, from = 0, to = src.length) {
  const out = new Map();
  /* Not anchored to the line start: tokens.css writes two declarations per
     line, a grey and its -hi partner. */
  for (const m of src.slice(from, to).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

const raisedAt = s => s.indexOf('@media (prefers-contrast: more)');

/* Two resolvers: the default theme, and the one someone gets after asking their
   system for more contrast. The raised block is layered on top of the base. */
function resolver({ raised }) {
  const base = new Map([
    ...declarations(tokens, 0, raisedAt(tokens)),
    ...declarations(admin, 0, raisedAt(admin)),
  ]);
  if (raised) {
    for (const [k, v] of declarations(tokens, raisedAt(tokens))) base.set(k, v);
    for (const [k, v] of declarations(admin, raisedAt(admin))) base.set(k, v);
  }
  return function resolve(name, seen = new Set()) {
    assert.ok(!seen.has(name), `${name} resolves in a cycle`);
    seen.add(name);
    const value = base.get(name);
    assert.ok(value, `${name} is not declared`);
    const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
    if (ref) return resolve(ref[1], seen);
    assert.match(value, /^#[0-9a-fA-F]{6}$/, `${name} is not a plain hex value: ${value}`);
    return value;
  };
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

test('the resolver reads both files', () => {
  const resolve = resolver({ raised: false });
  assert.equal(resolve('--dm'), '#A3A3A8');
  assert.equal(resolve('--pane'), '#2C2C2E');
  assert.equal(resolve('--cp'), '#3A3A3C');
});

test('every required pair clears its threshold in the default theme', () => {
  const resolve = resolver({ raised: false });
  const failures = [];
  for (const [fg, min, what] of REQUIRED) {
    for (const bg of SURFACES) {
      const r = ratio(resolve(fg), resolve(bg));
      if (r < min) failures.push(`${fg} on ${bg}: ${r.toFixed(2)}, needs ${min} (${what})`);
    }
  }
  assert.deepEqual(failures, [], `Below the WCAG minimum:\n  ${failures.join('\n  ')}`);
});

test('increased contrast clears every threshold too', () => {
  const high = resolver({ raised: true });
  const failures = [];
  for (const [fg, min, what] of REQUIRED) {
    for (const bg of SURFACES) {
      const r = ratio(high(fg), high(bg));
      if (r < min) failures.push(`${fg} on ${bg}: ${r.toFixed(2)}, needs ${min} (${what})`);
    }
  }
  assert.deepEqual(failures, [], `Below the WCAG minimum in the raised mode:\n  ${failures.join('\n  ')}`);
});

/* The mode exists to improve the pairs that are close to their limit. It did
   not, on a card: Apple's gray-hi reaches only 4.39 there, because the surfaces
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
  assert.deepEqual(worse, [],
    `Increased contrast has to help where it matters:\n  ${worse.join('\n  ')}`);
});

/* The two greys that are not Apple's exist because Apple's neighbours do not
   land where the thresholds are. If one is ever loosened back to a palette
   step, that has to be a deliberate change with the ratio checked above, not a
   tidy-up that reads like restoring consistency. */
test('the derived greys are declared with their reason', () => {
  assert.match(tokens, /--sy-a11y-dim:\s*#A3A3A8/);
  assert.match(tokens, /--sy-a11y-border:\s*#838387/);
  const at = tokens.indexOf('--sy-a11y-dim:');
  const note = tokens.slice(Math.max(0, at - 1200), at);
  assert.match(note, /WCAG/, 'the derived greys need the note saying why they are not Apple values');
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
    cls: m[1], accent: m[2], percent: Number(m[3]), page: m[4], border: m[5],
  }));
  assert.equal(rules.length, 2, 'expected an .ok and an .err toast rule in the form the test reads');
  return rules;
}

test('the toast reads its own colours from the stylesheet', () => {
  const rules = toastRules();
  assert.deepEqual(rules.map(r => r.cls), ['ok', 'err']);
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
