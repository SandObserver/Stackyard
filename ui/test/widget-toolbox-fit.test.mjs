import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = { search: '?id=test' };
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { documentElement: { getAttribute: () => 'dark' } };
globalThis.getComputedStyle = () => ({ fontSize: '44px' });

const { fitText } = await import('../js/widget-toolbox.js');

/* Text as wide as its font size times its length, in a fixed box. */
const figure = (chars, box) => ({
  style: { fontSize: '' },
  clientWidth: box,
  get scrollWidth() {
    return Math.round((parseFloat(this.style.fontSize) || 44) * chars * 0.6);
  },
});

test('a figure that fits keeps the stylesheet size', () => {
  const el = figure(5, 200);
  fitText(el);
  assert.equal(el.style.fontSize, '');
});

test('a figure too wide shrinks until it fits', () => {
  const el = figure(8, 130);
  fitText(el);
  const size = parseFloat(el.style.fontSize);
  assert.ok(size < 44);
  assert.ok(el.scrollWidth <= el.clientWidth);
});

test('a figure never shrinks below the floor', () => {
  const el = figure(40, 50);
  fitText(el, 20);
  assert.equal(el.style.fontSize, '20px');
});

test('each call starts again from the stylesheet size', () => {
  const el = figure(11, 130);
  fitText(el);
  el.clientWidth = 1000;
  fitText(el);
  assert.equal(el.style.fontSize, '');
});
