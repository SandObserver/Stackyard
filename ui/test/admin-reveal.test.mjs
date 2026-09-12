/* Rows a toggle reveals grow the group instead of appearing at full height.

   The wrapper is a one-row grid animating 0fr to 1fr, so it needs an inner
   element to own the overflow. Without that child the rows spill out of the
   collapsed track and the control is unusable while shut.

   State restored from the server must not animate: the page would open its own
   sections a moment after it paints. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const css = read('css/admin.css');
const html = read('admin/index.html');
const js = ['js/admin.js', 'js/admin-settings.js', 'js/admin-color-control.js', 'js/admin-shared.js']
  .map(f => read(f))
  .join('\n');

test('every disclosure wrapper holds an inner element', () => {
  const offenders = [...html.matchAll(/<div class="[^"]*\breveal\b[^"]*"[^>]*>\s*(<[^>]+>)/g)]
    .filter(m => !/class="reveal-in"/.test(m[1]))
    .map(m => m[0].replace(/\s+/g, ' '));
  assert.deepEqual(
    offenders,
    [],
    `a disclosure with no .reveal-in child cannot clip its rows:\n  ${offenders.join('\n  ')}`,
  );
});

test('the inner element can shrink below its content', () => {
  assert.match(
    css,
    /\.reveal > \.reveal-in\{overflow:hidden;min-height:0/,
    'a grid item without min-height:0 never closes',
  );
});

test('the track animates, and the closed state is zero', () => {
  assert.match(css, /\.reveal\{display:grid;grid-template-rows:0fr;transition:grid-template-rows/);
  assert.match(css, /\.reveal\.open\{grid-template-rows:1fr/);
});

test('closing runs shorter than opening', () => {
  const open = /\.reveal\.open\{[^}]*transition-duration:var\(--t-reveal\)/.test(css);
  const shut = /\.reveal\{[^}]*transition:grid-template-rows calc\(var\(--t-reveal\) \* \.8\)/.test(css);
  assert.ok(open && shut, 'the collapse must not hold the user up for as long as the reveal');
});

test('the duration is the researched 200ms, not a guess', () => {
  assert.match(css, /--t-reveal:\.2s/);
});

/* Restoring saved state calls the helper before the user has touched anything.
   The guard has to be dropped after a forced layout read or both class changes
   land in one recalculation and the transition runs regardless. */
test('the instant path suppresses the transition and then releases it', () => {
  const fn = /export function reveal\([\s\S]*?\n}/.exec(js);
  assert.ok(fn, 'the shared helper is gone');
  assert.match(fn[0], /classList\.add\('reveal-now'\)/);
  assert.match(fn[0], /offsetHeight/);
  assert.match(fn[0], /classList\.remove\('reveal-now'\)/);
  assert.match(css, /\.reveal\.reveal-now,\.reveal\.reveal-now > \.reveal-in\{transition:none\}/);
});

test('state read back from the server opens instantly', () => {
  for (const call of [
    "reveal(el('ie-pw-wrap'), !!d.enabled, true)",
    'applyDocker(dockerEnEl.checked, true)',
    'apply(en.checked, true)',
  ]) {
    assert.ok(js.includes(call), `${call} is gone, so the page animates its own sections open after it paints`);
  }
});

/* The rows these wrappers hold used to carry .d-none. Both mechanisms on one
   row leaves it hidden with the wrapper open. */
test('a wrapped row no longer hides itself', () => {
  const ids = [
    'ie-pw',
    'sec-revoke-row',
    'srv-hide-healthy-row',
    'ie-socket',
    'socket-hint',
    'revoke-tip',
    'pw-hint-static',
  ];
  for (const id of ids) {
    const tag = new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(html);
    assert.ok(tag, `${id} is gone from the markup`);
    assert.doesNotMatch(tag[0], /\bd-none\b/, `${id} is inside a disclosure and must not also carry d-none`);
    assert.doesNotMatch(
      js,
      new RegExp(`'${id}'\\)\\.classList\\.toggle\\('d-none'`),
      `${id} is still toggled by class`,
    );
  }
});

/* Three mechanisms used to hide conditional rows: the .d-none class, an inline
   display from `showIf`, and the `hidden` attribute on the app form's sub
   blocks. All three now route through the disclosure. */

const appForm = read('js/admin-app-form.js');
const cfgForm = read('js/widget-config-form.js');

