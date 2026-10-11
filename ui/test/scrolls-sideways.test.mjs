import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
const { scrollsSideways } = await import('../js/utils.js');

const view = { getComputedStyle: n => ({ overflowX: n.ox }) };
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
