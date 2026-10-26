import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
const { scrollsSideways, ownsSidewaysTouch } = await import('../js/utils.js');

const view = { getComputedStyle: n => ({ overflowX: n.ox, touchAction: n.ta ?? 'auto' }) };
const node = (props, parent = null) => ({
  nodeType: 1,
  ownerDocument: { defaultView: view },
  parentElement: parent,
  ox: 'visible',
  scrollWidth: 100,
  clientWidth: 100,
  scrollLeft: 0,
  ...props,
});

test('a wheel over a plain page belongs to the pager', () => {
  assert.equal(scrollsSideways(node({}, node({})), 50), false);
});

test('a strip that can still scroll that way keeps the wheel', () => {
  const strip = node({ ox: 'auto', scrollWidth: 400, clientWidth: 100, scrollLeft: 100 });
  const inner = node({}, strip);
  assert.equal(scrollsSideways(inner, 30), true, 'room to the right');
  assert.equal(scrollsSideways(inner, -30), true, 'room to the left');
});

test('a strip already at its end hands the wheel to the pager', () => {
  const atEnd = node({ ox: 'auto', scrollWidth: 400, clientWidth: 100, scrollLeft: 300 });
  assert.equal(scrollsSideways(atEnd, 30), false);
  const atStart = node({ ox: 'scroll', scrollWidth: 400, clientWidth: 100, scrollLeft: 0 });
  assert.equal(scrollsSideways(atStart, -30), false);
});

test('overflow that is clipped, not scrollable, does not count', () => {
  assert.equal(scrollsSideways(node({ ox: 'hidden', scrollWidth: 400, clientWidth: 100 }), 30), false);
});

/* A widget swipe drags the home pages, unless the widget takes the sideways
   touch for itself. */
test('a plain widget leaves a sideways touch to the home pager', () => {
  assert.equal(ownsSidewaysTouch(node({}, node({ ta: 'manipulation' }))), false);
  assert.equal(ownsSidewaysTouch(node({ ta: 'pan-x pan-y' })), false);
});

test('a scrubber that takes sideways touch keeps it', () => {
  assert.equal(ownsSidewaysTouch(node({}, node({ ta: 'pan-y' }))), true);
  assert.equal(ownsSidewaysTouch(node({ ta: 'none' })), true);
});

test('a strip that scrolls sideways keeps the touch', () => {
  assert.equal(ownsSidewaysTouch(node({}, node({ ox: 'auto', scrollWidth: 400, clientWidth: 100 }))), true);
});
