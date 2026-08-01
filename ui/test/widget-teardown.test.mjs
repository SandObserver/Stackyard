/* Regression tests for P8-2 and P9-1, which are one defect.

   mountScaledWidget starts things that outlive the DOM it creates: a
   ResizeObserver on the card, a setTimeout chain reloading the iframe, and touch
   listeners on the iframe's document. It returned only the iframe, so no caller
   could stop any of it. Dropping the card removed the iframe and left the rest
   running.

   That compounded because a rebuild is cheap to trigger. buildMobile and
   buildDesktop replace the whole DOM and remount every widget, and _rebuild ran
   on any viewport change: on a phone, opening the keyboard resizes the visual
   viewport, so tapping the search box rebuilt the dashboard. Each pass stranded
   one observer and one reload timer per widget, and those timers went on
   fetching from the backing services forever. A phone left open for a day
   accumulated dozens of invisible widgets all still polling.

   Fixed in two places, and neither is sufficient alone: teardown stops what a
   rebuild discards, and the orientation guard stops most rebuilds happening at
   all. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

/* A DOM only as real as mountScaledWidget touches, with counters for the things
   that leaked. Counting them is the point: asserting the functions were called
   would pass for an implementation that still leaks. */
function harness() {
  const counts = { observers: 0, timers: 0, loadListeners: 0 };
  const el = tag => ({
    tagName: tag,
    style: { cssText: '', setProperty() {} },
    children: [],
    clientWidth: 100, clientHeight: 100,
    src: '',
    setAttribute() {}, removeAttribute() {},
    appendChild(c) { this.children.push(c); },
    addEventListener() { if (tag === 'iframe') counts.loadListeners++; },
    removeEventListener() { if (tag === 'iframe') counts.loadListeners--; },
    get contentDocument() { return null; },
  });

  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const restore = {
    document: globalThis.document, window: globalThis.window,
    raf: globalThis.requestAnimationFrame, ro: globalThis.ResizeObserver,
    st: realSetTimeout, ct: realClearTimeout,
  };

  globalThis.document = { createElement: el, querySelectorAll: () => [] };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.requestAnimationFrame = () => {};
  globalThis.setTimeout = (fn, ms) => { counts.timers++; return realSetTimeout(() => { counts.timers--; fn(); }, ms); };
  globalThis.clearTimeout = h => { counts.timers--; return realClearTimeout(h); };
  globalThis.ResizeObserver = class {
    constructor() { counts.observers++; }
    observe() {}
    disconnect() { counts.observers--; }
  };

  return {
    counts,
    card: () => el('div'),
    done() {
      globalThis.document = restore.document;
      globalThis.window = restore.window;
      globalThis.requestAnimationFrame = restore.raf;
      globalThis.ResizeObserver = restore.ro;
      globalThis.setTimeout = restore.st;
      globalThis.clearTimeout = restore.ct;
    },
  };
}

const OPTS = { src: 'http://svc/w', title: 'w', design: [400, 300], iframeOpts: { refreshInterval: 30000 } };

test('teardown releases what a mount started', async () => {
  const h = harness();
  try {
    const { mountScaledWidget, teardownWidgets } = await import('../js/utils.js');
    mountScaledWidget(h.card(), OPTS);
    assert.equal(h.counts.observers, 1, 'the card is observed while mounted');
    assert.equal(h.counts.timers, 1, 'and the reload timer is running');

    teardownWidgets();
    assert.equal(h.counts.observers, 0, 'the observer must be disconnected');
    assert.equal(h.counts.timers, 0, 'and the reload timer stopped');
  } finally { h.done(); }
});

/* The behaviour that made this matter: repeated rebuilds. Before, twenty passes
   left 120 observers and 120 live timers still polling the backing services. */
test('repeated rebuilds do not accumulate observers or timers', async () => {
  const h = harness();
  try {
    const { mountScaledWidget, teardownWidgets } = await import('../js/utils.js');
    const mountSix = () => { for (let i = 0; i < 6; i++) mountScaledWidget(h.card(), OPTS); };

    mountSix();
    for (let r = 0; r < 20; r++) { teardownWidgets(); mountSix(); }

    assert.equal(h.counts.observers, 6, `21 rebuilds left ${h.counts.observers} observers`);
    assert.equal(h.counts.timers, 6, `21 rebuilds left ${h.counts.timers} reload timers`);

    teardownWidgets();
    assert.equal(h.counts.observers, 0);
    assert.equal(h.counts.timers, 0);
  } finally { h.done(); }
});

test('teardown with nothing mounted is safe', async () => {
  const h = harness();
  try {
    const { teardownWidgets } = await import('../js/utils.js');
    assert.doesNotThrow(() => teardownWidgets());
    assert.doesNotThrow(() => { teardownWidgets(); teardownWidgets(); });
  } finally { h.done(); }
});

test('a widget with no refresh interval starts no timer to leak', async () => {
  const h = harness();
  try {
    const { mountScaledWidget, teardownWidgets } = await import('../js/utils.js');
    mountScaledWidget(h.card(), { ...OPTS, iframeOpts: {} });
    assert.equal(h.counts.timers, 0);
    teardownWidgets();
    assert.equal(h.counts.observers, 0);
  } finally { h.done(); }
});

/* ── the wiring, checked as source ────────────────────────────────────────── */

test('both build paths tear down before replacing the DOM', () => {
  for (const [file, fn] of [['js/dashboard.js', 'buildDesktop'], ['js/ui.js', 'buildMobile']]) {
    const src = read(file);
    const at = src.indexOf(`function ${fn}(`);
    assert.ok(at !== -1, `${fn} not found in ${file}`);
    const head = src.slice(at, at + 400);
    assert.match(head, /teardownWidgets\(\)/, `${fn} must tear down before rebuilding`);
    /* Before the clear, or the previous widgets are already unreachable. */
    assert.ok(head.indexOf('teardownWidgets()') < head.indexOf('BEL.clear()'),
      `${fn} tears down after clearing, which is too late`);
  }
});

/* The rebuild is only needed when orientation changes. Without this guard the
   keyboard opening on a phone rebuilt the entire dashboard. */
test('a rebuild is skipped when the orientation has not changed', () => {
  const src = read('js/dashboard.js');
  assert.match(src, /const landscape = innerWidth > innerHeight;\s*\n\s*if \(landscape === _wasLandscape\) return;/,
    'the orientation guard is missing or reshaped');
  assert.match(src, /_wasLandscape = landscape;/, 'and it must record the new orientation');
});

test('the guard starts unset, so the first rebuild still runs', () => {
  assert.match(read('js/dashboard.js'), /let _wasLandscape = null;/);
});
