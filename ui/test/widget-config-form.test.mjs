import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

const form = fs.readFileSync(new URL('../js/widget-config-form.js', import.meta.url), 'utf8');

test('the config rows draw the pencil from the icon set', () => {
  assert.doesNotMatch(form, /<svg/, 'a glyph drawn here ignores the chosen icon style');
  assert.match(form, /import \{[^}]*\bPE_SVG\b[^}]*\} from '\/js\/admin-shared\.js/);
  assert.equal(form.match(/raw\(PE_SVG\)/g)?.length, 2);
});

test('the Fetch row is built once, and every picker honours fetchLabel', () => {
  assert.equal(form.match(/t\('widgetCfg\.fetching'\)/g)?.length, 1);
  assert.equal(form.match(/await fetchFieldOptions\(field, ctx\)/g)?.length, 1);
  assert.doesNotMatch(form, /textContent = t\('widgetCfg\.fetch'\)/);
  assert.match(form, /btn\.textContent = field\.fetchLabel \|\| t\('widgetCfg\.fetch'\)/);
  for (const picker of ['_picklist', '_select']) {
    const start = form.indexOf(`function ${picker}(`);
    const body = form.slice(start, form.indexOf('\nfunction ', start + 1));
    assert.match(body, /_fetchRow\(field, ctx, /, picker);
  }
});

test('an option Fetch goes through the shared request path', () => {
  assert.doesNotMatch(form, /\bfetch\(/);
  assert.match(form, /await apiPost\(`\/api\/widget-options\//);
});

/* A redraw of the same form builds it again from the values carried out of the
   old one. Nothing the user typed may be lost or reassigned on the way. */

register('./js-root-hooks.mjs', import.meta.url);

const VOID = new Set(['input', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use']);
const decode = s =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

class FakeEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.parentElement = null;
    this.on = Object.create(null);
    this.style = { setProperty: (k, v) => (this.style[k] = v) };
    this._text = '';
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.dataset = new Proxy(
      {},
      {
        get: (_o, k) => this.attrs.get('data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase())),
        set: (_o, k, v) => {
          this.attrs.set('data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase()), String(v));
          return true;
        },
      },
    );
    const classes = () => new Set((this.attrs.get('class') || '').split(/\s+/).filter(Boolean));
    const write = set => this.attrs.set('class', [...set].join(' '));
    this.classList = {
      contains: c => classes().has(c),
      add: (...c) => write(new Set([...classes(), ...c])),
      remove: (...c) => {
        const s = classes();
        for (const x of c) s.delete(x);
        write(s);
      },
      toggle: (c, on) => {
        const s = classes();
        const want = on === undefined ? !s.has(c) : !!on;
        if (want) s.add(c);
        else s.delete(c);
        write(s);
        return want;
      },
    };
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
  get isConnected() {
    return true;
  }
  get offsetHeight() {
    return 0;
  }
  get offsetWidth() {
    return 0;
  }
  get previousElementSibling() {
    const sibs = this.parentElement ? this.parentElement.children : [];
    return sibs[sibs.indexOf(this) - 1] || null;
  }
  get lastElementChild() {
    return this.children.at(-1) || null;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
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
  get textContent() {
    return this._text + this.children.map(c => c.textContent).join('');
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  appendChild(c) {
    if (c.parentElement) c.parentElement.children = c.parentElement.children.filter(x => x !== c);
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  insertBefore(c, ref) {
    this.appendChild(c);
    this.children.pop();
    const at = this.children.indexOf(ref);
    this.children.splice(at < 0 ? this.children.length : at, 0, c);
    return c;
  }
  replaceChildren(...kids) {
    for (const c of this.children) c.parentElement = null;
    this.children = [];
    this._text = '';
    for (const k of kids) this.appendChild(k);
  }
  replaceWith(other) {
    const p = this.parentElement;
    if (!p) return;
    if (other.parentElement) other.parentElement.children = other.parentElement.children.filter(x => x !== other);
    p.children[p.children.indexOf(this)] = other;
    other.parentElement = p;
    this.parentElement = null;
  }
  contains(n) {
    for (let x = n; x; x = x.parentElement) if (x === this) return true;
    return false;
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(x => x !== this);
    this.parentElement = null;
  }
  focus() {}
  select() {}
  addEventListener(type, fn) {
    (this.on[type] ||= []).push(fn);
  }
  removeEventListener() {}
  dispatchEvent(ev) {
    this.fire(ev.type, {}, ev.bubbles);
    return true;
  }
  fire(type, props = {}, bubbles = true) {
    const ev = { type, target: this, preventDefault() {}, stopPropagation() {}, composedPath: () => [], ...props };
    for (let x = this; x; x = bubbles ? x.parentElement : null) {
      for (const fn of x.on[type] || []) fn(ev);
      if (typeof x[`on${type}`] === 'function') x[`on${type}`](ev);
    }
  }
  set innerHTML(markup) {
    this.children = [];
    this._text = '';
    const stack = [this];
    for (const m of markup.matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g)) {
      const top = stack[stack.length - 1];
      if (m[4] !== undefined) {
        if (m[4].trim()) top._text += decode(m[4]);
        continue;
      }
      if (m[0][1] === '/') {
        stack.pop();
        continue;
      }
      const node = new FakeEl(m[1]);
      for (const a of m[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) node.attrs.set(a[1], decode(a[2] ?? ''));
      if (node.attrs.has('value')) node.value = node.attrs.get('value');
      if (node.attrs.has('type')) node.type = node.attrs.get('type');
      node.checked = node.attrs.has('checked');
      top.appendChild(node);
      if (!m[3] && !VOID.has(m[1].toLowerCase())) stack.push(node);
    }
  }
  matches(sel) {
    const parts = sel.trim().split(/\s+/);
    if (!matchOne(this, parts[parts.length - 1])) return false;
    let at = this.parentElement;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (at && !matchOne(at, parts[i])) at = at.parentElement;
      if (!at) return false;
      at = at.parentElement;
    }
    return true;
  }
  closest(sel) {
    for (let x = this; x; x = x.parentElement) if (x.matches(sel)) return x;
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = n => {
      for (const c of n.children) {
        if (sel.split(',').some(s => c.matches(s))) out.push(c);
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

function matchOne(el, simple) {
  const m = simple.match(/^([a-z]*)((?:[#.][\w-]+)*)((?:\[[^\]]+\])*)$/i);
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  for (const t of m[2].match(/[#.][\w-]+/g) || []) {
    if (t[0] === '#' ? el.id !== t.slice(1) : !el.classList.contains(t.slice(1))) return false;
  }
  for (const a of m[3].match(/\[[^\]]+\]/g) || []) {
    const [, name, val] = a.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/) || [];
    if (!el.attrs.has(name) || (val !== undefined && el.attrs.get(name) !== val)) return false;
  }
  return true;
}

const body = new FakeEl('body');
globalThis.visualViewport = { width: 400, height: 800, addEventListener() {} };
globalThis.CSS = { escape: s => s };
globalThis.getComputedStyle = () => ({ direction: 'ltr', getPropertyValue: () => '38px' });
globalThis.document = {
  body,
  activeElement: null,
  documentElement: { getAttribute: () => null },
  addEventListener() {},
  getElementById: id => body.querySelectorAll(`#${id}`)[0] || null,
  createElement: tag =>
    tag === 'canvas'
      ? {
          getContext: () => {
            let v = '#000000';
            return {
              set fillStyle(x) {
                if (/^#[0-9a-f]{6}$/i.test(String(x).trim())) v = String(x).trim().toLowerCase();
              },
              get fillStyle() {
                return v;
              },
            };
          },
        }
      : new FakeEl(tag),
};

const { renderWidgetConfigForm } = await import('../js/widget-config-form.js');
const { t } = await import('../js/i18n.js');
const { SAVED_ROW } = await import('../js/saved-row.js');

const opt = (...vs) => vs.map(v => ({ value: v, label: v.toUpperCase() }));
const FIELDS = [
  { key: 'host', label: 'Host', type: 'text' },
  { key: 'port', label: 'Port', type: 'number' },
  { key: 'tls', label: 'TLS', type: 'toggle' },
  { key: 'mode', label: 'Mode', type: 'select', options: opt('a', 'b', 'c') },
  { key: 'view', label: 'View', type: 'select', variant: 'pills', options: opt('list', 'grid') },
  { key: 'tags', label: 'Tags', type: 'multiselect', options: opt('x', 'y', 'z') },
  { key: 'picks', label: 'Picks', type: 'picklist', count: 2, options: opt('p', 'q', 'r') },
  { key: 'tint', label: 'Tint', type: 'color' },
  { key: 'token', label: 'Token', type: 'secret' },
  {
    key: 'sources',
    label: 'Source',
    type: 'group',
    min: 0,
    max: 4,
    fields: [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'apiKey', label: 'API key', type: 'secret' },
    ],
  },
];
const STORED = {
  host: 'old.lan',
  port: 80,
  tls: false,
  mode: 'a',
  view: 'list',
  tags: ['x'],
  picks: ['p', null],
  tint: '#111111',
  tokenSet: true,
  sources: [
    { name: 'Sonarr', apiKeySet: true },
    { name: 'Radarr', apiKeySet: true },
  ],
};

const byIdEnd = (root, end) => root.querySelectorAll('input').find(n => n.id.endsWith(end));
const rowOf = (root, label) => root.querySelectorAll('.row').find(r => r.querySelector('.rl')?._text.trim() === label);
const typeInto = (row, text) => {
  row.querySelector('.pe').fire('click');
  row.querySelector('.row-inp').value = text;
  row.fire('focusout', { relatedTarget: null });
};
const pick = (row, value) => {
  const btn = row.querySelector('.row-dd-btn');
  btn.fire('click', { detail: 0 });
  body
    .querySelector(`#${btn.getAttribute('aria-controls')}`)
    .querySelectorAll('li')
    .find(li => li.dataset.val === value)
    .fire('click');
};

/* What the editor does on a Size tile or a View change. */
function redraw(box, old, config, size) {
  return renderWidgetConfigForm(box, FIELDS, { ...config, ...old.getValues() }, { size });
}

function editEverything(box) {
  typeInto(rowOf(box, 'Host'), 'new.lan');
  typeInto(rowOf(box, 'Port'), '8443');
  const tog = rowOf(box, 'TLS').querySelector('input');
  tog.checked = true;
  tog.fire('change');
  pick(rowOf(box, 'Mode'), 'c');
  const grid = rowOf(box, 'View')
    .querySelectorAll('input')
    .find(r => r.value === 'grid');
  grid.checked = true;
  grid.fire('change');
  pick(rowOf(box, 'Tags'), 'z');
  pick(rowOf(box, 'Picks 2'), 'r');
  typeInto(byIdEnd(box, '-hex').closest('.row'), '#abcdef');
  typeInto(rowOf(box, 'Token'), 'fresh-token');
}

test('every typed value survives a redraw of the same form', () => {
  const box = new FakeEl('div');
  const first = renderWidgetConfigForm(box, FIELDS, STORED, { size: 'medium' });
  editEverything(box);
  const sources = box.querySelectorAll('.grp').filter(g => rowOf(g, 'API key'));
  typeInto(rowOf(sources[1], 'Name'), 'Radarr 4K');
  typeInto(rowOf(sources[1], 'API key'), 'fresh-row-key');
  const typed = first.getValues();
  assert.equal(typed.host, 'new.lan');
  assert.equal(typed.port, 8443);
  assert.equal(typed.tls, true);
  assert.equal(typed.mode, 'c');
  assert.equal(typed.view, 'grid');
  assert.deepEqual(typed.tags, ['x', 'z']);
  assert.deepEqual(typed.picks, ['p', 'r']);
  assert.equal(typed.tint, '#abcdef');
  assert.equal(typed.token, 'fresh-token');
  assert.equal(typed.sources[1].apiKey, 'fresh-row-key');

  const second = redraw(box, first, STORED, 'large');
  assert.deepEqual({ ...second.getValues() }, { ...typed });
  assert.equal(rowOf(box, 'Token').querySelector('.rv').textContent, t('widgetCfg.newValueSet'));
  const after = box.querySelectorAll('.grp').filter(g => rowOf(g, 'API key'));
  assert.equal(rowOf(after[1], 'API key').querySelector('.rv').textContent, t('widgetCfg.newValueSet'));
  assert.equal(rowOf(after[0], 'API key').querySelector('.rv').textContent, t('common.configured'));
});

test('a group row keeps the saved row it came from across a redraw', () => {
  const box = new FakeEl('div');
  const first = renderWidgetConfigForm(box, FIELDS, STORED, { size: 'medium' });
  assert.deepEqual(
    first.getValues().sources.map(r => r[SAVED_ROW]),
    [0, 1],
  );
  box.querySelectorAll('.grp-hdr-rm')[0].fire('click');
  assert.deepEqual(
    first.getValues().sources.map(r => [r.name, r[SAVED_ROW]]),
    [['Radarr', 1]],
  );
  const second = redraw(box, first, STORED, 'large');
  const rows = second.getValues().sources;
  assert.deepEqual(
    rows.map(r => [r.name, r[SAVED_ROW], r.apiKeySet]),
    [['Radarr', 1, true]],
  );
  box.querySelector('.wcf-add-row').fire('click');
  const third = redraw(box, second, STORED, 'medium');
  assert.deepEqual(
    third.getValues().sources.map(r => r[SAVED_ROW]),
    [1, null],
  );
});
