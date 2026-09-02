/* mountScaledWidget starts things that outlive the DOM it creates: a
   ResizeObserver on the card, a setTimeout chain reloading the iframe, and
   touch listeners on the iframe's document. It must return a teardown, or
   dropping the card leaves all of it running and still fetching from the
   backing services.

   Two defences, and neither is sufficient alone: teardown stops what a rebuild
   discards, and the orientation guard stops most rebuilds happening at all. */

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
    clientWidth: 100,
    clientHeight: 100,
    src: '',
    setAttribute() {},
    removeAttribute() {},
    appendChild(c) {
      this.children.push(c);
    },
    addEventListener() {
      if (tag === 'iframe') counts.loadListeners++;
    },
    removeEventListener() {
      if (tag === 'iframe') counts.loadListeners--;
    },
    get contentDocument() {
      return null;
    },
  });

  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const restore = {
    document: globalThis.document,
    window: globalThis.window,
    raf: globalThis.requestAnimationFrame,
    ro: globalThis.ResizeObserver,
    st: realSetTimeout,
    ct: realClearTimeout,
  };

  globalThis.document = { createElement: el, querySelectorAll: () => [] };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.requestAnimationFrame = () => {};
  globalThis.setTimeout = (fn, ms) => {
    counts.timers++;
    return realSetTimeout(() => {
      counts.timers--;
      fn();
    }, ms);
  };
  globalThis.clearTimeout = h => {
    counts.timers--;
    return realClearTimeout(h);
  };
  globalThis.ResizeObserver = class {
    constructor() {
      counts.observers++;
    }
    observe() {}
    disconnect() {
      counts.observers--;
    }
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
  } finally {
    h.done();
  }
});

/* Repeated rebuilds, which is what makes a stranded observer or timer
   accumulate. */
test('repeated rebuilds do not accumulate observers or timers', async () => {
  const h = harness();
  try {
    const { mountScaledWidget, teardownWidgets } = await import('../js/utils.js');
    const mountSix = () => {
      for (let i = 0; i < 6; i++) mountScaledWidget(h.card(), OPTS);
    };

    mountSix();
    for (let r = 0; r < 20; r++) {
      teardownWidgets();
      mountSix();
    }

    assert.equal(h.counts.observers, 6, `21 rebuilds left ${h.counts.observers} observers`);
    assert.equal(h.counts.timers, 6, `21 rebuilds left ${h.counts.timers} reload timers`);

    teardownWidgets();
    assert.equal(h.counts.observers, 0);
    assert.equal(h.counts.timers, 0);
  } finally {
    h.done();
  }
});

test('teardown with nothing mounted is safe', async () => {
  const h = harness();
  try {
    const { teardownWidgets } = await import('../js/utils.js');
    assert.doesNotThrow(() => teardownWidgets());
    assert.doesNotThrow(() => {
      teardownWidgets();
      teardownWidgets();
    });
  } finally {
    h.done();
  }
});

test('a widget with no refresh interval starts no timer to leak', async () => {
  const h = harness();
  try {
    const { mountScaledWidget, teardownWidgets } = await import('../js/utils.js');
    mountScaledWidget(h.card(), { ...OPTS, iframeOpts: {} });
    assert.equal(h.counts.timers, 0);
    teardownWidgets();
    assert.equal(h.counts.observers, 0);
  } finally {
    h.done();
  }
});

/* ── the wiring, checked as source ────────────────────────────────────────── */

test('both build paths tear down before replacing the DOM', () => {
  for (const [file, fn] of [
    ['js/dashboard.js', 'buildDesktop'],
    ['js/ui.js', 'buildMobile'],
  ]) {
    const src = read(file);
    const at = src.indexOf(`function ${fn}(`);
    assert.ok(at !== -1, `${fn} not found in ${file}`);
    const head = src.slice(at, at + 400);
    assert.match(head, /teardownWidgets\(\)/, `${fn} must tear down before rebuilding`);
    /* Before the clear, or the previous widgets are already unreachable. */
    assert.ok(
      head.indexOf('teardownWidgets()') < head.indexOf('BEL.clear()'),
      `${fn} tears down after clearing, which is too late`,
    );
  }
});

/* A rebuild discards every widget iframe, so it must happen only when the
   layout actually changes. The keyboard opening on a phone resizes the visual
   viewport, and rebuilding on that throws the dashboard away mid-typing.

   The desktop tile size follows the viewport, so that layout does repaginate on
   a resize. Three things bound it: mobile leaves before the timer is armed, the
   timer debounces, and a resize that does not change the slot count returns
   without rebuilding. */
test('a resize rebuilds only when the desktop slot count changes', () => {
  const src = read('js/dashboard.js');
  assert.doesNotMatch(src, /visualViewport\?\.addEventListener/, 'the phone keyboard resizes this one');
  const at = src.indexOf("addEventListener('resize'");
  assert.ok(at !== -1, 'the desktop layout needs a resize listener to repaginate');
  assert.equal(src.indexOf("addEventListener('resize'", at + 1), -1, 'one resize listener only');
  const body = src.slice(at, at + 500);
  assert.match(body, /if \(MOB\) return;[\s\S]*clearTimeout/, 'mobile must leave before the debounce is armed');
  assert.match(body, /setTimeout\(/, 'an undebounced resize rebuilds on every pixel');
  assert.match(body, /if \(slots === _slots\) return;/, 'a resize that changes nothing must not rebuild');
});

/* A media query reports the crossing itself, once, rather than every resize
   that happens to be on the same side of the breakpoint. */
test('the rebuild is driven by the shared layout rule', () => {
  const src = read('js/dashboard.js');
  assert.match(src, /import \{[^}]*onLayoutChange[^}]*\} from '\/js\/layout\.js/);
  assert.match(src, /onLayoutChange\(mobile => \{/, 'the layout change is what triggers a rebuild');
});
