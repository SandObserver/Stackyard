/* A timezone name the browser does not know makes every toLocaleString call
   throw. The clock must say so instead of drawing nothing or a stopped face.
   Each page's inline script runs against a stub DOM. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const TOOLBOX_IMPORT = /import\('\/js\/widget-toolbox\.js\?v=[0-9a-z]+'\)/;
const CLOCK_DATE_IMPORT = /import\('\/js\/clock-date\.js\?v=[0-9a-z]+'\)/;
const CAPTAIN_IMPORT = /import\('\/js\/clock-captain\.js\?v=[0-9a-z]+'\)/;

function pageScript(file) {
  const src = fs.readFileSync(new URL(`../widgets/clock/${file}`, import.meta.url), 'utf8');
  const body = src.match(/<script>([\s\S]*?)<\/script[^>]*>/i)[1];
  assert.match(body, TOOLBOX_IMPORT, `${file} loads the toolbox for its error line`);
  assert.match(body, /\nboot\(\);\s*$/);
  assert.match(body, CLOCK_DATE_IMPORT, `${file} loads its date formatter`);
  return body
    .replace(TOOLBOX_IMPORT, '__toolbox()')
    .replace(CLOCK_DATE_IMPORT, '__clockDate()')
    .replace(CAPTAIN_IMPORT, '__captain()')
    .replace(/\nboot\(\);\s*$/, '\nreturn boot();');
}

function element() {
  const el = {
    style: {},
    attrs: {},
    writes: {},
    children: [],
    className: '',
    innerHTML: '',
    clientWidth: 220,
    clientHeight: 150,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(k, v) {
      el.attrs[k] = v;
      el.writes[k] = (el.writes[k] || 0) + 1;
    },
    getComputedTextLength: () => 0,
    replaceChildren() {
      el.children.length = 0;
    },
    remove() {},
    removeAttribute(k) {
      delete el.attrs[k];
    },
    after() {},
    before() {},
    cloneNode: () => element(),
    animate: () => ({}),
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

async function boot(
  file,
  clockTimezone,
  {
    resizeDuringLoad = false,
    search = '?id=c1',
    config = {},
    reduceMotion = true,
    frames = 0,
    reduceLater = false,
  } = {},
) {
  const els = new Map();
  const byId = id => els.get(id) || els.set(id, element()).get(id);
  const timers = [];
  const delays = [];
  const painted = [];
  const resizers = [];
  const rafs = [];
  const motion = { reduce: reduceMotion };
  const motionListeners = [];
  const globals = {
    location: { search },
    window: {},
    document: {
      documentElement: { getAttribute: () => null },
      getElementById: byId,
      createElementNS: element,
      querySelectorAll: () => [],
      addEventListener() {},
      hidden: false,
    },
    addEventListener: (type, fn) => type === 'resize' && resizers.push(fn),
    fetch: async () => {
      if (resizeDuringLoad) for (const fn of resizers) fn();
      return { ok: true, json: async () => ({ widgetConfig: { clockTimezone, ...config } }) };
    },
    setTimeout: (fn, ms) => {
      timers.push(fn);
      delays.push(ms);
      return fn;
    },
    clearTimeout: fn => {
      const at = timers.indexOf(fn);
      if (at >= 0) timers.splice(at, 1);
    },
    requestAnimationFrame: fn => {
      rafs.push(fn);
      return fn;
    },
    cancelAnimationFrame: fn => {
      const at = rafs.indexOf(fn);
      if (at >= 0) rafs.splice(at, 1);
    },
    __clockDate: () => import('../js/clock-date.js'),
    __captain: () => import('../js/clock-captain.js'),
    __toolbox: async () => ({
      getConfig: async () => (await fetch()).json(),
      reducedMotion: onChange => {
        if (onChange) motionListeners.push(onChange);
        return motion.reduce;
      },
      theme: () => 'dark',
      loadStrings: async () => {},
      wt: (_k, fallback, vars = {}) => fallback.replace(/\{(\w+)\}/g, (_m, k) => vars[k]),
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
    for (let i = 0; i < frames; i++) {
      for (const fn of rafs.splice(0)) fn();
      if (rafs.length) break;
      for (const fn of timers.splice(0)) fn();
    }
    if (reduceLater) {
      motion.reduce = true;
      for (const fn of motionListeners) fn(true);
    }
  } finally {
    for (const k of Object.keys(globals)) {
      if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
      else delete globalThis[k];
    }
  }
  return {
    painted,
    timers,
    delays,
    rafs,
    byId,
    label: byId('widget').attrs['aria-label'],
    face: byId('face').children.length,
  };
}

for (const file of ['digital.html', 'analog.html', 'captain.html']) {
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

test('analog.html: the sweep waits on a timer between frames and writes the label only when it changes', async () => {
  const r = await boot('analog.html', 'Europe/Berlin', { reduceMotion: false, frames: 6 });
  assert.deepEqual(r.painted, []);
  assert.equal(r.rafs.length, 1, 'each timer asks for one frame');
  assert.equal(r.timers.length, 0, 'each frame schedules one timer');
  assert.match(r.label, /^\d\d:\d\d, /);
  assert.ok(r.byId('widget').writes['aria-label'] <= 2, 'the label is written once a minute');
});

test('captain.html: a known timezone ticks and reads the whole panel', async () => {
  const r = await boot('captain.html', 'Europe/Berlin');
  assert.deepEqual(r.painted, []);
  assert.equal(r.timers.length, 1);
  assert.match(r.label, /^Captain, it’s [A-Z][a-z]+day! \d\d:\d\d [A-Z][a-z]+ \d{1,2}, \d{4}$/);
});

test('captain.html: with the date off the panel reads without it', async () => {
  const r = await boot('captain.html', 'Europe/Berlin', { config: { clockShowDate: false } });
  assert.match(r.label, /^Captain, it’s [A-Z][a-z]+day! \d\d:\d\d$/);
});

test('analog.html: turning Reduce Motion on stops the sweep without a reload', async () => {
  const r = await boot('analog.html', 'Europe/Berlin', { reduceMotion: false, reduceLater: true });
  assert.equal(r.rafs.length, 0, 'no sweep frame is left');
  assert.equal(r.timers.length, 1, 'one step timer runs');
  assert.ok(r.delays.at(-1) <= 1000, 'the hand steps once a second');
});

for (const file of ['digital.html', 'captain.html']) {
  test(`${file}: the next tick lands on the minute, milliseconds included`, async t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 13, 10, 15, 42, 750) });
    const r = await boot(file, 'Europe/Berlin');
    assert.equal(r.delays[0], 17250);
  });
}
