import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test', origin: 'https://dash.test' };
const docOn = {};
globalThis.document = { addEventListener: (type, fn) => (docOn[type] = fn) };
globalThis.window = { location: globalThis.location };
const posted = [];
globalThis.parent = { postMessage: (msg, origin) => posted.push([msg, origin]) };
const { twoTap } = await import('../js/widget-toolbox.js');

function card(opts = {}) {
  const on = {};
  const log = [];
  const el = {
    addEventListener: (type, fn) => (on[type] = fn),
    contains: n => n === el,
  };
  twoTap(el, {
    reveal: () => log.push('reveal'),
    conceal: () => log.push('conceal'),
    open: () => log.push('open'),
    ...opts,
  });
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });
  const end = () => {
    let prevented = false;
    on.touchend({ preventDefault: () => (prevented = true), target: el });
    docOn.touchend({ target: el });
    return prevented;
  };
  return {
    el,
    log,
    tap() {
      on.touchstart(touch(10, 10));
      on.touchmove(touch(12, 13));
      return end();
    },
    swipe() {
      on.touchstart(touch(10, 10));
      on.touchmove(touch(40, 11));
      return end();
    },
  };
}

const outsideTap = () => docOn.touchend({ target: {} });
const reveals = c => c.log.filter(x => x !== 'conceal');

test('a swipe that starts on a card neither reveals nor opens it', () => {
  const c = card();
  outsideTap();
  posted.length = 0;
  assert.equal(c.swipe(), false, 'a swipe must stay free to scroll the page');
  assert.equal(c.swipe(), false);
  assert.deepEqual(reveals(c), []);
  assert.deepEqual(posted, []);
});

test('the first tap reveals and tells the dashboard, the second opens', () => {
  const c = card();
  outsideTap();
  posted.length = 0;
  assert.equal(c.tap(), true);
  assert.deepEqual(reveals(c), ['reveal']);
  assert.deepEqual(posted, [[{ type: 'widget-active' }, 'https://dash.test']]);
  c.tap();
  assert.deepEqual(reveals(c), ['reveal', 'open']);
});

test('a swipe between the two taps keeps the card revealed and does not open it', () => {
  const c = card();
  outsideTap();
  c.tap();
  c.swipe();
  assert.deepEqual(reveals(c), ['reveal']);
  c.tap();
  assert.deepEqual(reveals(c), ['reveal', 'open']);
});

test('tapping another card moves the reveal there', () => {
  const a = card();
  const b = card();
  outsideTap();
  a.tap();
  b.tap();
  assert.ok(a.log.at(-1) === 'conceal');
  b.tap();
  assert.deepEqual(reveals(a), ['reveal']);
  assert.deepEqual(reveals(b), ['reveal', 'open']);
});

test('a tap outside every card, or the dashboard, conceals the card', () => {
  const c = card();
  outsideTap();
  c.tap();
  outsideTap();
  assert.equal(c.log.at(-1), 'conceal');
  c.tap();
  window.__clearActive();
  assert.equal(c.log.at(-1), 'conceal');
  c.tap();
  assert.deepEqual(reveals(c), ['reveal', 'reveal', 'reveal'], 'a concealed card must not open on the next tap');
});

test('a card that cannot reveal swallows the tap and keeps the other card revealed', () => {
  const live = card();
  let ready = false;
  const idle = card({ canReveal: () => ready });
  outsideTap();
  live.tap();
  assert.equal(idle.tap(), true);
  assert.deepEqual(reveals(idle), []);
  live.tap();
  assert.deepEqual(reveals(live), ['reveal', 'open']);
  ready = true;
  idle.tap();
  assert.deepEqual(reveals(idle), ['reveal']);
});

test('the reveal ends on its own after the timeout', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const c = card({ timeout: 3000 });
  outsideTap();
  c.tap();
  t.mock.timers.tick(2999);
  assert.notEqual(c.log.at(-1), 'conceal');
  t.mock.timers.tick(1);
  assert.equal(c.log.at(-1), 'conceal');
  c.tap();
  assert.deepEqual(reveals(c), ['reveal', 'reveal']);
});
