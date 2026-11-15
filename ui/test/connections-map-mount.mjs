/* Runs the connections map page against a fake DOM and toolbox. The page's
   script is inline, so there is no module to import. */

import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as world from '../widgets/connections/world-map.js';

register('./js-root-hooks.mjs', import.meta.url);
globalThis.location ??= { search: '' };
const { rgbOf, errorLine } = await import('../js/widget-toolbox.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const source = fs.readFileSync(path.join(root, 'widgets/connections/connections-map.html'), 'utf8');
const scripts = [...source.matchAll(/<script(?: type="module")?>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const moduleScript = scripts.find(s => /^import /m.test(s));
const importLine = /^import \{([^}]+)\} from '\/js\/widget-toolbox\.js[^']*';$/m;
const worldLine = /^import \* as (\w+) from '\.\/world-map\.js';$/m;
const toolboxNames = moduleScript
  .match(importLine)[1]
  .split(',')
  .map(s => s.trim());
const worldName = moduleScript.match(worldLine)[1];
const body = moduleScript.replace(importLine, '').replace(worldLine, '');

/* Each canvas records what it last painted: each fill with its colour and
   shape. Copying one canvas onto another copies its fills. */
function canvasContext() {
  const ctx = {
    fills: [],
    drawn: 0,
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
      ctx.drawn++;
    },
    fillRect(x, y, w, h) {
      ctx.fills.push({ kind: 'rect', x, y, w, h, color: ctx.fillStyle });
      ctx.drawn++;
    },
    drawImage(src) {
      ctx.fills.push(...src.getContext().fills);
    },
  };
  return ctx;
}

/* Simple selectors only: tag, .class, tag.class and [attr], joined by a
   space or ' > ', listed with commas. */
function matchOne(el, simple) {
  const m = simple.match(/^(\w*)((?:\.[\w-]+)*)(?:\[([\w-]+)\])?$/);
  if (!m || typeof el !== 'object') return false;
  const [, tag, classes, attr] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  const own = el.className.split(' ');
  if (
    classes &&
    !classes
      .split('.')
      .filter(Boolean)
      .every(c => own.includes(c))
  )
    return false;
  if (attr && !(attr in el.attrs) && !(attr === 'tabindex' && el.tabIndex >= 0)) return false;
  return true;
}
function matches(el, selector) {
  return selector.split(',').some(part => {
    const steps = part.trim().split(/\s+/);
    let i = steps.length - 1;
    if (!matchOne(el, steps[i])) return false;
    let node = el;
    while (--i >= 0) {
      if (steps[i] === '>') {
        node = node.parent;
        if (!node || !matchOne(node, steps[--i])) return false;
        continue;
      }
      do node = node.parent;
      while (node && !matchOne(node, steps[i]));
      if (!node) return false;
    }
    return true;
  });
}

