/* A toast leaves in the colour it arrived in, and its timer waits while the
   tab is hidden. */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mock, test } from 'node:test';

register('./js-root-hooks.mjs', import.meta.url);

const act = { hidden: true, textContent: '', onclick: null };
const classes = new Set();
const listeners = {};
const box = {
  get className() {
    return [...classes].join(' ');
  },
  set className(v) {
    classes.clear();
    for (const c of String(v).split(/\s+/).filter(Boolean)) classes.add(c);
  },
  classList: { contains: c => classes.has(c), remove: c => classes.delete(c) },
  contains: () => false,
  matches: () => false,
  querySelector: sel => (sel === '.toast-act' ? act : null),
  addEventListener: (type, fn) => {
    listeners[type] = fn;
  },
};
const msg = { textContent: '', setAttribute() {}, classList: { contains: () => false } };
const docListeners = {};
const doc = {
  hidden: false,
  getElementById: id => (id === 'toast' ? box : id === 'toast-msg' ? msg : null),
  querySelectorAll: () => [],
  addEventListener: (type, fn) => {
    docListeners[type] = fn;
  },
};
globalThis.document = doc;

const { toast } = await import('../js/admin-shared.js');

mock.timers.enable({ apis: ['setTimeout'] });
const LONG = 120000;

function setHidden(hidden) {
  doc.hidden = hidden;
  docListeners.visibilitychange();
}

test('an error toast keeps its colour class while it leaves', () => {
  toast('Save failed', 'err');
  listeners.click();
  assert.equal(classes.has('show'), false);
  assert.equal(classes.has('err'), true);
  mock.timers.tick(200);
  assert.equal(box.className, '');
});

test('the action stays in place until the exit ends', () => {
  toast('Reload needed', 'warn', { label: 'Reload', run() {} });
  assert.equal(act.hidden, false);
  listeners.click();
  assert.equal(act.hidden, false);
  assert.equal(act.onclick, null);
  mock.timers.tick(200);
  assert.equal(act.hidden, true);
});

test('a new toast in the exit window keeps its action', () => {
  toast('First', 'warn', { label: 'A', run() {} });
  listeners.click();
  toast('Second', 'err', { label: 'B', run() {} });
  mock.timers.tick(200);
  assert.equal(act.hidden, false);
  listeners.click();
  mock.timers.tick(200);
});

test('a toast shown in a hidden tab waits for the tab to return', () => {
  doc.hidden = true;
  toast('Saved');
  mock.timers.tick(LONG);
  assert.equal(classes.has('show'), true);
  setHidden(false);
  mock.timers.tick(LONG);
  assert.equal(classes.has('show'), false);
});

test('hiding the tab stops a running timer', () => {
  toast('Saved');
  setHidden(true);
  mock.timers.tick(LONG);
  assert.equal(classes.has('show'), true);
  setHidden(false);
  mock.timers.tick(LONG);
  assert.equal(classes.has('show'), false);
});

test('returning to the tab does not close a toast with an action', () => {
  toast('Reload needed', 'warn', { label: 'Reload', run() {} });
  setHidden(true);
  setHidden(false);
  mock.timers.tick(LONG);
  assert.equal(classes.has('show'), true);
  listeners.click();
  mock.timers.tick(200);
});
