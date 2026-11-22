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

test('Enter that confirms an input-method candidate does not commit the row', () => {
  const r = passwordRow();
  r.open();
  r.type('ni');
  const ev = fire(r.inp, 'keydown', { key: 'Enter', isComposing: true, keyCode: 229 });
  assert.equal(ev.defaultPrevented, false);
  assert.deepEqual(r.commits, []);
  assert.equal(r.editing(), true);
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

test('the Settings password row hides its meter when Escape restores the value', async () => {
  const { catalogRoutes, fakeFetch, installDom, pageBody } = await import('./fake-dom.mjs');
  const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
  try {
    await (await import('../js/i18n.js')).initI18n('en');
    const { initPasswordRows } = await import('../js/admin-settings-controls.js');
    initPasswordRows();
    const byId = id => dom.document.getElementById(id);
    for (const row of ['ie-pw', 'ie-pw2']) {
      byId('sec-pw-bars').classList.remove('d-none');
      byId('sec-pw-hint').classList.remove('d-none');
      dom.document.querySelector(`#${row} .pe`).click();
      byId(row).dispatchEvent({ type: 'keydown', key: 'Escape', bubbles: true });
      const hidden = byId('sec-pw-bars').classList.contains('d-none');
      assert.equal(hidden, row === 'ie-pw', `${row}: Escape ${hidden ? 'hid' : 'kept'} the meter`);
      assert.equal(byId('sec-pw-hint').classList.contains('d-none'), row === 'ie-pw');
    }
  } finally {
    dom.restore();
  }
});

test('the Settings password rows sit in a form password managers can read', async () => {
  const { catalogRoutes, fakeFetch, installDom, pageBody } = await import('./fake-dom.mjs');
  const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
  try {
    await (await import('../js/i18n.js')).initI18n('en');
    const { initPasswordRows } = await import('../js/admin-settings-controls.js');
    initPasswordRows();
    const byId = id => dom.document.getElementById(id);
    const form = byId('sec-pw-form');
    assert.equal(form.tagName, 'FORM');
    for (const [id, name] of [
      ['sec-user', 'username'],
      ['sec-pw', 'password'],
      ['sec-pw2', 'confirm'],
    ]) {
      assert.equal(byId(id).closest('form'), form, `${id} is outside the form`);
      assert.equal(byId(id).getAttribute('name'), name);
    }
    assert.equal(
      form.dispatchEvent({ type: 'submit', bubbles: true, cancelable: true }),
      false,
      'a submit would leave the page',
    );
  } finally {
    dom.restore();
  }
});

test('the Settings mismatch goes once the passwords match, whichever row is edited', async () => {
  const { catalogRoutes, fakeFetch, fire: send, installDom, pageBody } = await import('./fake-dom.mjs');
  const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
  try {
    await (await import('../js/i18n.js')).initI18n('en');
    const { initPasswordRows } = await import('../js/admin-settings-controls.js');
    initPasswordRows();
    const byId = id => dom.document.getElementById(id);
    const edit = (row, field, value, leave = true) => {
      dom.document.querySelector(`#${row} .pe`).click();
      byId(field).value = value;
      send(byId(field), 'input');
      if (leave) send(byId(field), 'keydown', { key: 'Enter' });
    };
    const flagged = () => byId('ie-pw2').classList.contains('row-invalid');
    edit('ie-pw', 'sec-pw', 'amber falcon meadow 17');
    edit('ie-pw2', 'sec-pw2', 'quiet otter lantern 42');
    assert.equal(flagged(), true, 'leaving the confirmation did not check the match');
    edit('ie-pw', 'sec-pw', 'quiet otter lantern 42', false);
    assert.equal(flagged(), false, 'the error stayed after the first row was made to match');
    send(byId('sec-pw'), 'keydown', { key: 'Enter' });
    assert.equal(flagged(), false);
    edit('ie-pw', 'sec-pw', 'quiet otter lantern 4', false);
    assert.equal(flagged(), false, 'the mismatch shows while typing');
    send(byId('sec-pw'), 'keydown', { key: 'Enter' });
    assert.equal(flagged(), true, 'leaving the first row did not check the match');
  } finally {
    dom.restore();
  }
});

test('the Settings password fields take no capitals, correction or spelling marks', async () => {
  const { catalogRoutes, fakeFetch, installDom, pageBody } = await import('./fake-dom.mjs');
  const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
  try {
    await (await import('../js/i18n.js')).initI18n('en');
    const { initPasswordRows } = await import('../js/admin-settings-controls.js');
    initPasswordRows();
    const byId = id => dom.document.getElementById(id);
    dom.document.querySelector('#ie-pw .pw-reveal').click();
    for (const id of ['sec-pw', 'sec-pw2']) {
      assert.equal(byId(id).type, 'text', `${id} is not shown`);
      assert.equal(byId(id).getAttribute('spellcheck'), 'false', id);
      assert.equal(byId(id).getAttribute('autocapitalize'), 'none', id);
      assert.equal(byId(id).getAttribute('autocorrect'), 'off', id);
    }
  } finally {
    dom.restore();
  }
});

test('the Settings strength hint is read when its band changes, not per character', async () => {
  const { catalogRoutes, fakeFetch, installDom, pageBody, settle } = await import('./fake-dom.mjs');
  const dom = installDom({ markup: pageBody('admin/index.html'), fetch: fakeFetch(catalogRoutes()) });
  try {
    const { initI18n, t } = await import('../js/i18n.js');
    await initI18n('en');
    const { wirePasswordStrength } = await import('../js/admin-auth.js');
    const byId = id => dom.document.getElementById(id);
    const said = [];
    const region = byId('sr-announce');
    const type = async value => {
      byId('sec-pw').value = value;
      byId('sec-pw').dispatchEvent({ type: 'input', bubbles: true });
      await settle(120);
      if (region.textContent && region.textContent !== said.at(-1)) said.push(region.textContent);
    };
    byId('sec-pw').value = 'q';
    wirePasswordStrength('sec-pw', 'sec-pw-bars', 'sec-pw-hint');
    await type('q');
    await type('qu');
    await type('quiet otter lantern 42');
    assert.deepEqual(said, [t('pwStrength.count', { count: 1 }), t('pwStrength.enough')]);
  } finally {
    dom.restore();
  }
});

test('every row value in the admin page is translated', () => {
  const page = fs.readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
  const bare = [...page.matchAll(/<span class="rv[^"]*"[^>]*>/g)].map(m => m[0]).filter(s => !/data-i18n=/.test(s));
  assert.deepEqual(bare, []);
});
