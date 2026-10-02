/* A timezone name the browser does not know makes every toLocaleString call
   throw. The clock must say so instead of drawing nothing or a stopped face.
   Each page's inline script runs against a stub DOM. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const TOOLBOX_IMPORT = /import\('\/js\/widget-toolbox\.js\?v=[0-9a-z]+'\)/;

function pageScript(file) {
  const src = fs.readFileSync(new URL(`../widgets/clock/${file}`, import.meta.url), 'utf8');
  const body = src.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.match(body, TOOLBOX_IMPORT, `${file} loads the toolbox for its error line`);
  assert.match(body, /\nboot\(\);\s*$/);
  return body.replace(TOOLBOX_IMPORT, '__toolbox()').replace(/\nboot\(\);\s*$/, '\nreturn boot();');
}

function element() {
  const el = {
    style: {},
    attrs: {},
    children: [],
    className: '',
    innerHTML: '',
    clientWidth: 220,
    clientHeight: 150,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(k, v) {
      el.attrs[k] = v;
    },
    appendChild(c) {
      el.children.push(c);
      return c;
    },
    append(...c) {
      el.children.push(...c);
    },
    querySelectorAll: () => [],
  };
  return el;
}

async function boot(file, clockTimezone) {
  const els = new Map();
  const byId = id => els.get(id) || els.set(id, element()).get(id);
  const timers = [];
  const painted = [];
  const globals = {
    location: { search: '?id=c1' },
    document: {
      documentElement: { getAttribute: () => null },
      getElementById: byId,
      createElementNS: element,
      addEventListener() {},
      hidden: false,
    },
    addEventListener() {},
    matchMedia: () => ({ matches: true }),
    fetch: async () => ({ ok: true, json: async () => ({ widgetConfig: { clockTimezone } }) }),
    setTimeout: fn => timers.push(fn),
    clearTimeout() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    __toolbox: async () => ({
      loadStrings: async () => {},
      wt: (_k, fallback) => fallback,
      errorState: () => ({ empty: text => painted.push(text) }),
    }),
  };
  const saved = {};
  for (const k of Object.keys(globals)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: globals[k], configurable: true, writable: true });
  }
  try {
    await new Function(pageScript(file))();
  } finally {
    for (const k of Object.keys(globals)) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  }
  return { painted, timers, label: byId('widget').attrs['aria-label'] };
}

for (const file of ['digital.html', 'analog.html']) {
  test(`${file}: an unknown timezone shows an error instead of a clock`, async () => {
    const r = await boot(file, 'Berlin');
    assert.deepEqual(r.painted, ['Unknown timezone']);
    assert.equal(r.label, 'Unknown timezone');
    assert.equal(r.timers.length, 0, 'no tick is scheduled');
  });
}

test('digital.html: a known timezone ticks', async () => {
  const r = await boot('digital.html', 'Europe/Berlin');
  assert.deepEqual(r.painted, []);
  assert.equal(r.timers.length, 1);
  assert.match(r.label, /^\d\d:\d\d, /);
});
