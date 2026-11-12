import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register('./js-root-hooks.mjs', import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const { wallpaperBox, bitmapSize, unitColour, createGlass } = await import('../js/glass.js');

test('the wallpaper box matches a covering background', () => {
  assert.deepEqual(wallpaperBox(1600, 1600, 'cover', 400, 800), [-200, 0, 800, 800]);
  assert.deepEqual(wallpaperBox(400, 200, 'cover', 400, 800), [-600, 0, 1600, 800]);
});

test('the wallpaper box matches a contained background', () => {
  assert.deepEqual(wallpaperBox(1600, 1600, 'contain', 400, 800), [0, 200, 400, 400]);
});

test('the wallpaper bitmap never exceeds the GPU texture limit', () => {
  assert.deepEqual(bitmapSize(6000, 1000, 5064, 4096), [4096, 683]);
  assert.deepEqual(bitmapSize(6000, 8000, 3840, 4096), [3072, 4096]);
  assert.deepEqual(bitmapSize(1000, 800, 1600, 4096), [1000, 800], 'a small picture is not enlarged');
  assert.deepEqual(bitmapSize(3000, 2000, 1500, 4096), [1500, 1000], 'a large picture shrinks to its shown width');
});

test('the folder frost is read from the folder fill in either colour syntax', () => {
  assert.deepEqual(unitColour('rgb(102 102 102 / .5)'), [0.4, 0.4, 0.4, 0.5]);
  assert.deepEqual(unitColour('rgba(255,255,255,.55)'), [1, 1, 1, 0.55]);
  assert.deepEqual(unitColour('rgb(0, 0, 0)'), [0, 0, 0, 1]);
});

/* The GPU draws glass where CSS draws it. A selector in one list and not the
   other gives glass with no bend, or a bend with no glass. */
test('the GPU glass list and the CSS rim list name the same elements', () => {
  const js = read('js/glass.js');
  const list = /const GLASS =\s*'([^']+)'/.exec(js)?.[1];
  assert.ok(list, 'the glass list moved');
  const css = read('css/dashboard.css');
  const rim = /(\.glass-surface::before,[^{]+)\{/.exec(css)?.[1] ?? '';
  const fromCss = rim
    .split(',')
    .map(s => s.trim().replace(/::before$/, ''))
    .filter(Boolean)
    .sort();
  assert.ok(fromCss.length > 0, 'the rim rule moved');
  assert.deepEqual(
    list
      .split(',')
      .map(s => s.trim())
      .sort(),
    fromCss,
  );
});

test('the GPU layer stays out of reach of the pointer', () => {
  assert.match(read('css/dashboard.css'), /\.glass-canvas, \.glass-folder-canvas \{[^}]*pointer-events:none/);
});

/** A WebGL2 stand-in: every call succeeds, and texImage2D reports the error given. */
function fakeGl(uploadError = 0) {
  let pending = 0;
  const constants = { NO_ERROR: 0, INVALID_VALUE: 0x501, MAX_TEXTURE_SIZE: 0xd33 };
  return new Proxy(constants, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'getParameter') return () => 4096;
      if (key === 'getError') return () => [pending, (pending = 0)][0];
      if (key === 'texImage2D') return () => (pending = uploadError);
      if (key === 'getProgramParameter') return (_p, what) => (what === undefined ? 0 : true);
      if (key === 'getShaderParameter') return () => true;
      if (key === 'getActiveUniform') return () => null;
      return () => ({});
    },
  });
}

test('the renderer refuses a picture the GPU cannot take', async () => {
  const { createGlassRenderer } = await import('../js/glass-gpu.js');
  const canvas = gl => /** @type {any} */ ({ getContext: () => gl });
  const ok = createGlassRenderer(canvas(fakeGl()));
  assert.ok(ok);
  assert.equal(ok.maxSize, 4096);
  assert.equal(ok.setWallpaper(/** @type {any} */ ({ width: 4096, height: 683 }), [0, 0, 1, 1], 0), true);
  assert.equal(ok.setWallpaper(/** @type {any} */ ({ width: 5064, height: 844 }), [0, 0, 1, 1], 0), false);
  assert.equal(ok.setWallpaper(null, [0, 0, 1, 1], 0), true);
  const refused = createGlassRenderer(canvas(fakeGl(0x501)));
  assert.equal(refused?.setWallpaper(/** @type {any} */ ({ width: 100, height: 100 }), [0, 0, 1, 1], 0), false);
});

