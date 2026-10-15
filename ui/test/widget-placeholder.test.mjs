import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location = /** @type {any} */ ({ search: '?id=test' });

const nodes = new Map();
const mk = tag => ({
  tagName: tag,
  style: {},
  attrs: {},
  setAttribute(k, v) {
    this.attrs[k] = v;
  },
  appendChild(c) {
    if (c.id) nodes.set(c.id, c);
  },
});
globalThis.document = /** @type {any} */ ({
  documentElement: { getAttribute: () => 'dark' },
  head: mk('head'),
  getElementById: id => nodes.get(id) || null,
  createElement: mk,
});
const { placeholder } = await import('../js/widget-toolbox.js');

test('a placeholder is a hidden, sized shape, and its style is added once', () => {
  const a = placeholder(72, 9);
  const b = placeholder('40%', 12, 6);
  assert.equal(a.className, 'wt-ph');
  assert.equal(a.attrs['aria-hidden'], 'true');
  assert.deepEqual([a.style.width, a.style.height, a.style.borderRadius], ['72px', '9px', '4px']);
  assert.deepEqual([b.style.width, b.style.height, b.style.borderRadius], ['40%', '12px', '6px']);
  assert.equal([...nodes.keys()].filter(k => k === 'wt-ph-css').length, 1);
});

test('no widget claims a state before its data arrives', () => {
  const page = p => fs.readFileSync(new URL(`../widgets/${p}`, import.meta.url), 'utf8');
  assert.doesNotMatch(page('nowplaying/index.html'), /id="title">Nothing playing</);
  assert.doesNotMatch(page('books/index.html'), /id="lbl">READING</);
  assert.doesNotMatch(page('weather/index.html'), /id="temp">--/);
});
