/* Regression tests for phase 2, the unreleased multi-badge UI.

   W-05 a badge with a unit measured 66px on a 72px icon, overhanging the tile
   and the widget above it. W-06 the popover set pointer-events:none, so SC
   1.4.13's hoverable requirement failed and the pop.contains guard was dead
   code. W-07 the popover ellipsised the names it exists to reveal. W-08 the
   visible label is the first to fire, which is a decision and now says so in
   the admin. W-09 the extra values were signalled by a six-pixel colour sliver.

   The feature is unreleased, so no configuration depends on any of this yet. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
const { firingLabels } = await import('../js/badge-logic.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const css = read('css/dashboard.css');
const popover = read('js/badge-popover.js');

/** The declarations for a selector, first match, comments stripped: prose in a
    comment must not answer a question about what is declared. */
function block(source, selector) {
  const at = source.indexOf(selector);
  assert.ok(at > -1, `${selector} is not declared`);
  return source.slice(at, source.indexOf('}', at)).replace(/\/\*[\s\S]*?\*\//g, '');
}

/* ── W-05 ─────────────────────────────────────────────────────────────────── */

test('the pill never carries a unit, on any layout', () => {
  assert.match(block(css, '.badge-unit {'), /display:none/);
  assert.doesNotMatch(css, /body\.is-mob \.badge-unit/, 'a layout-specific rule is what left the desktop pill wide');
});

/* The unit is still announced. Dropping it from the pill must not drop it from
   the accessible name. */
test('the unit still reaches the accessible name', () => {
  const dashboard = read('js/dashboard.js');
  assert.match(dashboard, /unitEl\.textContent = unit/, 'the unit element is no longer populated');
  assert.match(dashboard, /aria-label/, 'the badge no longer carries a label');
});

/* ── W-06 ─────────────────────────────────────────────────────────────────── */

test('the popover can be reached by the pointer', () => {
  const b = block(css, '.badge-pop {');
  assert.match(b, /pointer-events:auto/);
  assert.doesNotMatch(b, /pointer-events:none/);
});

test('leaving the badge closes on a delay the popover can cancel', () => {
  assert.match(popover, /const HOVER_OUT_MS = \d+/);
  assert.match(popover, /pointerleave[\s\S]{0,120}scheduleClose\(\)/, 'leaving the badge still closes immediately');
  assert.match(popover, /pop\.addEventListener\('pointerenter', cancelClose\)/);
  assert.match(popover, /pop\.addEventListener\('pointerleave', scheduleClose\)/);
});

/* It can swallow clicks now, so it must not navigate the tile beneath it. */
test('a click on the popover does not reach the tile', () => {
  assert.match(popover, /pop\.addEventListener\('click', e => e\.stopPropagation\(\)\)/);
});

/* Escape and a click outside used to be hand-written here. An auto popover is
   given both by the browser, so what this checks is that it is one, and that
   the module is told when the browser closes it behind its back. */
test('Escape and a click outside still close it', () => {
  assert.match(popover, /setAttribute\('popover', 'auto'\)/, 'not an auto popover, so neither dismissal exists');
  assert.match(popover, /showPopover\(\)/, 'shown some other way, which never enters the top layer');
  assert.match(
    popover,
    /addEventListener\('toggle'[\s\S]{0,140}closeBadgePopover\(\)/,
    'the module would still think it is open after the browser dismissed it',
  );
});

/* Scrolling and resizing are not light dismiss, and the popover is placed by
   hand against a badge that has just moved. */
test('scrolling or resizing still closes it', () => {
  assert.match(popover, /addEventListener\('scroll'[\s\S]{0,80}closeBadgePopover\(\)/);
  assert.match(popover, /addEventListener\('resize'[\s\S]{0,80}closeBadgePopover\(\)/);
});

/* ── W-07 ─────────────────────────────────────────────────────────────────── */

test('a long name wraps instead of being cut off', () => {
  const name = block(css, '.badge-pop-name {');
  assert.doesNotMatch(name, /white-space:nowrap/, 'the name cannot wrap');
  assert.doesNotMatch(name, /text-overflow:ellipsis/, 'the popover still truncates what it exists to show');
  assert.match(name, /-webkit-line-clamp:2/);
});

test('the popover is wider, and still fits a phone', () => {
  const b = block(css, '.badge-pop {');
  assert.match(b, /max-width:min\(300px,calc\(100vw - 16px\)\)/, 'a fixed cap either truncates or overflows');
});

test('the value column stays on one line', () => {
  assert.match(block(css, '.badge-pop-val {'), /tabular-nums/);
  assert.match(block(css, '.badge-pop-val {'), /flex-shrink:0/);
});

/* ── W-08 ─────────────────────────────────────────────────────────────────── */

/* Array order, deliberately. The test exists so a change is a decision rather
   than a regression. */
test('the visible label is the first one to fire, in configured order', () => {
  const labels = [
    { name: 'Transcoding', path: 'a', min: 1 },
    { name: 'Library scan queue', path: 'b', min: 1 },
    { name: 'Downloads', path: 'c', min: 1 },
  ];
  const fired = firingLabels(labels, [3, 128, 7]);
  assert.equal(fired[0].name, 'Transcoding', 'priority is configuration order, not magnitude');
  assert.equal(fired.length, 3);
});

test('a label under its threshold does not take the badge', () => {
  const labels = [
    { name: 'Quiet', path: 'a', min: 10 },
    { name: 'Loud', path: 'b', min: 1 },
  ];
  assert.equal(firingLabels(labels, [0, 4])[0].name, 'Loud');
});

test('the admin states the ordering rule beside the list', () => {
  assert.match(read('js/admin-app-form.js'), /id="act-label-order"/);
  for (const file of fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json'))) {
    const cat = JSON.parse(read(`i18n/${file}`));
    assert.ok(cat.app?.labelOrderTip, `${file} is missing app.labelOrderTip`);
  }
});

/* ── W-09 ─────────────────────────────────────────────────────────────────── */

test('the stacked pill reads as a second pill, not as a fringe', () => {
  assert.match(
    block(css, '.badge.has-more::before {'),
    /box-shadow:0 0 0 [\d.]+px/,
    'the two pills have no visible edge between them',
  );
});

/* .badge.has-more offsets itself by the peek, so a wider peek walks the front
   pill off the corner it marks. The edge carries the cue instead. */
test('widening the peek does not move the badge off its corner', () => {
  const mobile = Number(css.match(/--badge-peek:calc\((\d+)px \* var\(--sc,1\)\)/)[1]);
  const desktop = Number(css.match(/--badge-peek:(\d+)px/)[1]);
  assert.equal(mobile, 7, 'the mobile peek must cancel the -7px corner offset');
  assert.equal(desktop, 6, 'the desktop peek must stay under the -7px corner offset');
});

/* The stacked pill is drawn outside the badge box, so a clip erases it. */
test('the badge does not clip its own stacked pill', () => {
  assert.doesNotMatch(block(css, '.badge {'), /overflow:hidden/);
});

/* It has to survive the badge being 20px tall. */
test('the cue costs no height', () => {
  const b = block(css, '.badge.has-more {');
  assert.doesNotMatch(b, /height:/, 'the collapsed cue must not change the pill height');
});
