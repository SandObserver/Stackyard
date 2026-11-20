/* A small DOM for tests that import page modules. No dependency.

   installDom() puts a document, window globals and a recording fetch on
   globalThis. Elements support the tree with text nodes, attributes, classes,
   dataset, style, simple selectors, innerHTML, focus, and events with capture
   and bubble phases. createElement returns the element class the tag has in a
   browser, so instanceof checks behave. A selector it cannot read throws, so a
   test never passes on a query it silently ignored. */

import { readFileSync } from 'node:fs';

const VOID = new Set([
  'input',
  'img',
  'br',
  'hr',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'use',
]);
const decode = s =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&');
const encode = (s, attr) => {
  const out = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return attr ? out.replace(/"/g, '&quot;') : out;
};
const dataAttr = k => 'data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase());

class FakeEventTarget {
  constructor() {
    this.listeners = Object.create(null);
  }
  addEventListener(type, fn, opts) {
    if (!fn) return;
    const capture = opts === true || (typeof opts === 'object' && !!opts?.capture);
    const once = typeof opts === 'object' && !!opts?.once;
    const list = (this.listeners[type] ||= []);
    if (list.some(l => l.fn === fn && l.capture === capture)) return;
    list.push({ fn, once, capture });
  }
  removeEventListener(type, fn, opts) {
    const capture = opts === true || (typeof opts === 'object' && !!opts?.capture);
    this.listeners[type] = (this.listeners[type] || []).filter(l => l.fn !== fn || l.capture !== capture);
  }
  /** The listeners registered for one event type. */
  listenersOf(type) {
    return (this.listeners[type] || []).map(l => l.fn);
  }
  get eventParent() {
    return null;
  }
  /* Capture listeners run from the top down to the target. Then the other
     listeners and the on<type> property run at the target, and on the way back
     up when the event bubbles. */
  dispatchEvent(ev) {
    const e = wrapEvent(ev, this);
    const path = [];
    for (let at = this; at; at = at.eventParent) path.push(at);
    const run = (at, phase, capture) => {
      if (e.stopped) return;
      e.currentTarget = at;
      e.eventPhase = phase;
      for (const l of [...(at.listeners[e.type] || [])]) {
        if (e.stoppedNow) break;
        if (l.capture !== capture) continue;
        if (l.once) at.removeEventListener(e.type, l.fn, l.capture);
        l.fn.call(at, e);
      }
      const prop = !capture && at[`on${e.type}`];
      if (typeof prop === 'function' && !e.stoppedNow) prop.call(at, e);
    };
    for (let i = path.length - 1; i > 0; i--) run(path[i], 1, true);
    run(this, 2, true);
    run(this, 2, false);
    if (e.bubbles) for (let i = 1; i < path.length; i++) run(path[i], 3, false);
    if (e.defaultPrevented && typeof ev?.preventDefault === 'function') ev.preventDefault();
    return !e.defaultPrevented;
  }
}

function wrapEvent(ev, target) {
  const e = Object.create(null);
  for (const k of Object.keys(ev || {})) e[k] = ev[k];
  for (const k of ['type', 'bubbles', 'detail', 'key', 'persisted']) if (ev?.[k] !== undefined) e[k] = ev[k];
  e.target = ev?.target && !(ev instanceof Event) ? ev.target : target;
  e.defaultPrevented = false;
  e.stopped = false;
  e.preventDefault = () => {
    e.defaultPrevented = true;
  };
  e.stopPropagation = () => {
    e.stopped = true;
  };
  e.stoppedNow = false;
  e.stopImmediatePropagation = () => {
    e.stopped = true;
    e.stoppedNow = true;
  };
  e.composedPath = () => [];
  return e;
}

export class FakeElement extends FakeEventTarget {
  constructor(tag, owner) {
    super();
    this.tagName = String(tag).toUpperCase();
    this.ownerDocument = owner;
    this.attrs = new Map();
    this.childNodes = [];
    this.parentElement = null;
    this.value = '';
    this.checked = false;
    this.inert = false;
    this.type = '';
    this.files = null;
    const style = Object.create(null);
    Object.defineProperties(style, {
      setProperty: { value: (k, v) => (style[k] = String(v)) },
      removeProperty: { value: k => delete style[k] },
      getPropertyValue: { value: k => style[k] ?? '' },
    });
    this.style = style;
    this.dataset = new Proxy(
      {},
      {
        get: (_o, k) => this.attrs.get(dataAttr(k)),
        set: (_o, k, v) => {
          this.attrs.set(dataAttr(k), String(v));
          return true;
        },
        deleteProperty: (_o, k) => this.attrs.delete(dataAttr(k)),
      },
    );
    const read = () => new Set((this.attrs.get('class') || '').split(/\s+/).filter(Boolean));
    const write = set => this.attrs.set('class', [...set].join(' '));
    this.classList = {
      contains: c => read().has(c),
      add: (...c) => write(new Set([...read(), ...c])),
      remove: (...c) => {
        const s = read();
        for (const x of c) s.delete(x);
        write(s);
      },
      toggle: (c, on) => {
        const s = read();
        const want = on === undefined ? !s.has(c) : !!on;
        if (want) s.add(c);
        else s.delete(c);
        write(s);
        return want;
      },
    };
  }
  get nodeType() {
    return 1;
  }
  get eventParent() {
    return this.parentElement ?? (this === this.ownerDocument?.documentElement ? this.ownerDocument : null);
  }
  get children() {
    return this.childNodes.filter(c => c.nodeType === 1);
  }
  get hidden() {
    return this.attrs.has('hidden');
  }
  set hidden(v) {
    this.toggleAttribute('hidden', !!v);
  }
  get disabled() {
    return this.attrs.has('disabled');
  }
  set disabled(v) {
    this.toggleAttribute('disabled', !!v);
  }
  get id() {
    return this.attrs.get('id') || '';
  }
  set id(v) {
    this.attrs.set('id', String(v));
  }
  get className() {
    return this.attrs.get('class') || '';
  }
  set className(v) {
    this.attrs.set('class', String(v));
  }
  get href() {
    return this.attrs.get('href') || '';
  }
  set href(v) {
    this.attrs.set('href', String(v));
  }
  get download() {
    return this.attrs.get('download') || '';
  }
  set download(v) {
    this.attrs.set('download', String(v));
  }
  get title() {
    return this.attrs.get('title') || '';
  }
  set title(v) {
    this.attrs.set('title', String(v));
  }
  get isConnected() {
    const doc = this.ownerDocument;
    for (let x = this; x; x = x.parentElement) if (x === doc?.documentElement) return true;
    return false;
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get lastElementChild() {
    return this.children.at(-1) || null;
  }
  get nextElementSibling() {
    const sibs = this.parentElement ? this.parentElement.children : [];
    const at = sibs.indexOf(this);
    return at < 0 ? null : sibs[at + 1] || null;
  }
  get previousElementSibling() {
    const sibs = this.parentElement ? this.parentElement.children : [];
    return sibs[sibs.indexOf(this) - 1] || null;
  }
  get offsetWidth() {
    return 0;
  }
  get offsetHeight() {
    return 0;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  }
  getClientRects() {
    return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : [];
  }
  getAttribute(n) {
    return this.attrs.has(n) ? this.attrs.get(n) : null;
  }
  setAttribute(n, v) {
    this.attrs.set(n, String(v));
  }
  removeAttribute(n) {
    this.attrs.delete(n);
  }
  hasAttribute(n) {
    return this.attrs.has(n);
  }
  toggleAttribute(n, on) {
    const want = on === undefined ? !this.attrs.has(n) : !!on;
    if (want) this.attrs.set(n, '');
    else this.attrs.delete(n);
    return want;
  }
  get textContent() {
    return this.childNodes.map(c => c.textContent).join('');
  }
  set textContent(v) {
    this.replaceChildren();
    if (v != null && v !== '') this.appendChild(this.ownerDocument.createTextNode(v));
  }
  get outerHTML() {
    const tag = this.tagName.toLowerCase();
    const attrs = [...this.attrs].map(([k, v]) => ` ${k}="${encode(v, true)}"`).join('');
    return VOID.has(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}>${this.innerHTML}</${tag}>`;
  }
  get innerHTML() {
    return this.childNodes.map(c => (c.nodeType === 3 ? encode(c.data) : c.outerHTML)).join('');
  }
  set innerHTML(markup) {
    this.replaceChildren();
    const stack = [this];
    for (const m of String(markup).matchAll(/<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
      const top = stack[stack.length - 1];
      if (m[0].startsWith('<!--')) continue;
      if (m[4] !== undefined) {
        if (m[4].trim()) top.appendChild(this.ownerDocument.createTextNode(decode(m[4])));
        continue;
      }
      if (m[0][1] === '/') {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const inSvg = m[1].toLowerCase() === 'svg' || top.namespaceURI === SVG_NS;
      const node = inSvg ? this.ownerDocument.createElementNS(SVG_NS, m[1]) : this.ownerDocument.createElement(m[1]);
      for (const a of m[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) node.attrs.set(a[1], decode(a[2] ?? ''));
      if (node.attrs.has('value')) node.value = node.attrs.get('value');
      if (node.attrs.has('type')) node.type = node.attrs.get('type');
      node.checked = node.attrs.has('checked');
      top.appendChild(node);
      if (!m[3] && !VOID.has(m[1].toLowerCase())) stack.push(node);
    }
  }
  appendChild(c) {
    c.parentElement?.removeChild(c);
    c.parentElement = this;
    this.childNodes.push(c);
    return c;
  }
  append(...kids) {
    for (const k of kids) this.appendChild(typeof k === 'string' ? this.ownerDocument.createTextNode(k) : k);
  }
  prepend(...kids) {
    for (const k of kids.reverse())
      this.insertBefore(typeof k === 'string' ? this.ownerDocument.createTextNode(k) : k, this.firstChild);
  }
  removeChild(c) {
    this.childNodes = this.childNodes.filter(x => x !== c);
    c.parentElement = null;
    return c;
  }
  insertBefore(c, ref) {
    this.appendChild(c);
    this.childNodes.pop();
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, c);
    return c;
  }
  replaceChildren(...kids) {
    for (const c of this.childNodes) c.parentElement = null;
    this.childNodes = [];
    for (const k of kids) this.appendChild(typeof k === 'string' ? this.ownerDocument.createTextNode(k) : k);
  }
  replaceWith(other) {
    const p = this.parentElement;
    if (!p) return;
    other.parentElement?.removeChild(other);
    p.childNodes[p.childNodes.indexOf(this)] = other;
    other.parentElement = p;
    this.parentElement = null;
  }
  remove() {
    this.parentElement?.removeChild(this);
  }
  contains(n) {
    for (let x = n; x; x = x.parentElement) if (x === this) return true;
    return false;
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  select() {}
  get open() {
    return this.attrs.has('open');
  }
  set open(v) {
    this.toggleAttribute('open', !!v);
  }
  showModal() {
    this.setAttribute('open', '');
  }
  show() {
    this.setAttribute('open', '');
  }
  close() {
    if (!this.open) return;
    this.removeAttribute('open');
    this.dispatchEvent({ type: 'close' });
  }
  click() {
    this.dispatchEvent({ type: 'click', bubbles: true, detail: 1 });
  }
  animate() {
    return { cancel() {}, finish() {}, onfinish: null, oncancel: null, finished: Promise.resolve() };
  }
  get content() {
    return this.tagName === 'TEMPLATE' ? this : undefined;
  }
  cloneNode(deep = false) {
    const tag = this.tagName.toLowerCase();
    const copy =
      this.namespaceURI === SVG_NS
        ? this.ownerDocument.createElementNS(SVG_NS, tag)
        : this.ownerDocument.createElement(tag);
    for (const [k, v] of this.attrs) copy.attrs.set(k, v);
    for (const k of ['value', 'checked', 'type']) copy[k] = this[k];
    if (deep) for (const c of this.childNodes) copy.appendChild(c.cloneNode(true));
    return copy;
  }
  getAnimations() {
    return [];
  }
  matches(sel) {
    return sel.split(',').some(s => matchesComplex(this, s.trim(), null));
  }
  closest(sel) {
    for (let x = this; x; x = x.parentElement) if (x.matches(sel)) return x;
    return null;
  }
  querySelectorAll(sel) {
    const parts = sel.split(',').map(s => s.trim());
    const out = [];
    const walk = n => {
      for (const c of n.children) {
        if (parts.some(s => matchesComplex(c, s, this))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

class FakeText extends FakeEventTarget {
  constructor(text, owner) {
    super();
    this.ownerDocument = owner;
    this.parentElement = null;
    this.data = String(text);
  }
  get nodeType() {
    return 3;
  }
  get eventParent() {
    return this.parentElement;
  }
  get textContent() {
    return this.data;
  }
  set textContent(v) {
    this.data = v == null ? '' : String(v);
  }
  get nextSibling() {
    const sibs = this.parentElement ? this.parentElement.childNodes : [];
    return sibs[sibs.indexOf(this) + 1] || null;
  }
  remove() {
    this.parentElement?.removeChild(this);
  }
  cloneNode() {
    return new FakeText(this.data, this.ownerDocument);
  }
}

class FakeHTMLElement extends FakeElement {
  get namespaceURI() {
    return 'http://www.w3.org/1999/xhtml';
  }
}
class FakeHTMLInputElement extends FakeHTMLElement {}
class FakeHTMLButtonElement extends FakeHTMLElement {}
class FakeHTMLDialogElement extends FakeHTMLElement {}
class FakeHTMLIFrameElement extends FakeHTMLElement {}
class FakeSVGElement extends FakeElement {
  get namespaceURI() {
    return SVG_NS;
  }
}
class FakeSVGSVGElement extends FakeSVGElement {}

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_CLASS = {
  input: FakeHTMLInputElement,
  button: FakeHTMLButtonElement,
  dialog: FakeHTMLDialogElement,
  iframe: FakeHTMLIFrameElement,
};

/* Compound selectors joined by descendant or child combinators. */
function matchesComplex(el, sel, scope) {
  const tokens = sel
    .replace(/\s*>\s*/g, ' > ')
    .split(/\s+/)
    .filter(Boolean);
  return matchFrom(el, tokens, tokens.length - 1, scope);
}

function matchFrom(el, tokens, i, scope) {
  if (!matchCompound(el, tokens[i], scope)) return false;
  if (i === 0) return true;
  if (tokens[i - 1] === '>') {
    const parent = el.parentElement;
    return !!parent && matchFrom(parent, tokens, i - 2, scope);
  }
  for (let at = el.parentElement; at; at = at.parentElement) if (matchFrom(at, tokens, i - 1, scope)) return true;
  return false;
}

function matchCompound(el, simple, scope) {
  if (simple === ':scope') return el === scope;
  const m = simple.match(/^(\*|[a-z][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\]|:not\([^)]*\))*)$/i);
  if (!m) throw new Error(`fake-dom cannot read the selector "${simple}"`);
  if (m[1] && m[1] !== '*' && el.tagName !== m[1].toUpperCase()) return false;
  for (const part of m[2].match(/[#.][\w-]+|\[[^\]]+\]|:not\([^)]*\)/g) || []) {
    if (part.startsWith(':not(')) {
      if (matchCompound(el, part.slice(5, -1), scope)) return false;
    } else if (part[0] === '#') {
      if (el.id !== part.slice(1)) return false;
    } else if (part[0] === '.') {
      if (!el.classList.contains(part.slice(1))) return false;
    } else {
      const [, name, op, val] = part.match(/^\[([\w-]+)(?:([\^$*]?=)"?([^"\]]*)"?)?\]$/) || [];
      if (!name || !el.attrs.has(name)) return false;
      const have = el.attrs.get(name);
      if (op === '=' && have !== val) return false;
      if (op === '^=' && !have.startsWith(val)) return false;
      if (op === '$=' && !have.endsWith(val)) return false;
      if (op === '*=' && !have.includes(val)) return false;
    }
  }
  return true;
}

export class FakeDocument extends FakeEventTarget {
  constructor() {
    super();
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
    this.title = '';
    this.hidden = false;
  }
  get eventParent() {
    return this.defaultView ?? null;
  }
  createElement(tag) {
    const Kind = HTML_CLASS[String(tag).toLowerCase()] || FakeHTMLElement;
    return new Kind(tag, this);
  }
  createElementNS(ns, tag) {
    if (ns !== SVG_NS) return this.createElement(tag);
    const el = String(tag).toLowerCase() === 'svg' ? new FakeSVGSVGElement(tag, this) : new FakeSVGElement(tag, this);
    el.tagName = String(tag);
    return el;
  }
  createTextNode(text) {
    return new FakeText(text, this);
  }
  getElementById(id) {
    return this.documentElement.querySelector(`#${id}`);
  }
  querySelector(sel) {
    return this.documentElement.matches(sel) ? this.documentElement : this.documentElement.querySelector(sel);
  }
  querySelectorAll(sel) {
    return this.documentElement.querySelectorAll(sel);
  }
}

/** Build markup into the document body and return the document.
    @param {string} [markup] */
export function createDocument(markup = '') {
  const doc = new FakeDocument();
  if (markup) doc.body.innerHTML = markup;
  return doc;
}

/** Set a global for the rest of the test file and keep what it replaced. */
function put(saved, key, value) {
  if (!(key in saved)) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

/** A fetch that answers from a route table and records every call.
    @param {Record<string, any>} routes "METHOD /path" or "/path" to a value, a
      status-bearing reply ({ status, body }) or a function (url, opts) returning either */
export function fakeFetch(routes = {}) {
  const calls = [];
  const reply = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    json: async () => (body === undefined ? null : structuredClone(body)),
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body ?? null)),
  });
  const fetch = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const path = String(url);
    const call = { url: path, method, body: opts.body, opts };
    calls.push(call);
    const route = routes[`${method} ${path}`] ?? (method === 'GET' ? routes[path] : undefined);
    if (route === undefined) return reply(404, { error: 'not found' });
    const got = typeof route === 'function' ? await route(path, opts) : route;
    if (got instanceof Error) throw got;
    if (
      got &&
      typeof got === 'object' &&
      'status' in got &&
      Object.keys(got).every(k => k === 'status' || k === 'body')
    )
      return reply(got.status, got.body);
    return reply(200, got);
  };
  fetch.calls = calls;
  fetch.routes = routes;
  return fetch;
}

