import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mobileMetrics, pillBottom, contentBottom } from '../js/mobile-metrics.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

/* Page scale changes innerWidth, so these are the widths one phone can report. */
const WIDTHS = [320, 375, 393, 414, 430, 786, 1024];

test('the reserved bottom zone always clears the pill', () => {
  for (const vw of WIDTHS) {
    const m = mobileMetrics(vw);
    const pillTop = pillBottom(m) + m.pillH;
    assert.ok(
      contentBottom(m) >= pillTop,
      `vw=${vw}: content may paint down to ${contentBottom(m)} but the pill reaches ${pillTop}`,
    );
  }
});

test('a 36px reserve is what let the pill overlap the last row', () => {
  const m = mobileMetrics(393);
  const oldDz = Math.round(36 * m.sc);
  assert.ok(m.dz > oldDz);
  assert.ok(m.dh + oldDz < pillBottom(m) + m.pillH);
});

test('sc is 1 at the base width and scales linearly', () => {
  assert.equal(mobileMetrics(393).sc, 1);
  assert.equal(mobileMetrics(786).sc, 2);
});

test('every metric scales with sc', () => {
  const a = mobileMetrics(393);
  const b = mobileMetrics(786);
  for (const k of ['sm', 'dh', 'pillH', 'pillGap', 'dz']) {
    assert.equal(b[k], a[k] * 2, `${k} did not double`);
  }
});

/* ── The insets belong to the stylesheet ──────────────────────────────────── */

/* iOS reports an inset after the first paint. A value read into JavaScript at
   build time is the zero it reported before, and nothing re-reads it. */
test('no metric is computed from a safe-area inset', () => {
  const src = read('js/mobile-metrics.js');
  assert.doesNotMatch(src, /env\(/, 'the insets belong in CSS');
  assert.equal(mobileMetrics(393).sb, undefined, 'a top reserve here would compete with the CSS one');
  assert.equal(mobileMetrics(393).safe, undefined);
  assert.equal(mobileMetrics(393).avail, undefined, 'the available height is measured, not computed');
});

test('the layout never reads an inset out of the document', () => {
  const ui = read('js/ui.js');
  assert.doesNotMatch(ui, /safe-area-inset/, 'reading the inset back returns 0 on iOS until it is reported');
  assert.doesNotMatch(ui, /readSafeInsets/);
});

test('the stylesheet holds the insets, with the scaled minimum as the floor', () => {
  const css = read('css/dashboard.css');
  assert.match(css, /--sa-top:\s*max\(env\(safe-area-inset-top\), calc\(18px \* var\(--sc,1\)\)\)/);
  assert.match(css, /--sa-bottom:\s*max\(env\(safe-area-inset-bottom\), calc\(8px \* var\(--sc,1\)\)\)/);
});

test('the page reserves the insets and the grid fills what is left', () => {
  const css = read('css/dashboard.css');
  const page = css.match(/\.mob-page\s*{[^}]*}/)[0];
  assert.match(
    page,
    /padding:var\(--sa-top\) var\(--sm,18px\) calc\(var\(--sa-bottom\) \+ var\(--dh,108px\) \+ var\(--dz,52px\)\)/,
  );
  const grid = css.match(/\.mob-grid\s*{[^}]*}/)[0];
  assert.match(grid, /height:100%/);
  assert.match(grid, /grid-template-rows:repeat\(6,1fr\)/, 'a row height in px would need the inset in JavaScript');
});

test('the layout sizes itself from the measured grid box', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /firstPage\.grid\.getBoundingClientRect\(\)/);
  assert.match(ui, /cw = gridBox\.width \/ COLS/);
  assert.match(ui, /rh = gridBox\.height \/ ROWS/);
});

test('the dock and the pill sit above the CSS inset', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /bottom:var\(--sa-bottom\)/, 'the dock');
  assert.match(ui, /bottom:calc\(var\(--sa-bottom\) \+ \$\{dh \+ pillGap\}px\)/, 'the pill');
});

/* ── The rebuild trigger ──────────────────────────────────────────────────── */

test('a probe sized by the insets drives the rebuild', () => {
  const css = read('css/dashboard.css');
  const probe = css.match(/\.sa-probe\s*{[^}]*}/)[0];
  assert.match(probe, /height:calc\(env\(safe-area-inset-top\) \+ env\(safe-area-inset-bottom\)\)/);
  const dash = read('js/dashboard.js');
  assert.match(dash, /new ResizeObserver\([\s\S]{0,600}?\)\.observe\(probe\)/);
  assert.match(dash, /if \(MOB\) buildLayout\(\)/);
});

test('the first observation does not rebuild what is being built', () => {
  const dash = read('js/dashboard.js');
  assert.match(dash, /_saFirst/, 'observing delivers the current size at once');
});

test('admin reserves the top inset too', () => {
  const css = read('css/admin.css');
  assert.match(css, /html\.is-mobile \.adm-outer\{padding:env\(safe-area-inset-top\) 0 0/);
});
