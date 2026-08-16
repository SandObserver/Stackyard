import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Control geometry against the kit.

   These are measured values, not preferences. A settings row is 52 and a row
   carrying two lines is 68. A grouped list is rounded to 26. A switch is 64 by
   28 with a 38 by 24 capsule knob inset 2, so the knob travels 22. The system
   slider draws a 6 track with a 2 by 24 line for a handle, which is a handle
   shape rather than a smaller circle.

   The slider handle is the one deliberate departure. The kit draws a 2 by 24
   line, which is too small a thing to find and drag on a phone, so every slider
   keeps a 20 round knob. The two sliders had drifted apart because each carried
   its own copy of the rule, so they now share one.

   They had all been drawn to an older version of the design language and were
   sized for smaller text than the project now uses. */

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'css');
const admin = fs.readFileSync(path.join(dir, 'admin.css'), 'utf8');
const tokens = fs.readFileSync(path.join(dir, 'tokens.css'), 'utf8');

/* The declaration block for a selector, comments stripped. */
function rule(css, selector) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = bare.indexOf(selector + '{');
  assert.ok(at >= 0, `${selector} is not in the stylesheet`);
  return bare.slice(at + selector.length + 1, bare.indexOf('}', at));
}

test('a row is 52, and a row carrying two lines is 68', () => {
  assert.match(rule(admin, '.row'), /min-height:52px/);
  assert.match(rule(admin, '.row.drow'), /min-height:68px/);
});

test('the separator is inset to the leading edge of the label', () => {
  const sep = rule(admin, '.row::after');
  assert.match(sep, /inset-inline-start:16px/, 'the inset is 16 and has to follow the text direction');
  assert.match(sep, /inset-inline-end:0/, 'flush at the trailing edge');
  assert.match(sep, /height:1px/);
});

test('a grouped list is rounded to 26, and the panel is not', () => {
  assert.match(tokens, /--sy-radius-group:26px/);
  assert.match(rule(admin, '.grp'), /border-radius:var\(--sy-radius-group\)/);
  /* The panel, the dialog and the toast share --r and must not follow the
     group, or the whole page turns into a lozenge. */
  assert.match(tokens, /--sy-radius-lg:14px/);
  assert.match(rule(admin, '.adm'), /border-radius:var\(--r\)/);
});

test('the switch is 64 by 28 with a capsule knob that travels 22', () => {
  const track = rule(admin, '.tr');
  assert.match(track, /width:64px/);
  assert.match(track, /height:28px/);
  assert.match(track, /border-radius:14px/);

  const knob = rule(admin, '.tr::after');
  assert.match(knob, /width:38px/);
  assert.match(knob, /height:24px/);
  assert.match(knob, /border-radius:12px/, 'a capsule, not a circle');

  /* 64 - 2 inset each side - 38 knob = 22. */
  assert.match(rule(admin, '.tog input:checked+.tr::after'), /translateX\(22px\)/);
});

test('both sliders run a 6 track', () => {
  assert.match(rule(admin, '.adm-range'), /height:6px/);
  assert.match(rule(admin, '.hsb-range'), /height:6px/);
});

/* The drift this guards: the wallpaper slider and the three colour sliders were
   two rules with the same job, and one was changed without the other. Sharing
   the selector is what makes them the same control, so the check is that they
   are declared together and not that each happens to say 20. */
test('every slider shares one handle rule', () => {
  const bare = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const kind of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
    const shared = new RegExp(`\\.adm-range${kind},\\s*\\.hsb-range${kind}\\{([^}]*)\\}`);
    const m = shared.exec(bare);
    assert.ok(m, `the two sliders do not share their ${kind} rule`);
    assert.match(m[1], /width:20px/);
    assert.match(m[1], /height:20px/);
    assert.match(m[1], /border-radius:50%/, 'a round knob, big enough to drag on a phone');
  }
});