/** Install a document and the window globals page modules read.
    @param {{ markup?: string, fetch?: any, storage?: Record<string,string>, reduceMotion?: boolean, location?: string }} [opts] */
export function installDom(opts = {}) {
  const saved = {};
  const doc = createDocument(opts.markup);
  const win = new FakeEventTarget();
  const store = new Map(Object.entries(opts.storage || {}));
  const url = new URL(opts.location || 'http://nas.local/admin/');
  const loc = {
    href: url.href,
    host: url.host,
    hostname: url.hostname,
    origin: url.origin,
    pathname: url.pathname,
    hash: url.hash,
    search: url.search,
    reloads: 0,
    reload() {
      this.reloads++;
    },
  };
  const frames = [];
  put(saved, 'document', doc);
  put(saved, 'window', globalThis);
  put(saved, 'location', loc);
  put(saved, 'addEventListener', win.addEventListener.bind(win));
  put(saved, 'removeEventListener', win.removeEventListener.bind(win));
  put(saved, 'dispatchEvent', win.dispatchEvent.bind(win));
  put(saved, 'innerWidth', 1280);
  put(saved, 'innerHeight', 800);
  put(saved, 'scrollTo', () => {});
  put(saved, 'matchMedia', q => ({
    matches: q.includes('reduced-motion') ? !!opts.reduceMotion : false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
  put(saved, 'requestAnimationFrame', fn => frames.push(fn));
  put(saved, 'cancelAnimationFrame', () => {});
  put(saved, 'getComputedStyle', () => ({ direction: 'ltr', transform: 'none', getPropertyValue: () => '' }));
  put(saved, 'localStorage', {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  });
  put(saved, 'screen', { orientation: new FakeEventTarget() });
  put(saved, 'CSS', { escape: s => s, supports: () => false });
  doc.defaultView = win;
  put(saved, 'Element', FakeElement);
  put(saved, 'HTMLElement', FakeHTMLElement);
  put(saved, 'HTMLInputElement', FakeHTMLInputElement);
  put(saved, 'HTMLButtonElement', FakeHTMLButtonElement);
  put(saved, 'HTMLDialogElement', FakeHTMLDialogElement);
  put(saved, 'HTMLIFrameElement', FakeHTMLIFrameElement);
  put(saved, 'SVGElement', FakeSVGElement);
  put(saved, 'SVGSVGElement', FakeSVGSVGElement);
  if (opts.fetch !== undefined) put(saved, 'fetch', opts.fetch);
  return {
    document: doc,
    window: win,
    location: loc,
    storage: store,
    /** Run the animation frames queued so far. */
    flushFrames() {
      for (const fn of frames.splice(0)) fn(0);
    },
    restore() {
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete globalThis[k];
      }
    },
  };
}

/** Dispatch an event on a fake element, bubbling by default.
    @param {any} target @param {string} type @param {Record<string, any>} [props] */
export function fire(target, type, props = {}) {
  return target.dispatchEvent({ bubbles: true, ...props, type });
}

/** Let queued promise callbacks and zero-delay timers run. */
export const settle = (ms = 0) => new Promise(r => setTimeout(r, ms));

const UI_DIR = new URL('../', import.meta.url);

/** The markup inside <body> of a page under ui/, such as 'admin/index.html'.
    @param {string} page */
export function pageBody(page) {
  const html = readFileSync(new URL(page, UI_DIR), 'utf8');
  const open = html.indexOf('<body');
  return html.slice(html.indexOf('>', open) + 1, html.lastIndexOf('</body>'));
}

/** fakeFetch routes that serve the shipped English catalog, so t() returns real sentences. */
export function catalogRoutes() {
  const en = JSON.parse(readFileSync(new URL('i18n/en.json', UI_DIR), 'utf8'));
  return { '/i18n/en.json': en };
}
