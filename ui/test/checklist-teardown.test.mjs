/* The picker used to attach a document click listener while it was open, and an
   earlier version never removed it: the admin rebuilds its fields on every
   render, so each pass stranded one listener holding the detached row it closed
   over.

   The menu is mounted on the page rather than in the top layer, so dismissal is
   ours again and the listener has to be scoped to the open state: registered
   when it opens, gone when it closes, and self-removing if the row it belonged
   to was discarded while open.

   Counting listeners is the point. Asserting that a teardown function was
   called would pass for an implementation that still leaks. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const live = new Set();

const handlers = { btn: {}, list: {} };
/* Looked up when the listener registers, not when the stub is built: the bags
   are replaced for each row. */
const on = key => (type, fn) => {
  handlers[key][type] = fn;
};

let parts = null;
const option = value => ({
  tagName: 'LI',
  dataset: { val: value },
  tabIndex: -1,
  textContent: value,
  classList: { toggle() {}, remove() {}, add() {} },
  getAttribute: name => (name === 'role' ? 'option' : 'false'),
  setAttribute() {},
  focus() {},
});

function makeParts(values) {
  handlers.btn = {};
  handlers.list = {};
  const options = values.map(option);
  const btn = {
    addEventListener: on('btn'),
    setAttribute() {},
    focus() {},
    classList: { toggle() {} },
    top: 0,
    getBoundingClientRect() {
      return { top: this.top, bottom: this.top, left: 0, right: 0, width: 0, height: 0 };
    },
  };
  const text = { textContent: '', classList: { toggle() {} } };
  const list = {
    hidden: true,
    style: {},
    addEventListener: on('list'),
    querySelectorAll: () => options,
    setAttribute() {},
    remove() {},
    contains: node => options.includes(node),
    getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }),
    set innerHTML(_v) {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
  };
  return { btn, text, list, options };
}

globalThis.window = { innerHeight: 800, innerWidth: 1200 };
globalThis.visualViewport = null;
globalThis.document = {
  documentElement: { getAttribute: () => 'ltr' },
  addEventListener(type, fn, opts) {
    const entry = { type, fn };
    live.add(entry);
    opts?.signal?.addEventListener('abort', () => live.delete(entry));
  },
  removeEventListener(_type, fn) {
    for (const entry of live) if (entry.fn === fn) live.delete(entry);
  },
  createElement: () => ({
    className: '',
    set innerHTML(_v) {},
    contains: node => node === parts.btn || node === parts.list || parts.options.includes(node),
    querySelector: sel => (sel === '.row-dd-btn' ? parts.btn : sel === '.row-dd-text' ? parts.text : parts.list),
    querySelectorAll: () => parts.options,
  }),
  querySelectorAll: () => [],
  getElementById: () => null,
  body: { appendChild() {} },
};

const { createListbox } = await import('../js/listbox.js');

/* Returns the handlers so a test can fire them, since there is no real DOM. */
function row(values = ['a', 'b']) {
  parts = makeParts(values);
  const api = createListbox({ label: 'pick', multiple: true, options: values.map(v => ({ value: v, label: v })) });
  return { api, btn: parts.btn, list: parts.list, handlers, options: parts.options };
}

const openIt = () => handlers.btn.click({ stopPropagation() {} });

test('building a picker registers nothing on the document', () => {
  live.clear();
  row();
  assert.equal(live.size, 0, 'a closed picker holds a document listener');
});

test('twenty renders of the same field leave nothing behind', () => {
  live.clear();
  for (let i = 0; i < 20; i++) row();
  assert.equal(live.size, 0, `${live.size} listeners stranded across 20 renders`);
});

test('an open picker listens for the press that dismisses it', () => {
  live.clear();
  const { list } = row();
  openIt();
  assert.equal(list.hidden, false, 'the list did not open');
  assert.deepEqual(
    [...live].map(e => e.type).sort(),
    ['click', 'scroll'],
    'an open picker must close on a press outside and on a scroll outside',
  );
});

test('closing removes the listener again', () => {
  live.clear();
  const { api, list } = row();
  openIt();
  api.close();
  assert.equal(list.hidden, true, 'close did not hide the list');
  assert.equal(live.size, 0, 'the listener outlived the open state');
});

test('a scroll closes the menu only when it moved the button', () => {
  live.clear();
  const { btn, list, options } = row();
  openIt();
  const scroll = [...live].find(e => e.type === 'scroll');
  btn.top = 40;
  scroll.fn({ target: options[0] });
  assert.equal(list.hidden, false, 'scrolling the long list itself closed it');
  btn.top = 0;
  scroll.fn({ target: { tagName: 'DIV' } });
  assert.equal(list.hidden, false, 'a late scroll that moved nothing closed the menu');
  btn.top = 40;
  scroll.fn({ target: { tagName: 'DIV' } });
  assert.equal(list.hidden, true, 'the menu stayed open while the pane scrolled');
  assert.equal(live.size, 0);
});

/* The form re-rendered while the list was open, so the row is gone and nothing
   will call close. The next press anywhere reaches the stranded listener, which
   closes and removes itself. */
test('a row discarded while open is cleaned up by the next press', () => {
  live.clear();
  row();
  openIt();
  assert.equal(live.size, 2);
  for (const entry of [...live]) if (entry.type === 'click') entry.fn({ target: { tagName: 'BODY' } });
  assert.equal(live.size, 0, 'a discarded open row leaks until the page reloads');
});