function element(tag = 'div', doc = null) {
  const adopt = c => {
    if (c && typeof c === 'object') {
      c.parent?.children.splice(c.parent.children.indexOf(c), 1);
      c.parent = el;
    }
    return c;
  };
  const el = {
    tagName: tag.toUpperCase(),
    parent: null,
    style: {},
    dataset: {},
    attrs: {},
    children: [],
    listeners: {},
    textContent: '',
    title: '',
    hidden: false,
    className: '',
    tabIndex: -1,
    clientWidth: 360,
    clientHeight: 170,
    scrollWidth: 0,
    scrollHeight: 0,
    scrollTop: 0,
    offsetWidth: 200,
    offsetHeight: 90,
    open: false,
    classList: {
      toggle(name, on) {
        const set = new Set(el.className.split(' ').filter(Boolean));
        if (on) set.add(name);
        else set.delete(name);
        el.className = [...set].join(' ');
      },
      add: name => el.classList.toggle(name, true),
      contains: name => el.className.split(' ').includes(name),
    },
    setAttribute(k, v) {
      el.attrs[k] = String(v);
    },
    getAttribute: k => el.attrs[k] ?? null,
    removeAttribute(k) {
      delete el.attrs[k];
    },
    addEventListener(type, fn) {
      (el.listeners[type] ||= []).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of el.listeners[type] || []) fn({ type, detail: 0, ...event });
    },
    appendChild(c) {
      el.children.push(adopt(c));
    },
    append(...c) {
      el.children.push(...c.map(adopt));
    },
    replaceChildren(...c) {
      for (const old of el.children) if (old && typeof old === 'object') old.parent = null;
      el.children = [];
      el.append(...c);
    },
    after(c) {
      const p = el.parent;
      adopt(c);
      c.parent = p;
      p.children.splice(p.children.indexOf(el) + 1, 0, c);
    },
    get firstElementChild() {
      return el.children.find(c => typeof c === 'object') || null;
    },
    get isConnected() {
      let n = el;
      while (n.parent) n = n.parent;
      return n.tagName === 'BODY' || n.isRoot === true;
    },
    contains(other) {
      for (let n = other; n; n = n.parent) if (n === el) return true;
      return false;
    },
    matches: sel => (sel === ':popover-open' ? el.open : matches(el, sel)),
    closest(sel) {
      for (let n = el; n; n = n.parent) if (matches(n, sel)) return n;
      return null;
    },
    showPopover() {
      el.dispatch('beforetoggle', { newState: 'open' });
      el.open = true;
      el.dispatch('toggle', { newState: 'open' });
    },
    hidePopover() {
      if (!el.open) return;
      el.dispatch('beforetoggle', { newState: 'closed' });
      el.open = false;
      if (doc && el.contains(doc.activeElement)) doc.activeElement = doc.body;
      el.dispatch('toggle', { newState: 'closed' });
    },
    focus() {
      if (doc) doc.activeElement = el;
      el.dispatch('focus');
    },
    remove() {},
    querySelector: sel => el.querySelectorAll(sel)[0] || null,
    querySelectorAll(sel) {
      const out = [];
      const walk = n => {
        for (const c of n.children || []) {
          if (typeof c !== 'object') continue;
          if (matches(c, sel)) out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 360, bottom: 170, width: 360, height: 170 }),
    getContext: () => (el._ctx ||= canvasContext()),
  };
  return el;
}

export async function mount({ theme = 'dark', onScreen = true } = {}) {
  const frames = new Map();
  let nextFrame = 1;
  const resizeCallbacks = [];
  let render = null;
  let screenChanged = null;
  const doc = { activeElement: null };
  const page = element('body', doc);
  doc.body = page;
  doc.activeElement = page;
  const byId = { c: element('canvas', doc), key: element('div', doc), sr: element('p', doc) };
  byId.key.attrs.id = 'key';
  page.append(byId.c, byId.key, byId.sr);
  const created = [];

  const saved = {};
  const globals = {
    window: { innerWidth: 360, innerHeight: 170, addEventListener() {} },
    document: Object.assign(doc, {
      getElementById: id => byId[id] || element('div', doc),
      createElement: tag => {
        const el = element(tag, doc);
        created.push(el);
        return el;
      },
      createTextNode: t => t,
      hasFocus: () => true,
      documentElement: { lang: 'en', getAttribute: () => null },
    }),
    location: { search: '?id=map' },
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
    linkTo: () => false,
    html: () => '',
    setHtml() {},
    colorOrFallback: c => c,
    rgbOf,
    loadStrings: async () => {},
    wt: (_, fallback, vars = {}) => fallback.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k]))),
    errorState: () => ({ ok() {}, empty() {}, fail() {} }),
    theme: () => theme,
    formatNumber: n => String(n),
    formatList: items => items.join(', '),
    cssZoom: () => 1,
    reducedMotion: () => false,
    errorLine,
    errorGlyph: () => element('svg'),
    whileOnScreen: (_, fn) => {
      screenChanged = fn;
      fn(onScreen);
      return { stop() {} };
    },
  };
  const AsyncFunction = (async () => {}).constructor;
  await new AsyncFunction(worldName, ...toolboxNames, body)(world, ...toolboxNames.map(n => toolbox[n]));

  return {
    frames,
    key: byId.key,
    body: page,
    doc,
    pop: () => page.querySelector('div.pop'),
    painted: () => byId.c.getContext().fills,
    dotsDrawn: () => created.filter(c => c !== byId.c).reduce((n, c) => n + (c._ctx?.drawn || 0), 0),
    sr: byId.sr,
    render: data => render(data),
    resize: () => resizeCallbacks.forEach(fn => fn()),
    setOnScreen: v => screenChanged(v),
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
