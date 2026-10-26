/* A drag in the Settings list must always end: a redraw asked for mid-drag
   waits for it, and a drag whose handle loses its pointer capture puts the
   floating copy back. A drop whose row is not drawn fades the copy out. */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const connected = new Set();

class FakeEl extends EventTarget {
  constructor(cls = '', rect = { left: 0, top: 100, width: 300, height: 68 }) {
    super();
    this.classes = new Set(cls.split(' ').filter(Boolean));
    const classes = () => this.classes;
    this.classList = {
      add: (...c) => c.forEach(x => classes().add(x)),
      remove: (...c) => c.forEach(x => classes().delete(x)),
      contains: c => classes().has(c),
    };
    this.dataset = {};
    this.style = {};
    this.parentElement = null;
    this.draggable = true;
    this.rect = rect;
    this.target = null;
  }
  get className() {
    return [...this.classes].join(' ');
  }
  set className(v) {
    this.classes = new Set(v.split(' ').filter(Boolean));
  }
  get isConnected() {
    return connected.has(this);
  }
  getBoundingClientRect() {
    return { ...this.rect, bottom: this.rect.top + this.rect.height, right: this.rect.left + this.rect.width };
  }
  cloneNode() {
    const c = new FakeEl(this.className, this.rect);
    c.dataset = { ...this.dataset };
    return c;
  }
  remove() {
    connected.delete(this);
  }
  setPointerCapture() {}
  closest() {
    return this.target;
  }
}

let under = null;
let getByIdCalls = 0;
const doc = new EventTarget();
Object.assign(doc, {
  body: { appendChild: el => connected.add(el) },
  documentElement: {},
  elementFromPoint: () => under,
  getElementById: () => {
    getByIdCalls++;
    return null;
  },
  createElement: () => new FakeEl(),
  querySelectorAll(sel) {
    const [, cls, not] = sel.match(/^\.([\w-]+)(?::not\(\.([\w-]+)\))?$/) || [];
    if (!cls) return [];
    return [...connected].filter(e => e.classes.has(cls) && !(not && e.classes.has(not)));
  },
});
doc.scrollingElement = doc.documentElement;
globalThis.document = doc;

let reduceMotion = true;
const frames = new Map();
let nextFrame = 1;
Object.assign(globalThis, {
  window: { innerHeight: 800, scrollBy() {} },
  matchMedia: () => ({ matches: reduceMotion }),
  getComputedStyle: () => ({ overflowY: 'visible' }),
  requestAnimationFrame: fn => {
    frames.set(nextFrame, fn);
    return nextFrame++;
  },
  cancelAnimationFrame: id => frames.delete(id),
});
const runFrames = () => {
  const due = [...frames.values()];
  frames.clear();
  due.forEach(fn => fn(performance.now()));
};

const { initDrag, wireRowDrag, redrawHeld } = await import('../js/admin-drag.js');
const { state } = await import('../js/admin-state.js');
const { render } = await import('../js/admin-list.js');

let redraws = 0;
let onRedraw = () => {};
initDrag(
  () => {},
  () => {},
  () => {
    redraws++;
    onRedraw();
  },
);

const ptr = (type, x, y) =>
  Object.assign(new Event(type), { pointerType: 'touch', pointerId: 7, clientX: x, clientY: y });

function drawRow(item, rect, extra = {}) {
  const row = new FakeEl('row drow', rect);
  Object.assign(row.dataset, { itemId: item.id, group: 'home' }, extra);
  row.target = row;
  const handle = new FakeEl('rord');
  connected.add(row);
  connected.add(handle);
  wireRowDrag(row, handle, { item, indent: false, folderId: null, childIdx: null });
  return { row, handle };
}

const ghost = () => [...connected].find(e => e.classes.has('drag-ghost'));

/* Down on the handle, then far enough to lift the copy. */
function lift(handle, y = 400) {
  handle.dispatchEvent(ptr('pointerdown', 10, 130));
  handle.dispatchEvent(ptr('pointermove', 10, y));
  assert.ok(ghost(), 'the copy lifted');
}

