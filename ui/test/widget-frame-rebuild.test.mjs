/* A rebuild discards every widget frame. It must stop the frames it discards,
   and it must happen only when the layout changes. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { settle } from './fake-dom.mjs';
import { app, installDashboard } from './dashboard-page.mjs';

const config = {
  items: [app('a'), { id: 'w', type: 'widget', widgetType: 'clock', widgetSize: 'medium' }],
  settings: { language: 'en' },
};
const { dom } = installDashboard({ config, widgets: { widgets: [{ name: 'clock', label: 'Clock' }] } });

Object.defineProperty(globalThis.Element.prototype, 'parentNode', {
  get() {
    return this.parentElement;
  },
  configurable: true,
});
globalThis.Element.prototype.replaceChild = function (next, old) {
  this.insertBefore(next, old);
  old.remove();
  return old;
};

let mobile = false;
const mediaLists = [];
globalThis.matchMedia = query => {
  const list = {
    media: query,
    get matches() {
      return query === '(max-width:768px)' ? mobile : false;
    },
    listeners: [],
    addEventListener(_type, fn) {
      this.listeners.push(fn);
    },
    removeEventListener() {},
  };
  mediaLists.push(list);
  return list;
};
let viewportListeners = 0;
globalThis.visualViewport = { addEventListener: () => viewportListeners++, removeEventListener() {} };

const made = [];
const create = dom.document.createElement.bind(dom.document);
dom.document.createElement = tag => {
  const node = create(tag);
  if (String(tag).toLowerCase() === 'iframe') made.push(node);
  return node;
};

const frames = async () => {
  for (let i = 0; i < 4; i++) {
    dom.flushFrames();
    await settle();
  }
};
const { boot } = await import('../js/dashboard-boot.js');
const { createDashboardState } = await import('../js/dashboard-state.js');
const dash = createDashboardState({ mob: false, bootTimeoutMs: 15000 });
const booted = boot(dash);
await settle();
await frames();
await booted;

const resize = async ({ width, height } = {}) => {
  if (width) globalThis.innerWidth = width;
  if (height) globalThis.innerHeight = height;
  dom.window.dispatchEvent({ type: 'resize' });
  await settle(260);
  await frames();
};
const live = () => made.filter(f => f.isConnected);

test('the first build mounts one frame', () => {
  assert.equal(made.length, 1);
  assert.equal(live().length, 1);
});

test('a resize that changes no slot count keeps the frames', async () => {
  await resize({ width: 1290 });
  assert.equal(made.length, 1, 'a resize that changes nothing rebuilt the page');
  assert.equal(viewportListeners, 0, 'the phone keyboard resizes the visual viewport');
});

test('a burst of resizes that changes the slot count rebuilds once and stops the old frame', async () => {
  const old = made[0];
  for (const h of [900, 1000, 1100]) {
    globalThis.innerHeight = h;
    dom.window.dispatchEvent({ type: 'resize' });
  }
  await resize({ height: 1200 });
  assert.equal(made.length, 2, 'an undebounced resize rebuilds on every event');
  assert.equal(old.isConnected, false);
  assert.equal(old.src, 'about:blank', 'the discarded frame keeps polling');
  assert.equal(live().length, 1);
});

test('crossing the layout breakpoint rebuilds the phone layout and stops the desktop frame', async () => {
  const old = live()[0];
  mobile = true;
  for (const list of mediaLists) for (const fn of list.listeners) fn({ matches: list.matches });
  await frames();
  assert.equal(dash.mob, true);
  assert.ok(dom.document.body.classList.contains('is-mob'));
  assert.ok(dom.document.querySelector('#pages > .mob-page'), 'the phone pages are not built');
  assert.equal(old.src, 'about:blank', 'the phone build left the desktop frame running');
  assert.equal(live().length, 0);
});

test('the phone layout ignores a height change', async () => {
  const page = dom.document.querySelector('#pages > .mob-page');
  await resize({ height: 500 });
  assert.equal(dom.document.querySelector('#pages > .mob-page'), page, 'a phone keyboard rebuilt the page');
  await resize({ width: 390 });
  assert.notEqual(
    dom.document.querySelector('#pages > .mob-page'),
    page,
    'a width change must rebuild the phone layout',
  );
  dom.document.hidden = true;
  dom.document.dispatchEvent({ type: 'visibilitychange' });
});
