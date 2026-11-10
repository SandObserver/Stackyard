/* An inline-edit row stays open while focus moves between its own controls,
   commits when focus leaves the row, and Escape puts the field and everything
   that listens to it back as it was. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';

register('./js-root-hooks.mjs', import.meta.url);

class Node {
  constructor(cls = '') {
    this.parent = null;
    this.kids = [];
    this.listeners = {};
    this.classes = new Set(cls.split(' ').filter(Boolean));
    this.attrs = {};
    this.style = {};
    this.id = '';
    this.textContent = '';
    this.value = '';
    this.classList = {
      add: c => this.classes.add(c),
      remove: c => this.classes.delete(c),
      contains: c => this.classes.has(c),
    };
  }
  append(...kids) {
    for (const k of kids) {
      k.parent = this;
      this.kids.push(k);
    }
    return this;
  }
  insertBefore(node, ref) {
    node.parent = this;
    this.kids.splice(this.kids.indexOf(ref), 0, node);
  }
  contains(node) {
    for (let n = node; n; n = n.parent) if (n === this) return true;
    return false;
  }
  querySelector(sel) {
    const cls = sel.slice(1);
    for (const k of this.kids) {
      if (k.classes.has(cls)) return k;
      const hit = k.querySelector(sel);
      if (hit) return hit;
    }
    return null;
  }
  hasAttribute(k) {
    return k in this.attrs;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatchEvent(ev) {
    for (const fn of this.listeners[ev.type] || []) fn(ev);
    return true;
  }
  focus() {
    moveFocus(this);
  }
  select() {}
}

let active = null;
function moveFocus(to) {
  const from = active;
  active = to;
  if (!from || from === to) return;
  fire(from, 'blur', { relatedTarget: to }, false);
  fire(from, 'focusout', { relatedTarget: to });
}

function fire(target, type, props = {}, bubbles = true) {
  const ev = { type, target, defaultPrevented: false, preventDefault: () => (ev.defaultPrevented = true), ...props };
  for (let n = target; n; n = bubbles ? n.parent : null) {
    for (const fn of n.listeners[type] || []) fn(ev);
  }
  return ev;
}

globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.location = /** @type {any} */ ({ host: 'nas.local', hostname: 'nas.local' });
const { wireInlineEdit } = await import('../js/admin-shared.js');

function passwordRow(opts = {}) {
  const row = new Node('row ie-row');
  row.id = 'ie-pw';
  const label = new Node('rl');
  label.textContent = 'Password';
  const valEl = new Node('rv is-ph');
  const pen = new Node('pe');
  const eye = new Node('pw-reveal');
  row.append(label, valEl, pen, eye);
  const inp = new Node();
  const outside = new Node();
  const commits = [];
  const cancels = [];
  wireInlineEdit(/** @type {any} */ (row), /** @type {any} */ (inp), {
    type: 'password',
    fill: false,
    onCommit: v => commits.push(v),
    onCancel: v => cancels.push(v),
    ...opts,
  });
  active = null;
  const open = () => {
    active = pen;
    fire(pen, 'click');
  };
  const type = text => {
    inp.value = text;
    inp.dispatchEvent({ type: 'input' });
  };
  return {
    row,
    inp,
    pen,
    eye,
    outside,
    commits,
    cancels,
    open,
    type,
    editing: () => row.classList.contains('editing'),
  };
}

test('Tab from the field to the show-password button keeps the row open', () => {
  const r = passwordRow();
  r.open();
  assert.equal(active, r.inp);
  r.type('secret');
  moveFocus(r.eye);
  assert.equal(r.editing(), true);
  assert.deepEqual(r.commits, []);
  moveFocus(r.inp);
  assert.equal(r.editing(), true);
});

test('focus leaving the row commits, from the field or from the button', () => {
  const a = passwordRow();
  a.open();
  a.type('secret');
  moveFocus(a.eye);
  moveFocus(a.outside);
  assert.equal(a.editing(), false);
  assert.deepEqual(a.commits, ['secret']);

  const b = passwordRow();
  b.open();
  b.type('other');
  moveFocus(b.outside);
  assert.equal(b.editing(), false);
  assert.deepEqual(b.commits, ['other']);
});

test('focus leaving for nothing, as when the window loses focus, commits', () => {
  const r = passwordRow();
  r.open();
  r.type('secret');
  fire(r.inp, 'blur', { relatedTarget: null }, false);
  fire(r.inp, 'focusout', { relatedTarget: null });
  assert.deepEqual(r.commits, ['secret']);
});

test('Enter in the field commits and returns focus to the pencil', () => {
  const r = passwordRow();
  r.open();
  r.type('secret');
  const ev = fire(r.inp, 'keydown', { key: 'Enter' });
  assert.equal(ev.defaultPrevented, true);
  assert.deepEqual(r.commits, ['secret']);
  assert.equal(active, r.pen);
});

test('Enter on the show-password button does not commit the row', () => {
  const r = passwordRow();
  r.open();
  moveFocus(r.eye);
  fire(r.eye, 'keydown', { key: 'Enter' });
  assert.equal(r.editing(), true);
  assert.deepEqual(r.commits, []);
});

test('Escape restores the value and tells everything that tracks the field', () => {
  const r = passwordRow();
  const seen = [];
  r.inp.addEventListener('input', () => seen.push(r.inp.value));
  r.open();
  r.type('abc');
  const ev = fire(r.inp, 'keydown', { key: 'Escape' });
  assert.equal(ev.defaultPrevented, true);
  assert.equal(r.inp.value, '');
  assert.deepEqual(seen, ['abc', ''], 'an input event reports the restored value');
  assert.deepEqual(r.cancels, ['']);
  assert.deepEqual(r.commits, [], 'Escape is not a commit');
  assert.equal(r.editing(), false);
  assert.equal(active, r.pen);
});

test('Escape keeps a value typed in an earlier edit', () => {
  const r = passwordRow();
  r.open();
  r.type('first');
  moveFocus(r.outside);
  r.open();
  r.type('firstmore');
  fire(r.inp, 'keydown', { key: 'Escape' });
  assert.equal(r.inp.value, 'first');
  assert.deepEqual(r.cancels, ['first']);
});

test('Escape from the show-password button also cancels', () => {
  const r = passwordRow();
  r.open();
  r.type('abc');
  moveFocus(r.eye);
  fire(r.eye, 'keydown', { key: 'Escape' });
  assert.equal(r.inp.value, '');
  assert.equal(r.editing(), false);
  assert.deepEqual(r.commits, []);
});

test('the Settings password row hides its meter when Escape restores the value', () => {
  const admin = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  const rows = admin.slice(admin.indexOf('function initPasswordRows'), admin.indexOf('function initAllInlineEdits'));
  assert.match(rows, /initInlineEdit\('ie-pw', 'sec-pw', \{[^}]*onCommit: settle,\s*onCancel: settle,/);
  assert.match(rows, /initInlineEdit\('ie-pw2', 'sec-pw2', \{[^}]*onCancel: checkMatch,/);
  assert.match(rows, /const settle = \(\) => \{\s*el\('sec-pw-bars'\)\?\.classList\.add\('d-none'\);/);
});

test('every row value in the admin page is translated', () => {
  const page = fs.readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
  const bare = [...page.matchAll(/<span class="rv[^"]*"[^>]*>/g)].map(m => m[0]).filter(s => !/data-i18n=/.test(s));
  assert.deepEqual(bare, []);
});
