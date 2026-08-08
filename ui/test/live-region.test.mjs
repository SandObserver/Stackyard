/* Regression tests for P9-9: a page change was never announced.

   A screen reader reads a live region when its contents change, which is how a
   user hears the result of something they just did. The dashboard had one for
   search results and nothing else, so paging swapped the grid in silence.

   That mattered more after the page dots became real buttons: a control that
   can be reached and operated, whose effect is never announced, is arguably
   worse than one that cannot be reached at all.

   Deliberately not extended to health changes. Those are polled rather than
   user-initiated, so announcing them would have a screen reader talk over
   whatever someone is doing whenever a service flaps; the reason a tile is red
   is in its hover text instead. A live region should say what the user did, not
   everything that changes. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('index.html');
const dashboard = read('js/dashboard.js');

/* ── the region ───────────────────────────────────────────────────────────── */

test('the dashboard has a live region for page changes', () => {
  const el = /<div id="page-live"[^>]*>/.exec(html);
  assert.ok(el, 'without one there is nothing for a screen reader to read');
  assert.match(el[0], /aria-live="polite"/, 'assertive would interrupt what the user is doing');
  assert.match(el[0], /aria-atomic="true"/, 'so the whole message is read, not the changed part');
});

/* Announced, not shown: the page number is already visible in the dots. */
test('the region is available to a screen reader but not on screen', () => {
  assert.match(/<div id="page-live"[^>]*>/.exec(html)[0], /class="visually-hidden"/);
  assert.doesNotMatch(/<div id="page-live"[^>]*>/.exec(html)[0], /aria-hidden/,
    'aria-hidden would make the region useless');
});

test('visually-hidden keeps the element rendered', () => {
  /* display:none or visibility:hidden would remove it from the accessibility
     tree, so nothing would be announced. */
  const css = read('css/dashboard.css');
  const block = css.slice(css.indexOf('.visually-hidden {'), css.indexOf('}', css.indexOf('.visually-hidden {')));
  assert.doesNotMatch(block, /display\s*:\s*none/);
  assert.doesNotMatch(block, /visibility\s*:\s*hidden/);
  assert.match(block, /position\s*:\s*absolute/);
});

/* ── what gets announced ──────────────────────────────────────────────────── */

test('the announcement is made where the page changes', () => {
  const goTo = dashboard.slice(dashboard.indexOf('function goTo('), dashboard.indexOf('\n}', dashboard.indexOf('function goTo(')));
  assert.match(goTo, /announcePage\(pg, total\)/);
});

/* Every route to another page, arrow keys, swipes, and the dots, goes through
   goTo, so one announcement covers all of them. */
test('every way of changing page goes through goTo', () => {
  for (const route of [/ArrowRight'\) goTo/, /ArrowLeft'\)\s+goTo/, /touchend[\s\S]{0,200}goTo\(pg/]) {
    assert.match(dashboard, route, 'a page change that bypasses goTo would be silent');
  }
  assert.match(read('js/ui.js'), /onSwipe: dir => goTo\(/);
});

/* Repeating the same page would otherwise announce it again on every click. */
test('nothing is announced when the page did not change', () => {
  const goTo = dashboard.slice(dashboard.indexOf('function goTo('), dashboard.indexOf('\n}', dashboard.indexOf('function goTo(')));
  assert.match(goTo, /const was = pg/);
  assert.match(goTo, /if \(pg !== was\)/);
});

test('the announcement is translated', () => {
  assert.match(dashboard, /t\('home\.pageAnnounce'/);
  for (const file of fs.readdirSync(path.join(root, 'i18n')).filter(f => f.endsWith('.json'))) {
    const cat = JSON.parse(read(`i18n/${file}`));
    assert.ok(cat.home?.pageAnnounce, `${file} is missing home.pageAnnounce`);
    assert.match(cat.home.pageAnnounce, /\{page\}/, `${file} drops {page}`);
    assert.match(cat.home.pageAnnounce, /\{total\}/, `${file} drops {total}`);
  }
});

test('a missing region does not break paging', () => {
  const fn = dashboard.slice(dashboard.indexOf('function announcePage('));
  assert.match(fn.slice(0, 200), /if \(!live\) return/);
});

/* ── health is left alone ─────────────────────────────────────────────────── */

test('health polling does not announce', () => {
  /* Polled rather than user-initiated: announcing it would interrupt. */
  const poll = dashboard.slice(dashboard.indexOf("fetch('/api/health'"));
  assert.doesNotMatch(poll.slice(0, 400), /announcePage|page-live/);
});

/* ── the hidden dots ──────────────────────────────────────────────────────── */

/* Mobile shows its own pill dots and hides the desktop container, but built
   dots into it anyway and pushed them into an array nothing read. */
test('mobile no longer builds dots into a hidden container', () => {
  const ui = read('js/ui.js');
  assert.doesNotMatch(ui, /const de = \[\]/, 'unreachable markup that still had to be kept in step');
  /* Two statements, whether the formatter puts them on one line or two. */
  assert.match(ui, /dw\.style\.cssText\s*=\s*'display:none';\s*dw\.innerHTML\s*=\s*''/,
    'the container is still cleared');
});
