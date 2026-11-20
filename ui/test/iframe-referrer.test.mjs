/* The pages send no referrer to other sites. A framed service still gets the
   origin unless its widget picks a policy, because some embeds refuse to play
   without one. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.location = { href: 'http://stackyard.local/', origin: 'http://stackyard.local' };
globalThis.getComputedStyle = () => ({ transform: 'none', direction: 'ltr' });
globalThis.requestAnimationFrame = () => 0;

const frames = [];
const el = tag => {
  const node = {
    tagName: tag,
    attrs: {},
    style: { cssText: '', setProperty() {} },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    getAttribute: k => node.attrs[k] ?? null,
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    offsetWidth: 200,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    contentDocument: null,
  };
  if (tag === 'iframe') frames.push(node);
  return node;
};
globalThis.document = {
  documentElement: { getAttribute: () => null },
  addEventListener() {},
  removeEventListener() {},
  createElement: el,
};

const { mountScaledWidget } = await import('../js/widget-frame.js');

const mount = iframeOpts => {
  mountScaledWidget(el('div'), { src: 'https://media.example/embed', title: 'w', design: [200, 100], iframeOpts });
  return frames.at(-1);
};

test('a framed service gets the origin as its referrer by default', () => {
  assert.equal(mount({}).attrs.referrerpolicy, 'strict-origin-when-cross-origin');
});

test('a policy picked for the widget wins', () => {
  assert.equal(mount({ referrerPolicy: 'no-referrer' }).attrs.referrerpolicy, 'no-referrer');
});
