import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

function fakeToast() {
  const listeners = {};
  const classes = new Set();
  return {
    textContent: '',
    listeners,
    get className() {
      return [...classes].join(' ');
    },
    set className(v) {
      classes.clear();
      for (const c of String(v).split(/\s+/).filter(Boolean)) classes.add(c);
    },
    classList: { contains: c => classes.has(c) },
    contains: () => false,
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
  };
}

const box = fakeToast();
const msg = fakeToast();
const docListeners = {};
globalThis.document = {
  getElementById: id => (id === 'toast' ? box : id === 'toast-msg' ? msg : null),
  querySelectorAll: () => [],
  addEventListener(type, fn) {
    docListeners[type] = fn;
  },
};

const { apiPost, toast } = await import('../js/admin-shared.js');

function replyWith(body) {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => body });
}

test('a success notice right after a withheld credential leaves the warning on screen', async () => {
  replyWith({ ok: true, items: [], withheld: [{ id: 'w1', label: 'Shelf' }] });
  await apiPost('/api/config', { items: [] });
  const warning = msg.textContent;
  assert.equal(warning, 'toast.secretsWithheld');

  toast('Saved');
  toast('Imported');

  assert.equal(msg.textContent, warning);
  assert.ok(box.classList.contains('warn'));
});

test('dismissing the warning lets the next success notice show', async () => {
  replyWith({ ok: true, items: [], withheld: [{ id: 'w1', label: 'Shelf' }] });
  await apiPost('/api/config', { items: [] });
  box.listeners.click();

  toast('Saved');

  assert.equal(msg.textContent, 'Saved');
});

test('an error still replaces the warning', async () => {
  replyWith({ ok: true, items: [], withheld: [{ id: 'w1', label: 'Shelf' }] });
  await apiPost('/api/config', { items: [] });

  toast('Save failed', 'err');
  toast('Saved');

  assert.equal(msg.textContent, 'Saved');
});

for (const type of ['pointerdown', 'keydown']) {
  test(`after a ${type}, the next success notice replaces the warning`, async () => {
    toast('Socket URL could not be verified', 'warn');
    toast('Saved');
    assert.equal(msg.textContent, 'Socket URL could not be verified');

    docListeners[type]({ target: {} });
    toast('Saved');

    assert.equal(msg.textContent, 'Saved');
  });
}
