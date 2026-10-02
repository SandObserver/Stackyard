/* The map pulses a point service by asking for a frame from inside each frame.
   Every poll and resize also asks for one, so unless those requests share one
   handle, each refresh starts another endless loop. Counting frames pending at
   once is the point: one loop keeps exactly one. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'widgets/connections/connections-map.html'), 'utf8');
const scripts = [...source.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const [dotsScript, moduleScript] = scripts;
const importLine = /^import \{([^}]+)\} from '[^']+';$/m;
const toolboxNames = moduleScript
  .match(importLine)[1]
  .split(',')
  .map(s => s.trim());
const body = moduleScript.replace(importLine, '');

function element() {
  return {
    style: {},
    children: [],
    clientWidth: 360,
    clientHeight: 170,
    setAttribute() {},
    addEventListener() {},
    appendChild(c) {
      this.children.push(c);
    },
    append(...c) {
      this.children.push(...c);
    },
    remove() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 170 }),
    getContext: () =>
      new Proxy(
        {},
        {
          get: (_, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}),
          set: () => true,
        },
      ),
  };
}

async function mount() {
  const frames = new Map();
  let nextFrame = 1;
  const resizeCallbacks = [];
  let render = null;

  const saved = {};
  const globals = {
    window: {},
    document: { getElementById: element, createElement: element, createTextNode: () => ({}), body: element() },
    location: { search: '?id=map' },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: fn => {
      frames.set(nextFrame, fn);
      return nextFrame++;
    },
    cancelAnimationFrame: id => frames.delete(id),
    ResizeObserver: class {
      constructor(fn) {
        resizeCallbacks.push(fn);
      }
      observe() {}
    },
  };
  for (const k of Object.keys(globals)) {
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, k, { value: globals[k], configurable: true, writable: true });
  }

  const toolbox = {
    poll: opts => {
      render = opts.render;
      return { stop() {} };
    },
    fetchData: async () => ({}),
    openUrl() {},
    html: () => '',
    setHtml() {},
    colorOrFallback: c => c,
    loadStrings: async () => {},
    wt: (_, text) => text,
    errorState: () => ({ ok() {}, empty() {}, fail() {} }),
    theme: () => 'dark',
  };
  new Function(dotsScript)();
  const AsyncFunction = (async () => {}).constructor;
  await new AsyncFunction(...toolboxNames, body)(...toolboxNames.map(n => toolbox[n]));

  return {
    frames,
    render: data => render(data),
    resize: () => resizeCallbacks.forEach(fn => fn()),
    runFrames() {
      const due = [...frames.entries()];
      frames.clear();
      for (const [, fn] of due) fn(performance.now());
    },
    restore() {
      for (const k of Object.keys(globals)) {
        if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
        else delete globalThis[k];
      }
    },
  };
}

const PULSING = { services: [{ id: 'vpn', kind: 'point', lat: 52.5, lng: 13.4, name: 'VPN' }] };

test('repeated polls and resizes keep one animation frame pending', async () => {
  const map = await mount();
  try {
    for (let i = 0; i < 5; i++) {
      map.render(PULSING);
      map.runFrames();
      map.resize();
      map.runFrames();
    }
    assert.equal(map.frames.size, 1, `expected one pulse loop, found ${map.frames.size} frames pending`);
  } finally {
    map.restore();
  }
});

test('the pulse keeps animating after a refresh', async () => {
  const map = await mount();
  try {
    map.render(PULSING);
    for (let i = 0; i < 3; i++) map.runFrames();
    assert.equal(map.frames.size, 1);
  } finally {
    map.restore();
  }
});
