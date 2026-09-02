import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mobileMetrics,
  pillBottom,
  contentBottom,
  gridColumnWidth,
  gridCellCount,
  BASE_CELL_W,
  BASE_CELL_H,
} from '../js/mobile-metrics.js';

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

test('sc is 1 at the base width and scales linearly up to the cap', () => {
  assert.equal(mobileMetrics(393).sc, 1);
  assert.equal(mobileMetrics(393 / 2).sc, 0.5);
  assert.equal(mobileMetrics(430).sc, 430 / 393, 'the widest phone must not be capped');
});

/* Past the cap the grid answers a wider box with more cells. Letting the chrome
   keep growing would draw a dock half as large again as the icons beside it. */
test('sc stops growing above the cap', () => {
  assert.equal(mobileMetrics(786).sc, mobileMetrics(1400).sc);
  assert.ok(mobileMetrics(786).sc < 786 / 393);
});

test('every metric scales with sc', () => {
  const a = mobileMetrics(393 / 2);
  const b = mobileMetrics(393);
  for (const k of ['sm', 'dh', 'pillH', 'pillGap', 'dz']) {
    assert.equal(b[k], a[k] * 2, `${k} did not double`);
  }
});

/* ── The insets belong to the stylesheet ──────────────────────────────────── */

/* The platform reports an inset after the first paint. A value read into JavaScript at
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
  assert.doesNotMatch(ui, /safe-area-inset/, 'reading the inset back returns 0 until the platform reports it');
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
  assert.match(
    grid,
    /grid-template-rows:repeat\(var\(--mrows,6\),1fr\)/,
    'a row height in px would need the inset in JavaScript',
  );
  assert.match(grid, /grid-template-columns:repeat\(var\(--mcols,4\),1fr\)/);
});

test('the layout sizes itself from the measured grid box', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /firstPage\.grid\.getBoundingClientRect\(\)/);
  assert.match(ui, /gridW: gridBox\.width/, 'the column width is derived from the measured box');
  assert.match(ui, /const cw = gridW \/ COLS/);
  assert.match(ui, /rh = gridBox\.height \/ ROWS/);
});

/* The dock is sized to its contents, so the side gap is a cap rather than a
   measurement: a full dock clears the edge by dockGap, a shorter one by more. */
test('a full dock sits the same distance from the bottom as from the sides', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /const dockGap = Math\.round\(9 \* sc\)/);
  assert.match(ui, /const maxDockW = vw - Math\.round\(18 \* sc\)/, 'a side gap of dockGap on each edge');
  assert.match(ui, /bottom:\$\{dockGap\}px/, 'the dock');
  assert.match(ui, /bottom:\$\{dockGap \+ dh \+ pillGap\}px/, 'the pill');
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

/* ── Widget cards fit, and stay on one modular grid ───────────────────────── */

const COLS = 4,
  ROWS = 6;
const FOOTPRINT = { small: [2, 2], medium: [4, 2], large: [4, 4], xlarge: [4, 6] };
const DESIGN = { small: [170, 170], medium: [360, 170], large: [360, 360], xlarge: [360, 540] };
const ALL = Object.keys(FOOTPRINT).map(sz => ({ design: DESIGN[sz], span: FOOTPRINT[sz] }));

/* Every width one phone can report, plus a short height for each. */
const VIEWPORTS = [
  [320, 568],
  [375, 667],
  [390, 844],
  [393, 695],
  [393, 745],
  [430, 932],
  [500, 800],
  [600, 800],
  [700, 857],
  [768, 900],
];

function geometry(vw, vh, footprints = ALL) {
  const m = mobileMetrics(vw);
  const gap = Math.round(m.sm * 0.5);
  const gridW = vw - m.sm * 2;
  const rowH = (vh - m.dh - m.dz - gap * (ROWS - 1)) / ROWS;
  return { gap, rowH, colW: gridColumnWidth({ gridW, rowH, gap, cols: COLS, footprints }) };
}

const cardW = (g, cols) => g.colW * cols + g.gap * (cols - 1);
const cellH = (g, rows) => g.rowH * rows + g.gap * (rows - 1);

test('no widget card is taller than the rows it spans', () => {
  for (const [vw, vh] of VIEWPORTS) {
    const g = geometry(vw, vh);
    for (const [size, [cols, rows]] of Object.entries(FOOTPRINT)) {
      const design = DESIGN[size];
      const h = (cardW(g, cols) * design[1]) / design[0];
      assert.ok(
        h <= cellH(g, rows) + 1,
        `${vw}x${vh} ${size}: card ${Math.round(h)} tall in ${Math.round(cellH(g, rows))}`,
      );
    }
  }
});

/* The invariant the grid's alignment rests on. Fitting each card to its own
   cell satisfies the height rule above and breaks this one. */
test('two small widgets measure the same as one medium', () => {
  for (const [vw, vh] of VIEWPORTS) {
    const g = geometry(vw, vh);
    const twoSmall = cardW(g, 2) * 2 + g.gap;
    assert.equal(Math.round(twoSmall), Math.round(cardW(g, 4)), `${vw}x${vh}`);
  }
});

test('a card never exceeds the grid it sits in', () => {
  for (const [vw, vh] of VIEWPORTS) {
    const m = mobileMetrics(vw);
    const g = geometry(vw, vh);
    assert.ok(cardW(g, COLS) <= vw - m.sm * 2 + 1, `${vw}x${vh}`);
  }
});