/* The touch rule pads the input out to a 44 target and clips the paint back to
   the track, so the padding has to track the track height or the slider looks
   fat on a phone again. */
test('the touch target still paints a 6 track', () => {
  const bare = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = /\.adm-range\s*\{\s*height:44px;\s*padding-block:(\d+)px;/.exec(bare);
  assert.ok(m, 'the touch-sized rule is gone');
  const painted = 44 - 2 * Number(m[1]);
  assert.equal(painted, 6, `the painted track is ${painted}, not 6`);
});

/* A group's header and footer belong to the rows below and above them, so they
   align with the row's label rather than the group's edge. They had sat at 0
   and 2, sixteen short, which reads as the header being adrift from its group. */
test('a group header and footer align with the row label', () => {
  assert.match(rule(admin, '.grp-hdr'), /padding:26px 16px 6px/);
  assert.match(rule(admin, '.grp-tip'), /padding:8px 16px 14px/);
  assert.match(rule(admin, '.row'), /padding:0 16px/, 'the inset only aligns if the row still uses 16');
});

/* Sections need air between them or the page reads as one wall of rows. The
   kit leaves about 34 between a group and the next section's heading. */
test('there is room between one group and the next heading', () => {
  const gap =
    Number(/margin-bottom:(\d+)px/.exec(rule(admin, '.grp'))[1]) +
    Number(/padding:(\d+)px/.exec(rule(admin, '.grp-hdr'))[1]);
  assert.ok(gap >= 30, `only ${gap} between a group and the next heading`);
});

/* A small button keeps its drawn size on touch. Making 44 the box rather than
   the hit area turns every inline action into a slab. */
test('a small button stays small on touch', () => {
  const bare = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = /\.btn\.sm \{([^}]*)\}/.exec(bare);
  assert.ok(m, 'the touch rule for a small button is gone');
  assert.match(m[1], /min-height:30px/, 'the drawn box stays 30');
  assert.match(bare, /\.btn\.sm::after \{[^}]*height:44px/, 'the hit area has to be extended instead');
});

test('the sidebar is 320 with 44 items and a pill selection', () => {
  assert.match(admin, /--sbw:320px/);
  const item = rule(admin, '.nl');
  assert.match(item, /min-height:44px/);
  /* Half the height, so the selection is a pill rather than a rounded box. */
  assert.match(item, /border-radius:22px/);
});

/* The bar's height is the pill's padding plus its own. Raising one without
   lowering the other grows the bar and eats into the page. */
test('the tab selection is a pill and the bar keeps its height', () => {
  const bare = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  const tab = /html\.is-mobile \.mtab\{([^}]*)\}/.exec(bare);
  assert.ok(tab, 'the tab rule is gone');
  const pillPad = Number(/padding-block:(\d+)px/.exec(tab[1])[1]);
  /* Not a stadium. The label runs along the bottom edge, where a stadium's
     curve is tightest, so at this padding a half-height radius clips the ends
     of a long label. Checked as a bound, since the failure is geometric. */
  const radius = Number(/border-radius:(\d+)px/.exec(tab[1])[1]);
  const inset = radius - Math.sqrt(Math.max(0, radius ** 2 - (radius - pillPad) ** 2));
  assert.ok(inset < 5, `the pill cuts ${inset.toFixed(1)} in at the label's line; keep it under 5`);

  assert.match(tab[1], /padding-inline:\d+px/, 'the label needs room either side of it');
  assert.match(tab[1], /white-space:nowrap/, 'a label must not wrap inside the pill');

  const bar = /html\.is-mobile body\.authed \.mtabbar\{([\s\S]*?)\}/.exec(bare);
  const barPad = Number(/padding:(\d+)px \d+px/.exec(bar[1])[1]);
  assert.equal(pillPad + barPad, 13, `the bar grew: ${pillPad} + ${barPad} should still be 13`);

  assert.match(rule(admin, 'html.is-mobile .mtab.active'), /background:var\(--tab-pill\)/);
});
