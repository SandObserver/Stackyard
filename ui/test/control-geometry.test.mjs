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

   The colour picker is deliberately not here. It is its own control, with a 34
   round knob on a 34 track, and it keeps the round handle it already had.

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

test('the system slider is a line handle on a 6 track', () => {
  assert.match(rule(admin, '.adm-range'), /height:6px/);
  for (const sel of ['.adm-range::-webkit-slider-thumb', '.adm-range::-moz-range-thumb']) {
    const knob = rule(admin, sel);
    assert.match(knob, /width:2px/, `${sel} should be a line`);
    assert.match(knob, /height:24px/, `${sel} stands proud of the track`);
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

test('the colour picker keeps its round knob', () => {
  assert.match(rule(admin, '.hsb-range::-webkit-slider-thumb'), /border-radius:50%/);
});