test('the columns only narrow when a widget shape needs them to', () => {
  const vw = 393,
    vh = 745;
  const m = mobileMetrics(vw);
  const gap = Math.round(m.sm * 0.5);
  const full = (vw - m.sm * 2 - gap * (COLS - 1)) / COLS;
  assert.equal(geometry(vw, vh, []).colW, Math.floor(full), 'a page with no widgets must keep the full column');
  assert.ok(geometry(vw, vh).colW <= Math.floor(full));
});

/* Widths above the cutoff take the desktop layout, so the phone grid is never
   asked to fill them. This pins why the cutoff exists. */
test('the phone grid cannot fill a window past the cutoff', () => {
  const wide = geometry(700, 857);
  const m = mobileMetrics(700);
  const gap = Math.round(m.sm * 0.5);
  const full = (700 - m.sm * 2 - gap * (COLS - 1)) / COLS;
  assert.ok(wide.colW < Math.floor(full) * 0.9);
});

test('the grid does not narrow at the size the layout is drawn for', () => {
  const vw = 393,
    vh = 852;
  const m = mobileMetrics(vw);
  const gap = Math.round(m.sm * 0.5);
  const full = Math.floor((vw - m.sm * 2 - gap * (COLS - 1)) / COLS);
  const sizes = ['small', 'medium', 'large'].map(sz => ({ design: DESIGN[sz], span: FOOTPRINT[sz] }));
  assert.equal(geometry(vw, vh, sizes).colW, full);
});

/* An xlarge widget is 4 cells wide and 6 tall against a design that is taller
   than it is wide, so it cannot fill a short grid at any width. It narrows the
   whole grid with it. */
test('an xlarge widget narrows the grid for everything else', () => {
  const only = sz => [{ design: DESIGN[sz], span: FOOTPRINT[sz] }];
  assert.ok(geometry(500, 700, only('xlarge')).colW < geometry(500, 700, only('medium')).colW);
});

test('the layout sizes its grid from one shared column width', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /gridColumnWidth\(/, 'the column width must come from the shared rule');
  assert.doesNotMatch(ui, /widgetCardWidth/, 'per-card fitting breaks the modular grid');
});

/* ── The grid answers a wider box with more cells ─────────────────────────── */

function cells(vw, vh) {
  const m = mobileMetrics(vw);
  return gridCellCount({ gridW: vw - m.sm * 2, gridH: vh - m.dh - m.dz, sc: m.sc });
}

/* Every phone must land on the layout the design was drawn for. */
test('no phone width changes the cell count', () => {
  for (const [vw, vh] of [
    [320, 568],
    [375, 667],
    [390, 844],
    [393, 695],
    [393, 852],
    [414, 896],
    [430, 932],
  ]) {
    assert.deepEqual(cells(vw, vh), { cols: 4, rows: 6 }, `${vw}x${vh}`);
  }
});

test('a wider box gets more columns, not wider ones', () => {
  const narrow = cells(430, 900);
  const wide = cells(768, 900);
  assert.ok(wide.cols > narrow.cols);
  const m = mobileMetrics(768);
  const gap = Math.round(m.sm * 0.5);
  const cellW = (768 - m.sm * 2 - gap * (wide.cols - 1)) / wide.cols;
  assert.ok(Math.abs(cellW - BASE_CELL_W * m.sc) < BASE_CELL_W * 0.35, `cell drifted to ${Math.round(cellW)}`);
});

test('a taller box gets more rows, not taller ones', () => {
  assert.ok(cells(820, 1366).rows > cells(820, 700).rows);
  const m = mobileMetrics(820);
  const gap = Math.round(m.sm * 0.5);
  const r = cells(820, 1366).rows;
  const cellH = (1366 - m.dh - m.dz - gap * (r - 1)) / r;
  assert.ok(Math.abs(cellH - BASE_CELL_H * m.sc) < BASE_CELL_H * 0.35, `cell drifted to ${Math.round(cellH)}`);
});

/* The tallest footprint is 6 rows. A shorter grid can never place it, and the
   packer would open a page for it forever. */
test('the grid never has fewer rows than the tallest widget', () => {
  for (const vh of [400, 500, 568, 600, 700, 852, 1180]) {
    assert.ok(cells(393, vh).rows >= FOOTPRINT.xlarge[1], `vh=${vh}`);
  }
});

test('the grid never has fewer columns than the widest widget', () => {
  const widest = Math.max(...Object.values(FOOTPRINT).map(f => f[0]));
  for (const vw of [280, 320, 375, 430, 768]) {
    assert.ok(cells(vw, 800).cols >= widest, `vw=${vw}`);
  }
});

test('the layout reads its cell count from the measured box', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /gridCellCount\(\{ gridW: gridBox\.width, gridH: gridBox\.height/);
  assert.doesNotMatch(ui, /const COLS = 4,\n\s*ROWS = 6;/, 'a fixed grid is what stretched across a tablet');
  assert.match(ui, /'--mcols'/);
  assert.match(ui, /'--mrows'/);
});

/* ── The dock is sized by what it holds ───────────────────────────────────── */

/* The grid gains columns on a wide screen while the dock keeps four icons. A
   dock stretched to the window then reads as an empty bar. */
test('the dock is sized to its contents, not to the window', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /const dockW = Math\.min\(maxDockW, dockContentW\)/);
  assert.doesNotMatch(ui, /const dockW = vw - Math\.round\(18 \* sc\)/, 'the dock still spans the window');
});

test('the dock never grows past the window', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /const maxDockW = vw - Math\.round\(18 \* sc\)/, 'the width cap is gone');
});

/* An empty dock has no contents to size to. */
test('an empty dock keeps a width', () => {
  const ui = read('js/ui.js');
  assert.match(ui, /dock\.length\s*\?[\s\S]{0,160}:\s*maxDockW/);
});