test('the app form sub blocks are disclosures, not hidden attributes', () => {
  for (const id of ['hc-sub', 'static-sub', 'act-sub', 'auth-sub']) {
    const tag = new RegExp(`<div id="${id}"[^>]*>`).exec(appForm);
    assert.ok(tag, `${id} is gone from the app form`);
    assert.match(tag[0], /class="reveal/, `${id} still opens without motion`);
    assert.doesNotMatch(
      tag[0],
      /\bhidden\b/,
      `${id} carries both hidden and .reveal; the class wins and it never hides`,
    );
  }
});

/* A .reveal sets display:grid. That beats the user-agent rule behind the hidden
   attribute, so a disclosure told to hide with `hidden` stays on screen. */
test('nothing hides a disclosure with the hidden attribute', () => {
  assert.match(
    appForm,
    /if \(node\.classList\.contains\('reveal'\)\) reveal\(node, on\);/,
    'the show helper must route a disclosure through the class, never through hidden',
  );
});

test('a conditional widget field is wrapped in a disclosure', () => {
  assert.match(cfgForm, /wrap\.className = b\.el\.classList\.contains\('row'\) \? 'row-wrap reveal' : 'reveal'/);
  assert.match(cfgForm, /if \(b\.wrap\) reveal\(b\.wrap, shown\[i\], first\)/);
});

/* The first pass runs while the card is being built from stored config. */
test('the first showIf pass does not animate', () => {
  const fn = /function _wireShowIf\([\s\S]*?\n}/.exec(cfgForm);
  assert.ok(fn, '_wireShowIf is gone');
  assert.match(fn[0], /let first = true;/);
  assert.match(fn[0], /first = false;/);
});

/* Validation skips a field the user cannot see. It asked the inline style, which
   the disclosure no longer sets. */
test('required-field checks read the disclosure state', () => {
  assert.match(cfgForm, /b\.wrap \? b\.wrap\.classList\.contains\('open'\)/);
});

/* A badge fetch that fails for want of credentials ticks Authentication for the
   user. It already added .open, against a block that hid with `hidden`, so the
   rows stayed shut. */
test('the badge error path opens the authentication rows', () => {
  assert.match(appForm, /authCb\.checked = true;\s*\n\s*if \(authSub\) authSub\.classList\.add\('open'\)/);
  const tag = /<div id="auth-sub"[^>]*>/.exec(appForm);
  assert.match(tag[0], /class="reveal/, 'the class it adds must be the mechanism that shows the rows');
});

/* A view switch rebuilds its form, so there is no element left to open or
   close. The box travels from the old height to the new one instead. */

test('the swap sets its transition inline, not from a class', () => {
  const fn = /export function swapContent\([\s\S]*?\n}/.exec(js);
  assert.ok(fn, 'the swap helper is gone');
  assert.match(fn[0], /box\.style\.transition = 'height var\(--t-reveal\) var\(--ease-reveal\)'/);
  assert.doesNotMatch(css, /\.swapping\{[^}]*transition:height/, 'a class here loses to the disclosure rule');
});

test('the swap always releases the height it pinned', () => {
  const fn = /export function swapContent\([\s\S]*?\n}/.exec(js);
  assert.match(fn[0], /box\.style\.height = '';\s*\n\s*box\.style\.overflow = '';\s*\n\s*box\.style\.transition = '';/);
  assert.match(fn[0], /timer = setTimeout\(end, 600\)/, 'a dropped transition would leave a fixed height forever');
});

test('it reuses the disclosure timing rather than inventing its own', () => {
  assert.match(css, /\.swapping > \*\{animation:swap-in var\(--t-reveal\) var\(--ease-reveal\)\}/);
  assert.match(css, /@keyframes swap-in\{from\{opacity:0\}to\{opacity:1\}\}/);
});

test('every block swap runs through the helper', () => {
  const widgetForm = read('js/admin-widget-form.js');
  assert.match(widgetForm, /swapContent\(body, \(\) => _renderWidgetForm\(body\)\)/, 'the widget view switch');
  assert.match(read('js/admin-settings.js'), /swapContent\(host, \(\) => \{/, 'the wallpaper source');
  assert.match(appForm, /swapContent\(el\('hc-con-row'\)\?\.parentElement, \(\) => \{/, 'container versus ping');
});

/* The clip exists only for the height animation. Left on, it cut off any
   dropdown opened from a revealed row: the filters list inside a widget's
   conditional field was sliced at the card edge. */
test('an opened disclosure stops clipping its content', () => {
  assert.match(css, /\.reveal\.open\.reveal-done > \.reveal-in\{overflow:visible\}/);
  const fn = /export function reveal\([\s\S]*?\n}/.exec(js);
  assert.match(fn[0], /classList\.remove\('reveal-done'\)/, 'the clip must come back before it closes');
  assert.match(fn[0], /classList\.add\('reveal-done'\)/);
});

/* A grid item defaults to min-width:auto, so it refuses to shrink below its
   content. A long URL in a revealed row then made the box wider than the card
   and pushed its edit button outside, and the whole VPN section past the screen
   edge. Same rule as min-height, other axis. */
test('a disclosure can shrink on both axes', () => {
  assert.match(css, /\.reveal > \.reveal-in\{overflow:hidden;min-height:0;min-width:0/);
});
