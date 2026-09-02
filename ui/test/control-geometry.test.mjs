import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Control geometry against the kit. These are measured values, not
   preferences.

   The slider handle is the one deliberate departure. The kit draws a 2 by 24
   line, too small to find and drag on a phone, so every slider keeps a 20 round
   knob and both sliders share one rule. */

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'css');
const admin = fs.readFileSync(path.join(dir, 'admin.css'), 'utf8');
const tokens = fs.readFileSync(path.join(dir, 'tokens.css'), 'utf8');

/* The declaration block for a selector, comments stripped.

   Anchored to the start of a rule. A bare indexOf finds `.pe{` inside
   `.ie-row.editing .pe{`, which sits earlier in the file and reports the wrong
   block. */
function rule(css, selector) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = bare.search(new RegExp(`(^|[}\n])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`));
  assert.ok(at >= 0, `${selector} is not in the stylesheet`);
  const open = bare.indexOf('{', at);
  return bare.slice(open + 1, bare.indexOf('}', open));
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

/* One visual control, so the handle is declared once, size included. The kit
   draws a colour slider as a thick bar, which would split them again. */
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
  /* A size rule for one slider alone splits them again. Preceded by a closing
     brace, not a comma, so the shared rule's own second selector line does not
     read as one. */
  assert.doesNotMatch(
    bare,
    /\}\s*\.hsb-range::-\w+-(slider|range)-thumb\{/,
    'a colour-only handle rule is back; the two have to stay one control',
  );
});

/* Clipping the paint to the content box shrinks each corner by the padding on
   that axis. The padding is vertical only, so the two radii cannot be one
   value: the vertical one is raised to cancel it and the horizontal one is not.
   A single radius leaves the horizontal corner uncancelled, and the ends taper
   to a point instead of drawing round. */
test('a touch track still draws round ends', () => {
  const bare = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const cls of ['adm-range', 'hsb-range']) {
    const track = 6;
    const m = new RegExp(
      `\\.${cls} \\{ height:44px; padding-block:(\\d+)px;[^}]*border-radius:(\\d+)px\\s*/\\s*(\\d+)px`,
    ).exec(bare);
    assert.ok(m, `${cls} has no per-axis compensated radius in the touch block`);
    const pad = Number(m[1]);
    /* No horizontal padding, so this radius is drawn as written. */
    assert.equal(Number(m[2]), track / 2, `${cls} draws horizontal radius ${m[2]}, expected ${track / 2}`);
    assert.equal(
      Number(m[3]) - pad,
      track / 2,
      `${cls} draws vertical radius ${Number(m[3]) - pad}, expected ${track / 2}`,
    );
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
   align with the row's label rather than the group's edge. */
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

/* Every inline action on a phone: the drawn box stays small and 44 is the hit
   area. Setting 44 on the box pushes the control away from the text it belongs
   to. */
test('inline actions keep their drawn size on touch', () => {
  const bare = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  const touch = /@media \(pointer:coarse\) \{([\s\S]*?)\n\}/.exec(bare);
  assert.ok(touch, 'the touch block is gone');

  assert.doesNotMatch(
    touch[1],
    /\.pe \{[^}]*width:44px/,
    '.pe already carries a 44 hit area through ::after; sizing the box to 44 doubles it',
  );
  assert.match(rule(admin, '.pe'), /width:28px/, 'the drawn box stays 28');
  assert.match(rule(admin, '.pe::after'), /width:44px/, 'the hit area is the pseudo-element');

  /* .btn.sm is two classes and outranks .ic, so an icon button needs saying
     again or it takes a text button's side padding. */
  assert.match(touch[1], /\.btn\.ic \{[^}]*padding:6px/, 'an icon button keeps its square padding');
  assert.ok(
    touch[1].indexOf('.btn.ic') > touch[1].indexOf('.btn.sm'),
    '.btn.ic has to come after .btn.sm to win at equal specificity',
  );
});

/* The address truncates to a fragment at phone width and crowds the name and
   the pills, which share the row with it. */
test('the dashboard row drops its address on a phone', () => {
  assert.match(admin, /html\.is-mobile \.rmt\{display:none\}/);
});

/* A segmented control, built on the radios that were already there. The inputs
   stay because the form reads them and a screen reader announces them; only the
   dot goes, since the selected segment is the indicator. */
test('the choice rows are a segmented control', () => {
  const track = rule(admin, '.segr');
  const seg = rule(admin, '.segr-opt');
  assert.match(track, /padding:2px/);
  assert.match(seg, /min-height:28px/);
  /* 28 segment inside 2 of padding each side is a 32 track, and half of that
     is the radius that makes it a capsule. */
  assert.match(track, /border-radius:16px/);
  assert.match(rule(admin, '.segr-dot'), /display:none/, 'the dot is replaced by the selected segment');
  assert.match(admin, /\.segr-opt:has\(input:checked\)\{background:var\(--segment-on\)\}/);
  /* The input is 0 by 0, so the generic input:focus-visible outline is invisible
     on it and the segment has to wear the ring. */
  assert.match(admin, /\.segr-opt:has\(input:focus-visible\)\{outline:/);
});

test("an alert's buttons are capsules", () => {
  const bare = admin.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = /\.dlg-foot \.btn,\.dlg-foot \.btn\.sm\{([^}]*)\}/.exec(bare);
  assert.ok(m, 'the dialog buttons must name .sm too, or the touch block outranks this');
  assert.match(m[1], /min-height:48px/);
  assert.match(m[1], /border-radius:24px/, 'half the height, so it is a capsule');
});
