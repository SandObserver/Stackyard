/* The home pager follows one finger on the document and on widget frames. A
   gesture the pager never sees end strands the strip between two pages. A
   pinch is not a swipe and must not turn the page. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.document = { documentElement: {}, addEventListener() {}, removeEventListener() {} };
globalThis.getComputedStyle = () => ({ transform: 'none', direction: 'ltr' });
globalThis.requestAnimationFrame = () => 0;

const { swipePager, onTap } = await import('../js/ui.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTH = 400;

function mkStrip() {
  const cls = new Set();
  return {
    style: {},
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c) },
  };
}

function pager(target, page = 0) {
  const strip = mkStrip();
  const turned = [];
  const feed = swipePager(target, strip, {
    width: () => WIDTH,
    page: () => page,
    total: () => 3,
    turn: n => turned.push(n),
  });
  return { strip, turned, feed };
}

const pt = (id, x, y = 500) => ({ identifier: id, clientX: x, clientY: y });

function touchEvent(type, changed, all, t) {
  const e = new Event(type, { cancelable: true });
  Object.defineProperties(e, {
    changedTouches: { value: changed },
    touches: { value: all },
    timeStamp: { value: t },
  });
  return e;
}

/* Bubbles from the first target to the last, as from the pill to the document. */
function send(targets, type, changed, all, t) {
  const events = [];
  for (const target of targets) {
    const e = touchEvent(type, changed, all, t);
    target.dispatchEvent(e);
    events.push(e);
    if (e.cancelBubble) break;
  }
  return events;
}

/* A slow drag, so the release is decided by distance and not by a flick. */
function drag(targets, id, from, to, t0 = 0) {
  send(targets, 'touchstart', [pt(id, from)], [pt(id, from)], t0);
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    const x = from + ((to - from) * i) / steps;
    send(targets, 'touchmove', [pt(id, x)], [pt(id, x)], t0 + i * 200);
  }
  return send(targets, 'touchend', [pt(id, to)], [], t0 + steps * 200 + 500);
}

test('a swipe that starts on the Search pill turns the page and does not open Search', () => {
  const pill = new EventTarget();
  const doc = new EventTarget();
  let opened = 0;
  onTap(pill, () => opened++);
  const { strip, turned } = pager(doc);
  const lift = drag([pill, doc], 0, 300, 300 - WIDTH * 0.7);
  assert.equal(opened, 0, 'a swipe opened Search');
  assert.equal(lift.length, 2, 'the lift never reached the pager');
  assert.equal(lift[0].defaultPrevented, false);
  assert.deepEqual(turned, [1]);
  assert.equal(strip.classList.contains('dragging'), false, 'the strip is left mid-drag');
});

test('a short swipe on the pill springs back and does not open Search', () => {
  const pill = new EventTarget();
  const doc = new EventTarget();
  let opened = 0;
  onTap(pill, () => opened++);
  const { strip, turned } = pager(doc);
  drag([pill, doc], 0, 300, 270);
  assert.equal(opened, 0);
  assert.deepEqual(turned, [0], 'the strip is not settled back');
  assert.equal(strip.classList.contains('dragging'), false);
});

test('a tap on the pill opens Search and is kept from the pager', () => {
  const pill = new EventTarget();
  const doc = new EventTarget();
  let opened = 0;
  onTap(pill, () => opened++);
  const { turned } = pager(doc);
  send([pill, doc], 'touchstart', [pt(0, 200)], [pt(0, 200)], 0);
  send([pill, doc], 'touchmove', [pt(0, 204)], [pt(0, 204)], 40);
  const lift = send([pill, doc], 'touchend', [pt(0, 204)], [], 80);
  assert.equal(opened, 1);
  assert.equal(lift.length, 1);
  assert.equal(lift[0].defaultPrevented, true, 'the browser would also send a click and open Search twice');
  assert.deepEqual(turned, []);
});

test('a click opens Search, except the one a swipe leaves behind', () => {
  const pill = new EventTarget();
  let opened = 0;
  onTap(pill, () => opened++);
  pill.dispatchEvent(new Event('click'));
  assert.equal(opened, 1);
  drag([pill], 0, 300, 200);
  pill.dispatchEvent(new Event('click'));
  assert.equal(opened, 1, 'the click after a swipe opened Search');
  pill.dispatchEvent(new Event('click'));
  assert.equal(opened, 2);
});

test('the phone Search pill opens through the tap handler', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const build = ui.slice(ui.indexOf('export function buildMobile('), ui.indexOf('export function resetMobileChrome('));
  assert.match(build, /onTap\(pillNew, /);
  assert.doesNotMatch(build, /pillNew\.addEventListener\(\s*'touchend'/);
  assert.doesNotMatch(build, /pillNew\.onclick/);
});

test('a second finger on the page springs the strip back', () => {
  const doc = new EventTarget();
  const { strip, turned } = pager(doc, 1);
  send([doc], 'touchstart', [pt(0, 300)], [pt(0, 300)], 0);
  send([doc], 'touchmove', [pt(0, 250)], [pt(0, 250)], 200);
  send([doc], 'touchstart', [pt(1, 100)], [pt(0, 250), pt(1, 100)], 300);
  assert.deepEqual(turned, [1], 'the strip is not sent back to the current page');
  assert.equal(strip.classList.contains('dragging'), false);
  const at = strip.style.transform;
  send([doc], 'touchmove', [pt(0, 0), pt(1, 380)], [pt(0, 0), pt(1, 380)], 400);
  send([doc], 'touchend', [pt(0, 0)], [pt(1, 380)], 900);
  send([doc], 'touchend', [pt(1, 380)], [], 950);
  assert.deepEqual(turned, [1], 'the pinch turned the page');
  assert.equal(strip.style.transform, at, 'the strip still follows a finger');
});

test('a second finger in a widget frame springs the strip back', async () => {
  const { mountScaledWidget } = await import('../js/utils.js');
  const frameDoc = new EventTarget();
  Object.assign(frameDoc, {
    readyState: 'complete',
    documentElement: { setAttribute() {}, style: {} },
    defaultView: { performance: { timeOrigin: performance.timeOrigin } },
  });
  const el = tag => ({
    tagName: tag,
    style: { cssText: '', setProperty() {} },
    setAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    offsetWidth: 200,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    get contentDocument() {
      return tag === 'iframe' ? frameDoc : null;
    },
  });
  const doc = globalThis.document;
  globalThis.document = { ...doc, documentElement: { getAttribute: () => null }, createElement: el };
  try {
    const { strip, turned, feed } = pager(null, 1);
    mountScaledWidget(el('div'), {
      src: '/widgets/clock/index.html',
      title: 'w',
      design: [200, 100],
      mobile: true,
      swipe: () => feed,
    });
    send([frameDoc], 'touchstart', [pt(0, 150)], [pt(0, 150)], 0);
    send([frameDoc], 'touchmove', [pt(0, 100)], [pt(0, 100)], 200);
    assert.equal(strip.classList.contains('dragging'), true, 'the frame does not feed the pager');
    send([frameDoc], 'touchstart', [pt(1, 20)], [pt(0, 100), pt(1, 20)], 300);
    assert.deepEqual(turned, [1], 'the strip is not sent back to the current page');
    send([frameDoc], 'touchmove', [pt(0, -150)], [pt(0, -150), pt(1, 20)], 400);
    send([frameDoc], 'touchend', [pt(0, -150)], [pt(1, 20)], 900);
    assert.deepEqual(turned, [1], 'the pinch turned the page');
  } finally {
    globalThis.document = doc;
  }
});