test('a translucent card turns solid under reduced transparency', () => {
  assert.match(
    read('css/dashboard.css'),
    /html\[data-transparency="reduce"\] :is\(\.widget, \.mob-widget-card\)\[data-card="translucent"\] \{\s*background:var\(--glass-card-solid\); -webkit-backdrop-filter:none; backdrop-filter:none;/,
  );
});

/* ── The glass engine on a stand-in page ─────────────────────────────────── */

class FakeEl {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.attrs = new Map();
    this.children = [];
    this.parentElement = null;
    this.isConnected = false;
    this.hidden = false;
    this.className = '';
    this.dataset = {};
    this.glass = false;
    this.offsetWidth = 100;
    this.style = { getPropertyValue: () => '' };
    this.listeners = {};
  }
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
  }
  removeAttribute(k) {
    this.attrs.delete(k);
  }
  hasAttribute(k) {
    return this.attrs.has(k);
  }
  addEventListener(type, fn) {
    this.listeners[type] ??= [];
    this.listeners[type].push(fn);
  }
  dispatch(type) {
    for (const fn of this.listeners[type] ?? []) fn({ preventDefault() {} });
  }
  append(child) {
    this.children.push(child);
    child.parentElement = this;
    child.isConnected = this.isConnected;
  }
  prepend(child) {
    this.append(child);
  }
  matches() {
    return this.glass;
  }
  closest() {
    return null;
  }
  querySelectorAll() {
    return this.children.filter(c => c.glass);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50 };
  }
  checkVisibility() {
    return true;
  }
}

/** A page, a window and a GPU, all recorded. */
function harness({ webgl = true, accept = () => true } = {}) {
  const doc = {
    documentElement: Object.assign(new FakeEl('html'), { clientWidth: 400 }),
    body: Object.assign(new FakeEl('body'), { isConnected: true }),
    createElement: tag => new FakeEl(tag),
    querySelectorAll: sel => doc.body.querySelectorAll(sel),
  };
  const observers = [];
  const timers = [];
  const idle = [];
  const winListeners = {};
  const bitmaps = [];
  const renderers = [];
  const frames = { fn: null };
  const log = [];
  let scripted = false;
  const win = {
    Element: FakeEl,
    innerWidth: 400,
    innerHeight: 800,
    location: { origin: 'http://host' },
    getComputedStyle: () => ({
      getPropertyValue: name => ({ '--glass-folder': 'rgb(107 107 112 / .5)', '--folder-blur': '20' })[name] ?? '',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      borderTopLeftRadius: '20px',
      opacity: '1',
      visibility: 'visible',
    }),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    MutationObserver: class {
      constructor(cb) {
        observers.push(cb);
      }
      observe() {}
    },
    addEventListener: (type, fn) => {
      winListeners[type] ??= [];
      winListeners[type].push(fn);
    },
    setTimeout: fn => timers.push(fn) - 1,
    clearTimeout: id => {
      if (id !== undefined) timers[id] = null;
    },
    requestIdleCallback: fn => idle.push(fn),
    createImageBitmap: () =>
      new Promise(resolve => {
        const bitmap = {
          closed: false,
          close() {
            this.closed = true;
          },
        };
        bitmaps.push({ bitmap, resolve: () => resolve(bitmap) });
      }),
  };
  const glass = createGlass({
    doc,
    win,
    createRenderer: canvas => {
      if (!webgl) return null;
      const r = {
        canvas,
        maxSize: 4096,
        wallpapers: [],
        draws: [],
        setWallpaper(bitmap) {
          r.wallpapers.push(bitmap);
          return bitmap ? accept(bitmap) : true;
        },
        resize() {},
        draw(items) {
          r.draws.push(items);
        },
      };
      renderers.push(r);
      return r;
    },
    onFrame: fn => {
      frames.fn = fn;
    },
    requestFrame: () => {},
    setScripted: on => {
      scripted = on;
    },
    corsCopy: async () => null,
    log: (...args) => log.push(args.join(' ')),
  });
  return {
    glass,
    doc,
    bitmaps,
    renderers,
    log,
    flush: () => new Promise(r => setImmediate(r)),
    img: src => ({ src, crossOrigin: null, naturalWidth: 1600, naturalHeight: 1000 }),
    observe: records => observers[0](records),
    runTimers: () => {
      for (const fn of timers.splice(0)) fn?.();
    },
    runIdle: () => {
      for (const fn of idle.splice(0)) fn();
    },
    resize: () => {
      for (const fn of winListeners.resize ?? []) fn();
    },
    tick: () => frames.fn?.(),
    get scripted() {
      return scripted;
    },
  };
}

