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

test('the open folder is clear glass with a stronger bend', () => {
  const tokens = fs.readFileSync(path.join(root, 'css/tokens.css'), 'utf8');
  assert.match(tokens, /--glass-folder-frost:\s*\.4;/);
  assert.match(tokens, /--glass-folder-bend:\s*1\.8;/);
});

test('the frost is even across a glass surface', () => {
  const gpu = fs.readFileSync(path.join(root, 'js/glass-gpu.js'), 'utf8');
  assert.match(gpu, /col = mix\(col, uFrost\.rgb, uFrost\.a\);/);
  assert.doesNotMatch(
    gpu,
    /smoothstep\([^)]*min\(uRect\.z, uRect\.w\)/,
    'frost scaled by distance from the edge shows a diamond on a large panel',
  );
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

test('the folder rim lights the folder panel, not the clear icons inside it', () => {
  const css = read('css/dashboard.css');
  assert.match(css, /:is\(\.folder-box-desktop, \.dyn-box-mob\)\.glass-surface::before \{/);
  assert.doesNotMatch(css, /:is\(\.folder-overlay, \.folder-overlay-mobile\) \.glass-surface::before/);
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

test('the rim bend follows the iOS measurement and stops at the bezel', async () => {
  const { slabProfile } = await import('../js/glass-gpu.js');
  const p = slabProfile(0.9);
  assert.ok(Math.abs(p[0] * 108 - 42) < 2, `edge pull ${p[0] * 108}`);
  assert.equal(p.at(-1), 0);
  for (let i = 2; i < p.length; i++) assert.ok(p[i] <= p[i - 1] + 1e-6, 'the pull never grows inward past the edge');
  assert.ok(slabProfile(1.8)[0] > p[0], 'a stronger bend is thicker glass');
  assert.ok(slabProfile(0).every(v => v === 0));
});

test('the renderer draws at most two canvas pixels per CSS px and frees memory at size 0', async () => {
  const { createGlassRenderer } = await import('../js/glass-gpu.js');
  const canvas = /** @type {any} */ ({ width: 0, height: 0, getContext: () => fakeGl() });
  const r = createGlassRenderer(canvas);
  const before = globalThis.devicePixelRatio;
  try {
    globalThis.devicePixelRatio = 3;
    r?.resize(400, 300, 10, 20);
    assert.deepEqual([canvas.width, canvas.height], [800, 600]);
    globalThis.devicePixelRatio = 1;
    r?.resize(400, 300);
    assert.deepEqual([canvas.width, canvas.height], [400, 300]);
    r?.resize(0, 0);
    assert.deepEqual([canvas.width, canvas.height], [1, 1]);
  } finally {
    globalThis.devicePixelRatio = before;
  }
});

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
    /html\[data-transparency="reduce"\] :is\(\.widget, \.mob-widget-card\)\[data-card="translucent"\] \{\s*background:var\(--glass-card-solid\); backdrop-filter:none;/,
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
function harness({ webgl = true, accept = () => true, tokens = {} } = {}) {
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
  const media = [];
  const frames = { fn: null };
  const log = [];
  let scripted = false;
  const win = {
    Element: FakeEl,
    innerWidth: 400,
    innerHeight: 800,
    location: { origin: 'http://host' },
    getComputedStyle: () => ({
      getPropertyValue: name =>
        ({ '--glass-folder': 'rgb(107 107 112 / .5)', '--folder-blur': '20', ...tokens })[name] ?? '',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      borderTopLeftRadius: '20px',
      opacity: '1',
      visibility: 'visible',
    }),
    matchMedia: query => ({
      matches: false,
      addEventListener: (_type, fn) => media.push({ query, fn }),
    }),
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
        looks: [],
        boxes: [],
        sizes: [],
        setWallpaper(bitmap) {
          r.wallpapers.push(bitmap);
          return bitmap ? accept(bitmap, r) : true;
        },
        setBox(box) {
          r.boxes.push(box);
        },
        resize(width, height, x = 0, y = 0) {
          r.sizes.push([width, height, x, y]);
        },
        draw(items, look) {
          r.draws.push(items);
          r.looks.push(look);
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
    win,
    bitmaps,
    renderers,
    media,
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

test('a resize fits the glass on the next frame and keeps the old picture until the rebuild', async () => {
  const h = harness();
  await live(h);
  const el = Object.assign(new FakeEl(), { glass: true, isConnected: true });
  h.doc.body.append(el);
  h.observe([{ type: 'childList', addedNodes: [el], removedNodes: [] }]);
  const gpu = h.renderers[0];
  h.doc.documentElement.clientWidth = 300;
  h.win.innerWidth = 300;
  h.resize();
  const drawsBefore = gpu.draws.length;
  h.tick();
  assert.deepEqual(gpu.sizes.at(-1), [128, 64, 0, 0], 'the canvas covers the glass, rounded out to 64 px');
  assert.deepEqual(gpu.boxes.at(-1), wallpaperBox(1600, 1000, 'cover', 300, 800));
  assert.ok(gpu.draws.length > drawsBefore && gpu.draws.at(-1).length > 0, 'the cleared canvas is not redrawn');
  assert.equal(h.bitmaps.length, 1, 'rebuilt while still resizing');
  assert.equal(h.bitmaps[0].bitmap.closed, false);
  h.runTimers();
  await h.flush();
  assert.equal(h.bitmaps.length, 2);
  assert.equal(gpu.wallpapers.at(-1), h.bitmaps[0].bitmap, 'the old picture is dropped before the new one is ready');
});

test('a folder layer that refuses a new wallpaper gives the open folder its CSS fill back', async () => {
  let refuseFolder = false;
  const h = harness({ accept: (_bitmap, r) => !(refuseFolder && r === h.renderers[1]) });
  await live(h);
  h.runIdle();
  const ov = Object.assign(new FakeEl(), { isConnected: true });
  const panel = new FakeEl();
  ov.append(panel);
  h.glass.openFolder(ov, panel);
  assert.equal(ov.hasAttribute('data-glass-drawn'), true);
  refuseFolder = true;
  h.glass.setWallpaper(h.img('http://host/b.jpg'), 'cover');
  await h.flush();
  h.bitmaps[1].resolve();
  await h.flush();
  assert.equal(h.glass.stats().live, true);
  assert.equal(h.glass.stats().folderLayer, false);
  assert.equal(ov.hasAttribute('data-glass-drawn'), false, 'the panel stays clear over a dead layer');
  assert.equal(h.renderers[1].canvas.hidden, true);
});

/** The look the open folder was last drawn with, on a page whose glass bend is 2. */
async function folderLook(tokens) {
  const h = harness({ tokens: { '--glass-bend': '2', ...tokens } });
  await live(h);
  h.runIdle();
  const ov = Object.assign(new FakeEl(), { isConnected: true });
  const panel = new FakeEl();
  ov.append(panel);
  h.glass.openFolder(ov, panel);
  h.tick();
  return h.renderers[1].looks.at(-1);
}

test('the folder tokens scale its bend and frost, and 0 turns either off', async () => {
  const set = await folderLook({ '--glass-folder-bend': '1.8', '--glass-folder-frost': '.4' });
  assert.ok(Math.abs(set.bend - 3.6) < 1e-9);
  assert.ok(Math.abs(set.frost[3] - 0.5 * 0.4) < 1e-9, 'the fill alpha is scaled by the frost token');
  const off = await folderLook({ '--glass-folder-bend': '0', '--glass-folder-frost': '0' });
  assert.equal(off.bend, 0);
  assert.equal(off.frost[3], 0);
  const unset = await folderLook({});
  assert.equal(unset.bend, 2, 'an unset token leaves the bend as it is');
  assert.ok(Math.abs(unset.frost[3] - 0.5) < 1e-9);
});

/** A live page with one glass element at rect. */
async function withGlass(rect) {
  const h = harness();
  await live(h);
  const el = Object.assign(new FakeEl(), { glass: true, isConnected: true });
  el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
  h.doc.body.append(el);
  h.observe([{ type: 'childList', addedNodes: [el], removedNodes: [] }]);
  h.tick();
  return { h, el, gpu: h.renderers[0] };
}

test('the base canvas covers only the glass and sits over it', async () => {
  const { h, gpu } = await withGlass({ left: 20, top: 700, width: 300, height: 70 });
  assert.deepEqual(gpu.sizes.at(-1), [384, 160, 0, 640], 'rounded out to 64 px, clipped to the viewport');
  const st = gpu.canvas.style;
  assert.deepEqual([st.inset, st.width, st.height], ['640px auto auto 0px', '384px', '160px']);
  assert.ok(h.renderers[0].draws.at(-1).length > 0);
});

test('while glass moves the base canvas only grows, and it shrinks back once still', async () => {
  const { h, el, gpu } = await withGlass({ left: 0, top: 0, width: 100, height: 50 });
  el.getBoundingClientRect = () => ({ left: 0, top: 300, width: 100, height: 50, right: 100, bottom: 350 });
  h.tick();
  assert.deepEqual(gpu.sizes.at(-1), [128, 384, 0, 0], 'grown to hold both places');
  for (let i = 0; i < 8; i++) h.tick();
  assert.deepEqual(gpu.sizes.at(-1), [128, 128, 0, 256], 'fitted to where the glass came to rest');
  assert.ok(gpu.draws.at(-1).length > 0, 'the cleared canvas is redrawn');
});

test('the folder layer holds memory only while a folder is open', async () => {
  const h = harness();
  await live(h);
  h.runIdle();
  const folderLayer = h.renderers[1];
  assert.equal(folderLayer.sizes.length, 0, 'a closed folder layer is never sized');
  const ov = Object.assign(new FakeEl(), { isConnected: true });
  const panel = new FakeEl();
  ov.append(panel);
  h.glass.openFolder(ov, panel);
  assert.deepEqual(folderLayer.sizes.at(-1), [400, 800, 0, 0]);
  panel.isConnected = false;
  h.tick();
  assert.deepEqual(folderLayer.sizes.at(-1), [0, 0, 0, 0]);
});

test('a new pixel density refits the glass', async () => {
  const { h, gpu } = await withGlass({ left: 0, top: 0, width: 100, height: 50 });
  const count = gpu.sizes.length;
  const density = h.media.find(m => m.query.startsWith('(resolution:'));
  assert.ok(density, 'the pixel density is watched');
  h.win.devicePixelRatio = 2;
  density.fn();
  h.tick();
  assert.equal(gpu.sizes.length, count + 1);
  assert.ok(h.media.filter(m => m.query.startsWith('(resolution:')).length > 1, 'it keeps watching');
});
