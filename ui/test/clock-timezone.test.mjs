/* A timezone name the browser does not know makes every toLocaleString call
   throw. The clock must say so instead of drawing nothing or a stopped face.
   Each page's inline script runs against a stub DOM. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const TOOLBOX_IMPORT = /import\('\/js\/widget-toolbox\.js\?v=[0-9a-z]+'\)/;
const CLOCK_DATE_IMPORT = /import\('\/js\/clock-date\.js\?v=[0-9a-z]+'\)/;

function pageScript(file) {
  const src = fs.readFileSync(new URL(`../widgets/clock/${file}`, import.meta.url), 'utf8');
  const body = src.match(/<script>([\s\S]*?)<\/script[^>]*>/i)[1];
  assert.match(body, TOOLBOX_IMPORT, `${file} loads the toolbox for its error line`);
  assert.match(body, /\nboot\(\);\s*$/);
  assert.match(body, CLOCK_DATE_IMPORT, `${file} loads its date formatter`);
  return body
    .replace(TOOLBOX_IMPORT, '__toolbox()')
    .replace(CLOCK_DATE_IMPORT, '__clockDate()')
    .replace(/\nboot\(\);\s*$/, '\nreturn boot();');
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

async function boot(file, clockTimezone, { resizeDuringLoad = false, search = '?id=c1', config = {} } = {}) {
  const els = new Map();
  const byId = id => els.get(id) || els.set(id, element()).get(id);
  const timers = [];
  const painted = [];
  const resizers = [];
  const globals = {
    location: { search },
    document: {
      documentElement: { getAttribute: () => null },
      getElementById: byId,
      createElementNS: element,
      addEventListener() {},
      hidden: false,
    },
    addEventListener: (type, fn) => type === 'resize' && resizers.push(fn),
    matchMedia: () => ({ matches: true }),
    fetch: async () => {
      if (resizeDuringLoad) for (const fn of resizers) fn();
      return { ok: true, json: async () => ({ widgetConfig: { clockTimezone, ...config } }) };
    },
    setTimeout: fn => timers.push(fn),
    clearTimeout() {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    __clockDate: () => import('../js/clock-date.js'),
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
    for (const fn of timers.splice(0)) fn();
  } finally {
    for (const k of Object.keys(globals)) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  }
  return { painted, timers, byId, label: byId('widget').attrs['aria-label'], face: byId('face').children.length };
}

for (const file of ['digital.html', 'analog.html']) {
  test(`${file}: an unknown timezone shows an error instead of a clock`, async () => {
    const r = await boot(file, 'Berlin');
    assert.deepEqual(r.painted, ['Unknown timezone']);
    assert.equal(r.label, 'Unknown timezone');
    assert.equal(r.timers.length, 0, 'no tick is scheduled');
  });
}

test('analog.html: a resize while the config loads draws no face behind the error', async () => {
  const r = await boot('analog.html', 'Berlin', { resizeDuringLoad: true });
  assert.deepEqual(r.painted, ['Unknown timezone']);
  assert.equal(r.face, 0);
});

test('digital.html: a known timezone ticks', async () => {
  const r = await boot('digital.html', 'Europe/Berlin');
  assert.deepEqual(r.painted, []);
  assert.equal(r.timers.length, 1);
  assert.match(r.label, /^\d\d:\d\d, /);
});

test('digital.html: figures use the page language digits, and the overlap layers match them', async () => {
  const { byId } = await boot('digital.html', 'Asia/Tehran', { search: '?id=c1&lang=fa' });
  assert.match(byId('hh').textContent, /^[۰-۹]{2}$/);
  assert.match(byId('mm').textContent, /^[۰-۹]{2}$/);
  assert.equal(byId('hh-over').textContent, byId('hh').textContent);
  assert.equal(byId('mm-clip').textContent, byId('mm').textContent);
});

test('digital.html: the figures move down when the date is off', async () => {
  const on = (await boot('digital.html', 'Europe/Berlin')).byId;
  const off = (await boot('digital.html', 'Europe/Berlin', { config: { clockShowDate: false } })).byId;
  assert.deepEqual([on('hh').attrs.y, on('mm').attrs.y], [82, 116]);
  assert.deepEqual([off('hh').attrs.y, off('mm').attrs.y], [88, 124]);
  assert.deepEqual([off('hh-over').attrs.y, off('mm-clip').attrs.y], [88, 124]);
  assert.equal(off('date-line').style.display, 'none');
});