/** Starts the engine and shows one wallpaper. */
async function live(h) {
  h.glass.start();
  h.glass.setWallpaper(h.img('http://host/a.jpg'), 'cover');
  await h.flush();
  h.bitmaps[0].resolve();
  await h.flush();
}

test('without WebGL2 the glass stays CSS and says why', () => {
  const h = harness({ webgl: false });
  h.glass.start();
  assert.equal(h.glass.stats().live, false);
  assert.match(h.log.join('\n'), /no WebGL2/);
});

test('the GPU canvas is hidden from assistive tech', () => {
  const h = harness();
  h.glass.start();
  assert.equal(h.renderers[0].canvas.attrs.get('aria-hidden'), 'true');
});

test('when two wallpapers overlap, the later one wins and the earlier bitmap is released', async () => {
  const h = harness();
  h.glass.start();
  h.glass.setWallpaper(h.img('http://host/a.jpg'), 'cover');
  await h.flush();
  h.glass.setWallpaper(h.img('http://host/b.jpg'), 'cover');
  await h.flush();
  const [a, b] = h.bitmaps;
  b.resolve();
  await h.flush();
  a.resolve();
  await h.flush();
  assert.equal(a.bitmap.closed, true, 'the stale bitmap leaks');
  assert.equal(b.bitmap.closed, false);
  assert.equal(h.renderers[0].wallpapers.at(-1), b.bitmap);
  assert.equal(h.glass.stats().live, true);
  assert.equal(h.scripted, true);
});

test('a wallpaper the GPU refuses leaves the glass to CSS and says so', async () => {
  const h = harness({ accept: () => false });
  await live(h);
  assert.equal(h.glass.stats().live, false);
  assert.equal(h.scripted, false);
  assert.equal(h.bitmaps[0].bitmap.closed, true);
  assert.match(h.log.join('\n'), /refused/);
});

test('reduced transparency never uploads a wallpaper', async () => {
  const h = harness();
  h.doc.documentElement.dataset.transparency = 'reduce';
  h.glass.start();
  h.glass.setWallpaper(h.img('http://host/a.jpg'), 'cover');
  await h.flush();
  assert.equal(h.bitmaps.length, 0);
  assert.equal(h.glass.stats().live, false);
});

test('a resize rebuilds the wallpaper once, after it settles', async () => {
  const h = harness();
  await live(h);
  h.resize();
  h.resize();
  h.resize();
  await h.flush();
  assert.equal(h.bitmaps.length, 1, 'rebuilt while still resizing');
  h.runTimers();
  await h.flush();
  assert.equal(h.bitmaps.length, 2);
});

test('a folder gets the glass only once its layer is ready, and loses it with the GPU context', async () => {
  const h = harness();
  await live(h);

  const early = new FakeEl();
  h.glass.openFolder(early, new FakeEl());
  assert.equal(early.hasAttribute('data-glass-drawn'), false, 'an early folder keeps its CSS fill');

  h.runIdle();
  const ov = Object.assign(new FakeEl(), { isConnected: true });
  const panel = new FakeEl();
  ov.append(panel);
  h.glass.openFolder(ov, panel);
  assert.equal(ov.hasAttribute('data-glass-drawn'), true);
  assert.equal(h.glass.stats().panelDrawn, true);

  const folderLayer = h.renderers[1];
  h.tick();
  assert.ok(folderLayer.draws.at(-1).length > 0, 'the panel is drawn');
  folderLayer.canvas.dispatch('webglcontextlost');
  assert.equal(ov.hasAttribute('data-glass-drawn'), false, 'the panel must get its CSS fill back');
  assert.equal(folderLayer.canvas.hidden, true);
  const before = h.renderers.length;
  folderLayer.canvas.dispatch('webglcontextrestored');
  const restored = h.renderers.slice(before);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].draws.length, 0, 'a restore must not draw the panel over its CSS fill');
});

test('glass elements removed from the page are forgotten even without a wallpaper', () => {
  const h = harness();
  h.glass.start();
  const el = Object.assign(new FakeEl(), { glass: true });
  h.doc.body.append(el);
  h.observe([{ type: 'childList', addedNodes: [el], removedNodes: [] }]);
  assert.equal(h.glass.stats().tracked, 1);
  el.isConnected = false;
  h.observe([{ type: 'childList', addedNodes: [], removedNodes: [el] }]);
  assert.equal(h.glass.stats().tracked, 0);
});
