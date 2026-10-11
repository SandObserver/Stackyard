/* Runs the connections map page against a fake DOM and toolbox. The page's
   scripts are inline, so there is no module to import. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const source = fs.readFileSync(path.join(root, 'widgets/connections/connections-map.html'), 'utf8');
const scripts = [...source.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const dataScript = scripts.find(s => s.includes('window.__DOTS='));
const placeScript = scripts.find(s => s.includes('window.__MAP='));
const moduleScript = scripts.find(s => /^import /m.test(s));
const importLine = /^import \{([^}]+)\} from '[^']+';$/m;
const toolboxNames = moduleScript
  .match(importLine)[1]
  .split(',')
  .map(s => s.trim());
const body = moduleScript.replace(importLine, '');

export function placement(math = Math) {
  const window = {};
  new Function('window', dataScript)(window);
  new Function('window', 'Math', placeScript)(window, math);
  return { D: window.__DOTS, M: window.__MAP };
}

/* Records what the last frame painted: each fill with its colour and shape. */
const ctx = {
  fills: [],
  fillStyle: '',
  _shape: null,
  clearRect() {
    ctx.fills = [];
  },
  beginPath() {},
  arc(x, y, r) {
    ctx._shape = { kind: 'arc', x, y, r };
  },
  fill() {
    ctx.fills.push({ ...ctx._shape, color: ctx.fillStyle });
  },
  fillRect(x, y, w, h) {
    ctx.fills.push({ kind: 'rect', x, y, w, h, color: ctx.fillStyle });
  },
};

function element(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    dataset: {},
    attrs: {},
    children: [],
    listeners: {},
    textContent: '',
    title: '',
    hidden: false,
    className: '',
    clientWidth: 360,
    clientHeight: 170,
    scrollWidth: 0,
    classList: {
      toggle(name, on) {
        const set = new Set(el.className.split(' ').filter(Boolean));
        if (on) set.add(name);
        else set.delete(name);
        el.className = [...set].join(' ');
      },
    },
    setAttribute(k, v) {
      el.attrs[k] = String(v);
    },
    getAttribute: k => el.attrs[k] ?? null,
    addEventListener(type, fn) {
      (el.listeners[type] ||= []).push(fn);
    },
    appendChild(c) {
      el.children.push(c);
    },
    append(...c) {
      el.children.push(...c);
    },
    replaceChildren(...c) {
      el.children = c;
    },
    remove() {},
    querySelector: () => null,
    querySelectorAll(sel) {
      const out = [];
      const walk = n => {
        for (const c of n.children || []) {
          if (typeof c !== 'object') continue;
          if (sel === '.k' && c.className.split(' ').includes('k')) out.push(c);
          if (sel === '.k > bdi' && n.className.split(' ').includes('k') && c.tagName === 'BDI') out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 170 }),
    getContext: () => ctx,
  };
  return el;
}

export async function mount({ theme = 'dark' } = {}) {
  const frames = new Map();
  let nextFrame = 1;
  const resizeCallbacks = [];
  let render = null;
  const byId = { c: element('canvas'), key: element(), sr: element('p') };

  const saved = {};
  const globals = {
    window: {},
    document: {
      getElementById: id => byId[id] || element(),
      createElement: element,
      createTextNode: t => t,
      body: element('body'),
      documentElement: { lang: 'en' },
    },
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
    theme: () => theme,
    formatNumber: n => String(n),
    cssZoom: () => 1,
  };
  new Function(dataScript)();
  new Function(placeScript)();
  const AsyncFunction = (async () => {}).constructor;
  await new AsyncFunction(...toolboxNames, body)(...toolboxNames.map(n => toolbox[n]));

  return {
    frames,
    key: byId.key,
    painted: () => ctx.fills,
    sr: byId.sr,
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
