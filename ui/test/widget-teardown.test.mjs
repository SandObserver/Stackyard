/* mountScaledWidget starts things that outlive the DOM it creates: a
   ResizeObserver on the card, a setTimeout chain reloading the iframe, and
   touch listeners on the iframe's document. It must return a teardown, or
   dropping the card leaves all of it running and still fetching from the
   backing services.

   Two defences, and neither is sufficient alone: teardown stops what a rebuild
   discards, and the orientation guard stops most rebuilds happening at all. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

/* A DOM only as real as mountScaledWidget touches, with counters for the things
   that leaked. Counting them is the point: asserting the functions were called
   would pass for an implementation that still leaks. */
function harness() {
  const counts = { observers: 0, timers: 0, loadListeners: 0 };
  const el = tag => ({
    tagName: tag,
    style: { cssText: '', setProperty() {} },
    children: [],
    parent: null,
    attrs: new Map(),
    listeners: new Map(),
    clientWidth: 100,
    clientHeight: 100,
    src: '',
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
    },
    getAttribute(k) {
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    },
    removeAttribute(k) {
      this.attrs.delete(k);
    },
    appendChild(c) {
      c.parent = this;
      this.children.push(c);
    },
    insertBefore(c, ref) {
      c.parent = this;
      this.children.splice(this.children.indexOf(ref), 0, c);
    },
    remove() {
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    },
    addEventListener(type, fn) {
      if (tag !== 'iframe') return;
      counts.loadListeners++;
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      if (tag !== 'iframe' || !this.listeners.get(type)?.delete(fn)) return;
      counts.loadListeners--;
    },
    fire(type) {
      for (const fn of this.listeners.get(type) || []) fn({ type, currentTarget: this, target: this });
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

  const docListeners = new Set();
  const keyListeners = new Set();
  globalThis.document = {
    createElement: el,
    querySelectorAll: () => [],
    addEventListener(type, fn) {
      if (type === 'visibilitychange') docListeners.add(fn);
      if (type === 'keydown') keyListeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'visibilitychange') docListeners.delete(fn);
      if (type === 'keydown') keyListeners.delete(fn);
    },
  };
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
    realSetTimeout,
    docListeners,
    keyListeners,
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
    const { mountScaledWidget, teardownWidgets } = await import('../js/widget-frame.js');
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
    const { mountScaledWidget, teardownWidgets } = await import('../js/widget-frame.js');
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

test('teardown removes the Escape hand-off of a bundled widget', async () => {
  const h = harness();
  try {
    const { mountScaledWidget, teardownWidgets } = await import('../js/widget-frame.js');
    mountScaledWidget(h.card(), { ...OPTS, src: '/widgets/weather/index.html?id=w' });
    assert.equal(h.keyListeners.size, 1, 'a bundled widget listens for Escape on the dashboard');
    teardownWidgets();
    assert.equal(h.keyListeners.size, 0, 'teardown leaves a keydown listener');
  } finally {
    h.done();
  }
});

test('teardown with nothing mounted is safe', async () => {
  const h = harness();
  try {
    const { teardownWidgets } = await import('../js/widget-frame.js');
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
    const { mountScaledWidget, teardownWidgets } = await import('../js/widget-frame.js');
    mountScaledWidget(h.card(), { ...OPTS, iframeOpts: {} });
    assert.equal(h.counts.timers, 0);
    teardownWidgets();
    assert.equal(h.counts.observers, 0);
  } finally {
    h.done();
  }
});

/* A refresh mounts a new frame. Navigating the old one adds a Back entry
   (src) or sends the dashboard's referrer policy instead of the frame's
   (location.replace). */
async function refreshing(h, run, { loadWait } = {}) {
  const frames = [];
  const make = globalThis.document.createElement;
  globalThis.document.createElement = tag => {
    const e = make(tag);
    if (tag === 'iframe') {
      e.contentWindow = {
        location: {
          replace: () => {
            throw new Error('the old frame was navigated');
          },
        },
      };
      frames.push(e);
    }
    return e;
  };
  if (loadWait) {
    const st = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => st(fn, ms > 1000 ? loadWait : ms);
  }
  globalThis.document.hidden = false;
  globalThis.location = { href: 'http://dash.local/', origin: 'http://dash.local' };
  const card = h.card();
  const { mountScaledWidget, teardownWidgets } = await import('../js/widget-frame.js');
  try {
    mountScaledWidget(card, { ...OPTS, iframeOpts: { refreshInterval: 250 } });
    await run({ frames, clip: card.children[0], wait: ms => new Promise(r => h.realSetTimeout(r, ms)) });
  } finally {
    teardownWidgets();
    delete globalThis.location;
    h.done();
  }
}

test('a refresh loads a new frame that keeps the referrer policy and sandbox', async () => {
  const h = harness();
  await refreshing(h, async ({ frames, clip, wait }) => {
    const first = frames[0].src;
    await wait(800);
    assert.equal(frames.length, 2, 'one refresh frame at a time');
    const [old, next] = frames;
    assert.equal(old.src, first, 'src was reassigned, which adds a Back entry');
    assert.match(next.src, /^http:\/\/svc\/w\?_r=\d+$/);
    assert.equal(next.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
    assert.equal(next.getAttribute('sandbox'), old.getAttribute('sandbox'));
    assert.ok(next.getAttribute('sandbox'), 'a cross-origin frame is sandboxed');
    assert.equal(next.getAttribute('aria-label'), old.getAttribute('aria-label'));
    assert.deepEqual(clip.children, [next, old], 'the new frame loads under the one on screen');
    assert.equal(next.getAttribute('aria-hidden'), 'true');

    next.fire('load');
    assert.deepEqual(clip.children, [next], 'the old frame stays after the new one loaded');
    assert.equal(next.getAttribute('aria-hidden'), null);
    assert.equal(next.style.opacity, '1');
    assert.equal(old.listeners.get('load')?.size ?? 0, 0, 'the old frame keeps its listeners');
  });
});

test('a refresh frame that never loads is dropped and the next tick tries again', async () => {
  const h = harness();
  await refreshing(
    h,
    async ({ frames, clip, wait }) => {
      await wait(1000);
      assert.ok(frames.length >= 3, `${frames.length - 1} refresh frames in 1 s`);
      assert.ok(clip.children.includes(frames[0]), 'the frame on screen was removed');
      assert.ok(clip.children.length <= 2, `${clip.children.length} frames in the card`);
      for (const f of frames.slice(1, -1)) assert.equal(f.parent, null, 'a frame that never loaded stays');
    },
    { loadWait: 50 },
  );
});

test('teardown removes a refresh frame that is still loading', async () => {
  const h = harness();
  const { teardownWidgets } = await import('../js/widget-frame.js');
  await refreshing(h, async ({ frames, clip, wait }) => {
    await wait(800);
    teardownWidgets();
    assert.equal(frames.length, 2);
    assert.equal(frames[1].parent, null, 'the loading frame stays in the card');
    assert.equal(frames[1].src, 'about:blank');
    assert.equal(frames[0].src, 'about:blank');
    assert.deepEqual(clip.children, [frames[0]]);
    assert.equal(h.counts.timers, 0, 'a timer outlives teardown');
    assert.equal(h.counts.loadListeners, 0, 'a frame listener outlives teardown');
  });
});

test('teardown after a refresh releases the new frame', async () => {
  const h = harness();
  const { teardownWidgets } = await import('../js/widget-frame.js');
  await refreshing(h, async ({ frames, wait }) => {
    await wait(800);
    frames[1].fire('load');
    teardownWidgets();
    assert.equal(frames[1].src, 'about:blank');
    assert.equal(h.counts.timers, 0, 'a timer outlives teardown');
    assert.equal(h.counts.loadListeners, 0, 'a frame listener outlives teardown');
  });
});

test('a hidden tab does not reload its widgets, and catches up on return', async () => {
  const h = harness();
  const frames = [];
  const make = globalThis.document.createElement;
  globalThis.document.createElement = tag => {
    const e = make(tag);
    if (tag === 'iframe') frames.push(e);
    return e;
  };
  globalThis.document.hidden = true;
  const wait = ms => new Promise(r => h.realSetTimeout(r, ms));
  const { mountScaledWidget, teardownWidgets } = await import('../js/widget-frame.js');
  try {
    mountScaledWidget(h.card(), { ...OPTS, iframeOpts: { refreshInterval: 250 } });
    await wait(800);
    assert.equal(frames.length, 1, 'reloaded while hidden');
    globalThis.document.hidden = false;
    for (const fn of h.docListeners) fn();
    assert.equal(frames.length, 2, 'a reload missed while hidden runs on return');
  } finally {
    teardownWidgets();
    h.done();
  }
  assert.equal(h.docListeners.size, 0, 'teardown leaves a visibility listener');
});
