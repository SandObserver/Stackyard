/* A typed code or a picked swatch is saved exactly. The sliders are whole
   numbers, so a colour read back out of them is a near neighbour, not the one
   picked. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const VOID = new Set(['input', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'use']);
const decode = s =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/* An element only as real as the colour control and the inline edit row use. */
class FakeEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.children = [];
    this.parentElement = null;
    this.on = Object.create(null);
    this.style = {};
    this._text = '';
    this.value = '';
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
  fire(type, props = {}) {
    const ev = { type, target: this, preventDefault() {}, stopPropagation() {}, ...props };
    for (let x = this; x; x = x.parentElement) for (const fn of x.on[type] || []) fn(ev);
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

globalThis.CSS = { escape: s => s };
globalThis.document = {
  documentElement: { getAttribute: () => null },
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

const { renderColorControl, _internals } = await import('../js/admin-color-control.js');

/* Each of these comes back as a different colour once read out of the sliders. */
const SHIFTED = ['#abcdef', '#0289ff', '#123456', '#1c1c1e'];

function control(opts = {}) {
  const box = new FakeEl('div');
  const changes = [];
  const api = renderColorControl(box, { idPrefix: 'cc', value: '#ff393c', onChange: v => changes.push(v), ...opts });
  const $ = sel => box.querySelector(sel);
  const type = text => {
    $('#cc-code-row .pe').fire('click');
    $('#cc-hex').value = text;
    $('#cc-code-row').fire('focusout', { relatedTarget: null });
  };
  return { api, box, $, changes, type };
}

test('the cases really do shift through the sliders', () => {
  const { hexToHsv, hsvToRgb } = _internals;
  for (const hex of SHIFTED) {
    const { h, s, v } = hexToHsv(hex);
    const back =
      '#' +
      hsvToRgb(h, s, v)
        .map(n => n.toString(16).padStart(2, '0'))
        .join('');
    assert.notEqual(back, hex, `${hex} no longer proves anything`);
  }
});

test('a typed colour code is saved exactly as typed', () => {
  for (const hex of SHIFTED) {
    const { api, $, changes, type } = control();
    type(hex);
    assert.equal(api.getValue(), hex);
    assert.equal(changes.at(-1), hex);
    assert.equal($('#cc-code-row .rv').textContent, hex, 'the row shows a code nobody typed');
  }
});

test('a typed code in capitals or without its hash saves the same colour', () => {
  const { api, type } = control();
  type('ABCDEF');
  assert.equal(api.getValue(), '#abcdef');
});

test('a typed code still moves the sliders to show it', () => {
  const { $, type } = control();
  type('#abcdef');
  const want = _internals.hexToHsv('#abcdef');
  assert.deepEqual([+$('#cc-h').value, +$('#cc-s').value, +$('#cc-v').value], [want.h, want.s, want.v]);
});

test('a preset swatch is saved exactly as picked', () => {
  for (const hex of ['#0289ff', '#1c1c1e']) {
    const { api, $ } = control();
    $(`.cc-swatch[data-v="${hex}"]`).fire('click');
    assert.equal(api.getValue(), hex);
  }
});

test('a slider drag saves what the sliders show', () => {
  const { api, $, type } = control();
  type('#abcdef');
  $('#cc-h').value = '100';
  $('#cc-h').fire('input');
  const { h, s, v } = { h: 100, s: +$('#cc-s').value, v: +$('#cc-v').value };
  const want =
    '#' +
    _internals
      .hsvToRgb(h, s, v)
      .map(n => n.toString(16).padStart(2, '0'))
      .join('');
  assert.equal(api.getValue(), want);
});

test('opening the sliders does not change a stored colour', () => {
  const { api, $ } = control({ value: '#123456' });
  $('.cc-rainbow').fire('click');
  assert.equal(api.getValue(), '#123456');
});

test('an emptied code row keeps the colour that was there', () => {
  const { api, type } = control();
  type('#abcdef');
  type('');
  assert.equal(api.getValue(), '#abcdef');
});

test('a system colour turned into a custom one keeps that exact colour', async () => {
  const { tileColor } = await import('../js/palette.js');
  globalThis.document.body = new FakeEl('body');
  const { api, $ } = control({ variant: 'tile', value: '#ff393c' });
  $('.cc-kw-indigo').fire('click');
  assert.equal(api.getValue(), 'indigo');
  $('.cc-hues .cc-rainbow').fire('click');
  assert.equal(api.getValue(), tileColor('indigo', 'dark'));
});
