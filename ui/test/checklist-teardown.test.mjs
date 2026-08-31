/* wireChecklist attached a document click listener per call and never removed
   it. The settings form rebuilds a multiselect field on every render, so each
   pass stranded one listener holding the detached row it closes over.

   Counting listeners is the point. Asserting that a teardown function was
   called would pass for an implementation that still leaks. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

/* A document only as real as wireChecklist touches, with the listener registry
   the count is read from. It honours `signal`, which is what removes them. */
const live = new Set();
globalThis.document = {
  addEventListener(type, fn, opts) {
    const entry = { type, fn };
    live.add(entry);
    opts?.signal?.addEventListener('abort', () => live.delete(entry));
  },
  removeEventListener(_type, fn) {
    for (const entry of live) if (entry.fn === fn) live.delete(entry);
  },
  querySelectorAll: () => [],
  getElementById: () => null,
};

const { wireChecklist } = await import('../js/admin-shared.js');

const option = value => ({
  tagName: 'LI',
  dataset: { val: value },
  tabIndex: -1,
  classList: { toggle() {}, remove() {}, add() {} },
  getAttribute: name => (name === 'role' ? 'option' : 'false'),
  setAttribute() {},
  focus() {},
});

/* Returns the handlers so a test can fire them, since there is no real DOM. */
function row(values = ['a', 'b']) {
  const options = values.map(option);
  const handlers = { btn: {}, list: {} };
  const on = bag => (type, fn) => {
    bag[type] = fn;
  };
  const btn = { addEventListener: on(handlers.btn), setAttribute() {}, focus() {} };
  const list = {
    hidden: true,
    addEventListener: on(handlers.list),
    querySelectorAll: () => options,
  };
  const dd = { contains: node => node === btn || node === list || options.includes(node) };
  const api = wireChecklist(dd, btn, list, () => {});
  return { api, btn, list, handlers, options };
}

const docClick = target => {
  for (const entry of [...live]) if (entry.type === 'click') entry.fn({ target });
};

test('wiring a checklist registers nothing on the document', () => {
  live.clear();
  row();
  assert.equal(live.size, 0, 'a closed checklist holds a document listener');
});

test('twenty renders of the same field leave nothing behind', () => {
  live.clear();
  for (let i = 0; i < 20; i++) row();
  assert.equal(live.size, 0, `${live.size} listeners stranded across 20 renders`);
});

test('an open checklist listens for the click that dismisses it', () => {
  live.clear();
  const { handlers, list } = row();
  handlers.btn.click({ stopPropagation() {} });
  assert.equal(list.hidden, false, 'the list did not open');
  assert.equal(live.size, 1, 'nothing is listening for a click outside');
});

test('closing removes the listener again', () => {
  live.clear();
  const { handlers, list } = row();
  handlers.btn.click({ stopPropagation() {} });
  docClick({ tagName: 'BODY' });
  assert.equal(list.hidden, true, 'a click outside did not close the list');
  assert.equal(live.size, 0, 'the listener outlived the open state');
});

test('a click inside leaves the list open and the listener in place', () => {
  live.clear();
  const { handlers, btn, list } = row();
  handlers.btn.click({ stopPropagation() {} });
  docClick(btn);
  assert.equal(list.hidden, false, 'a click inside closed the list');
  assert.equal(live.size, 1);
});

/* The case a per-open listener cannot prevent: the form re-rendered while the
   list was open, so the row is gone and nothing will call close. The next click
   anywhere reaches the stranded listener, which closes and removes itself. */
test('a row discarded while open is cleaned up by the next click', () => {
  live.clear();
  const { handlers } = row();
  handlers.btn.click({ stopPropagation() {} });
  assert.equal(live.size, 1);
  docClick({ tagName: 'BODY' });
  assert.equal(live.size, 0, 'a discarded open row leaks until the page reloads');
});
