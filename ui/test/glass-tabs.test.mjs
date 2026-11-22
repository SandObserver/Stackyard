import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

globalThis.window = /** @type {any} */ (globalThis);
globalThis.devicePixelRatio = 2;
let images = 0;
globalThis.Image = /** @type {any} */ (
  class {
    constructor() {
      images++;
    }
    decode() {
      return Promise.resolve();
    }
  }
);
globalThis.XMLSerializer = /** @type {any} */ (
  class {
    serializeToString() {
      return '<svg/>';
    }
  }
);
globalThis.CSS = /** @type {any} */ ({ escape: (/** @type {string} */ s) => s });
globalThis.getComputedStyle = /** @type {any} */ ((/** @type {any} */ el) => el.cs());

const node = (/** @type {any} */ extra = {}) => ({
  attributes: [],
  childNodes: [],
  style: {},
  setAttribute() {},
  getAttribute: () => null,
  append() {},
  prepend() {},
  remove() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  cloneNode() {
    return this;
  },
  cs: () => ({ color: 'rgb(9, 9, 9)', opacity: '1' }),
  ...extra,
});
/** @type {Record<string, any>} */
const symbols = {};
globalThis.document = /** @type {any} */ ({
  styleSheets: [],
  createElementNS: () => node(),
  createElement: () => node({ getBoundingClientRect: () => ({ bottom: 40 }) }),
  getElementById: (/** @type {string} */ id) => symbols[id] ?? null,
});

/** A tab whose icon and label read the colours and opacities given.
    @param {{ icon: string, active?: boolean, color?: string, iconOpacity?: string, labelOpacity?: string,
              labelColor?: () => string, animations?: any[] }} o */
function fakeTab(o) {
  symbols[o.icon] ??= node({ id: o.icon, ownerDocument: globalThis.document });
  const use = { getAttribute: () => `#${o.icon}` };
  const svg = node({
    querySelector: (/** @type {string} */ q) => (q === ':scope > use' ? use : null),
    getBoundingClientRect: () => ({ left: 10, top: 5, width: 26, height: 26 }),
    cs: () => ({ color: o.color ?? 'rgb(9, 9, 9)', opacity: o.iconOpacity ?? '1' }),
  });
  const label = node({
    textContent: 'General',
    getBoundingClientRect: () => ({ left: 4, top: 34, width: 40, height: 12 }),
    cs: () => ({
      fontStyle: 'normal',
      fontWeight: '600',
      fontSize: '10px',
      fontFamily: 'system-ui',
      color: o.labelColor?.() ?? o.color ?? 'rgb(9, 9, 9)',
      opacity: o.labelOpacity ?? '1',
      direction: 'ltr',
    }),
  });
  return {
    classList: { contains: () => !!o.active },
    querySelector: (/** @type {string} */ q) => (q === 'svg' ? svg : q === 'span' ? label : null),
    getAnimations: () => o.animations ?? [],
  };
}

const BAR = /** @type {DOMRect} */ ({ left: 0, top: 0 });
const settle = () => new Promise(r => setImmediate(r));
const { tabInks, drawTabInks, cachedIcons } = await import('../js/glass-tabs.js');

/** Reads the tabs until every icon has decoded. @param {any[]} tabs */
async function ready(tabs) {
  tabInks(tabs, BAR, () => {});
  await settle();
  return tabInks(tabs, BAR, () => {});
}

test('the lens picture shows a new selection in its end colours while the change still fades', () => {
  const fade = {
    transitionProperty: 'color',
    currentTime: 30,
    effect: { getComputedTiming: () => ({ endTime: 150 }) },
  };
  const hover = { currentTime: 80, effect: { getComputedTiming: () => ({ endTime: 400 }) } };
  const tab = fakeTab({
    icon: 'sy-fade',
    active: true,
    labelColor: () => (fade.currentTime === 150 ? 'rgb(10, 132, 255)' : 'rgb(140, 140, 140)'),
    animations: [fade, hover],
  });
  const ink = tabInks(/** @type {any} */ ([tab]), BAR, () => {});
  assert.equal(ink.items[0].color, 'rgb(10, 132, 255)');
  assert.equal(fade.currentTime, 30, 'the fade on the page goes on from where it was');
  assert.equal(hover.currentTime, 80, 'only CSS transitions are moved');
});

test('the lens draws each tab icon and label at its own opacity', async () => {
  const tabs = /** @type {any} */ ([
    fakeTab({ icon: 'sy-dim', iconOpacity: '0.6', labelOpacity: '0.8' }),
    fakeTab({ icon: 'sy-lit', active: true }),
  ]);
  const ink = await ready(tabs);
  assert.deepEqual(
    ink.items.map(t => [t.ia, t.la]),
    [
      [0.6, 0.8],
      [1, 1],
    ],
  );
  /** @type {string[]} */
  const calls = [];
  const gx = /** @type {any} */ ({
    globalAlpha: 1,
    drawImage() {
      calls.push(`icon ${this.globalAlpha}`);
    },
    fillText() {
      calls.push(`label ${this.globalAlpha}`);
    },
  });
  drawTabInks(gx, ink.items, 24);
  assert.deepEqual(calls, ['icon 0.6', 'label 0.8', 'icon 1', 'label 1']);
  assert.equal(gx.globalAlpha, 1, 'the alpha is put back');
  const dimmer = await ready([fakeTab({ icon: 'sy-dim', iconOpacity: '0.4', labelOpacity: '0.8' }), tabs[1]]);
  assert.notEqual(dimmer.key, ink.key, 'a new opacity draws a new picture');
});

test('the icon cache keeps one picture per tab icon and state', async () => {
  const pair = (/** @type {number} */ n, active = 0) =>
    /** @type {any} */ ([
      fakeTab({ icon: 'sy-a', active: active === 0, color: `rgb(${n}, 0, 0)` }),
      fakeTab({ icon: 'sy-b', active: active === 1, color: `rgb(${n}, 0, 0)` }),
    ]);
  for (let n = 0; n < 10; n++) await ready(pair(n));
  assert.ok(cachedIcons() <= 4, `${cachedIcons()} pictures held after 10 theme changes`);
  await ready(pair(9, 1));
  const made = images;
  await ready(pair(9, 0));
  await ready(pair(9, 1));
  assert.equal(images, made, 'switching tabs back and forth decodes nothing new');
});
