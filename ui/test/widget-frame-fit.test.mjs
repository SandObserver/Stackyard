/* A widget frame scaled as a picture is resampled and blurs on a 1x screen. A
   bundled page is sized to whole pixels and zoomed instead. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const ORIGIN = 'http://dash.local';

async function mount(src) {
  let frame = null;
  const root = { style: {} };
  const el = tag => {
    const attrs = new Map();
    const node = {
      tagName: tag,
      style: { cssText: '' },
      attrs,
      clientWidth: 330.33,
      clientHeight: 148,
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: k => attrs.delete(k),
      appendChild() {},
      addEventListener() {},
      removeEventListener() {},
      get contentDocument() {
        return tag === 'iframe' ? { documentElement: root, readyState: 'loading' } : null;
      },
    };
    if (tag === 'iframe') frame = node;
    return node;
  };
  const saved = {};
  const fakes = {
    document: {
      createElement: el,
      querySelectorAll: () => [],
      documentElement: { getAttribute: () => null },
      addEventListener() {},
      removeEventListener() {},
    },
    window: { addEventListener() {}, removeEventListener() {} },
    location: { href: `${ORIGIN}/`, origin: ORIGIN },
    requestAnimationFrame: () => {},
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout: () => 0,
  };
  for (const k of Object.keys(fakes)) {
    saved[k] = globalThis[k];
    globalThis[k] = fakes[k];
  }
  try {
    const { mountScaledWidget } = await import('../js/utils.js');
    mountScaledWidget(el('div'), { src, title: 'A widget', design: [360, 170] });
  } finally {
    Object.assign(globalThis, saved);
  }
  return { frame, root };
}

const whole = v => Number.isInteger(Number.parseFloat(v));

test('a bundled widget is sized to whole pixels and zoomed, not scaled', async () => {
  const { frame, root } = await mount('/widgets/connections/connections-map.html?id=1');
  assert.ok(whole(frame.style.width) && whole(frame.style.height), `${frame.style.width} x ${frame.style.height}`);
  const t = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\)$/.exec(frame.style.transform);
  assert.ok(t, `unexpected transform ${frame.style.transform}`);
  assert.ok(whole(t[1]) && whole(t[2]), 'the frame sits at a fractional pixel');
  const zoom = Number(frame.getAttribute('data-zoom'));
  assert.equal(zoom, Number.parseFloat(frame.style.width) / 360);
  assert.equal(root.style.zoom, String(zoom), 'the page is not zoomed');
});

test('any other page keeps its design size, scaled', async () => {
  for (const src of ['/grafana/d/abc', 'https://grafana.example.invalid/d/abc']) {
    const { frame } = await mount(src);
    assert.equal(frame.getAttribute('data-zoom'), null, src);
    const t = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)$/.exec(frame.style.transform);
    assert.ok(t, `${src}: ${frame.style.transform}`);
    assert.ok(whole(t[1]) && whole(t[2]), `${src} sits at a fractional pixel`);
  }
});

test('cssZoom reads the zoom, with a fallback and a default', async () => {
  globalThis.location ??= { search: '' };
  const { cssZoom } = await import('../js/widget-toolbox.js');
  const saved = globalThis.document;
  try {
    globalThis.document = { documentElement: { currentCSSZoom: 0.87 } };
    assert.equal(cssZoom(), 0.87);
    globalThis.document = {
      documentElement: {},
      body: { offsetWidth: 360, getBoundingClientRect: () => ({ width: 313.2 }) },
    };
    assert.equal(cssZoom(), 313.2 / 360);
    globalThis.document = { documentElement: {}, body: null };
    assert.equal(cssZoom(), 1);
  } finally {
    globalThis.document = saved;
  }
});