beforeEach(() => {
  connected.clear();
  frames.clear();
  under = null;
  redraws = 0;
  onRedraw = () => {};
  reduceMotion = true;
  getByIdCalls = 0;
  state.items = [
    { id: 'a', type: 'app' },
    { id: 'b', type: 'app' },
    { id: 'f', type: 'folder', children: [] },
  ];
});

test('a redraw asked for during a touch drag waits until it ends', () => {
  const { handle } = drawRow(state.items[0]);
  assert.equal(redrawHeld(), false);
  lift(handle);
  assert.equal(redrawHeld(), true);
  assert.equal(redraws, 0);
  handle.dispatchEvent(ptr('pointerup', 10, 400));
  assert.equal(redraws, 1, 'the held redraw runs once the drag ends');
  assert.equal(redrawHeld(), false);
});

test('a touch drag with no redraw asked for does not redraw', () => {
  const { handle } = drawRow(state.items[0]);
  lift(handle);
  handle.dispatchEvent(ptr('pointercancel', 10, 400));
  assert.equal(redraws, 0);
});

test('a redraw asked for during a mouse drag waits until it ends', () => {
  const { row } = drawRow(state.items[0]);
  const start = Object.assign(new Event('dragstart'), {
    dataTransfer: { setData() {}, effectAllowed: '' },
  });
  row.dispatchEvent(start);
  assert.equal(redrawHeld(), true);
  assert.equal(redraws, 0);
  row.dispatchEvent(new Event('dragend'));
  assert.equal(redraws, 1);
  assert.equal(redrawHeld(), false);
});

test('the list is not rebuilt while a drag holds it', () => {
  const { handle } = drawRow(state.items[0]);
  lift(handle);
  render();
  assert.equal(getByIdCalls, 0, 'render touched the list mid-drag');
  handle.dispatchEvent(ptr('pointercancel', 10, 400));
  assert.equal(redraws, 1);
});

test('a drag that loses its pointer capture ends and puts its copy back', () => {
  const { row, handle } = drawRow(state.items[0]);
  lift(handle, 780);
  assert.ok(frames.size > 0, 'autoscroll is running');
  handle.remove();
  document.dispatchEvent(ptr('lostpointercapture', 0, 0));
  assert.equal(ghost(), undefined, 'the copy is still on screen');
  assert.equal(row.classList.contains('dragging'), false);
  assert.equal(frames.size, 0, 'autoscroll still runs');
  assert.equal(redrawHeld(), false);
});

test('a lost capture for another pointer leaves the drag alone', () => {
  const { handle } = drawRow(state.items[0]);
  lift(handle);
  document.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: 99 }));
  assert.ok(ghost());
  assert.equal(redrawHeld(), true);
  handle.dispatchEvent(ptr('pointercancel', 10, 400));
});

test('autoscroll ends the drag once its handle leaves the page', () => {
  const { row, handle } = drawRow(state.items[0]);
  lift(handle, 780);
  handle.remove();
  runFrames();
  assert.equal(ghost(), undefined);
  assert.equal(row.classList.contains('dragging'), false);
  assert.equal(frames.size, 0);
});

test('a drop whose row is not drawn fades the copy out', () => {
  reduceMotion = false;
  const { row, handle } = drawRow(state.items[0]);
  const folder = drawRow(state.items[2], { left: 0, top: 300, width: 300, height: 68 }, { isFolder: '1' }).row;
  under = folder;
  /* The folder is collapsed, so the redraw leaves the moved row out. */
  onRedraw = () => row.remove();
  lift(handle, 334);
  handle.dispatchEvent(ptr('pointerup', 10, 334));
  assert.deepEqual(state.items.find(i => i.id === 'f').children, ['a']);
  const copy = ghost();
  assert.ok(copy, 'the copy is fading, not gone');
  assert.equal(copy.style.opacity, '0', 'the copy settled onto itself');
  assert.equal(copy.classList.contains('dragging'), false);
  copy.dispatchEvent(new Event('transitionend'));
  assert.equal(ghost(), undefined);
});
