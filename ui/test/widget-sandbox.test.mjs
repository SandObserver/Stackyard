/* docs/frontend.md said every widget tile was a sandboxed iframe. None were.

   A bundled widget is served from this server, so a sandbox would have to grant
   it its own origin back and would withhold nothing. A custom widget frames a
   URL the user typed, and without a sandbox that page can redirect the whole
   dashboard through top.location. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const ORIGIN = 'http://dash.local';

/* Only as much DOM as mountScaledWidget touches, recording the attributes it
   sets on the frame. */
function harness() {
  const attrs = new Map();
  const el = tag => ({
    tagName: tag,
    style: { cssText: '', setProperty() {} },
    clientWidth: 100,
    clientHeight: 100,
    src: '',
    setAttribute(name, value) {
      if (tag === 'iframe') attrs.set(name, value);
    },
    removeAttribute(name) {
      if (tag === 'iframe') attrs.delete(name);
    },
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    get contentDocument() {
      return null;
    },
  });

  const saved = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
    raf: globalThis.requestAnimationFrame,
    ro: globalThis.ResizeObserver,
    timeout: globalThis.setTimeout,
  };
  globalThis.document = { createElement: el, querySelectorAll: () => [] };
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.location = { href: `${ORIGIN}/`, origin: ORIGIN };
  globalThis.requestAnimationFrame = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.setTimeout = () => 0;

  return {
    attrs,
    card: el('div'),
    restore() {
      Object.assign(globalThis, {
        document: saved.document,
        window: saved.window,
        location: saved.location,
        requestAnimationFrame: saved.raf,
        ResizeObserver: saved.ro,
        setTimeout: saved.timeout,
      });
    },
  };
}

async function mount(src) {
  const h = harness();
  const { mountScaledWidget } = await import('../js/utils.js');
  try {
    mountScaledWidget(h.card, { src, title: 'A widget', design: [200, 100] });
  } finally {
    h.restore();
  }
  return h.attrs;
}

const tokens = value => new Set(String(value).split(/\s+/).filter(Boolean));

test('a bundled widget is framed without a sandbox', async () => {
  const attrs = await mount('/widgets/clock/index.html?id=1&size=small');
  assert.equal(attrs.has('sandbox'), false, 'a same-origin frame gains nothing from a sandbox');
});

test('a custom widget pointing elsewhere is sandboxed', async () => {
  const attrs = await mount('https://grafana.example.invalid/d/abc');
  assert.ok(attrs.has('sandbox'), 'a framed third-party page can redirect the dashboard');
});

test('the sandbox withholds top-level navigation and nothing else it needs', async () => {
  const granted = tokens((await mount('https://grafana.example.invalid/d/abc')).get('sandbox'));
  for (const token of granted) assert.doesNotMatch(token, /^allow-top-navigation/, `${token} defeats the sandbox`);
  for (const needed of [
    'allow-scripts',
    'allow-same-origin',
    'allow-forms',
    'allow-modals',
    'allow-popups',
    'allow-downloads',
  ]) {
    assert.ok(granted.has(needed), `${needed} is withheld, which breaks a working embed`);
  }
});

test('a custom widget pointing back at this server is left alone', async () => {
  const attrs = await mount(`${ORIGIN}/some/local/page.html`);
  assert.equal(attrs.has('sandbox'), false, 'a same-origin page is this app, not a third party');
});
