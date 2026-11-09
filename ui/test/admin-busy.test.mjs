/* Slow writes: a second press is ignored, the wait is shown only after 300 ms,
   and the button is restored however the write ends. */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register('./js-root-hooks.mjs', import.meta.url);

function mkEl() {
  const attrs = {};
  const classes = new Set();
  return {
    disabled: false,
    focused: 0,
    focus() {
      this.focused++;
    },
    closest: () => null,
    classList: { has: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c) },
    getAttribute: k => attrs[k] ?? null,
    setAttribute: (k, v) => {
      attrs[k] = String(v);
    },
    removeAttribute: k => {
      delete attrs[k];
    },
  };
}

let dialogOpen = false;
globalThis.document = {
  getElementById: () => null,
  querySelector: sel => (sel.startsWith('dialog') && dialogOpen ? {} : null),
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.location = /** @type {any} */ ({ host: 'nas.local' });
const { busyPress, rowBusy } = await import('../js/admin-shared.js');

const wait = ms => new Promise(r => setTimeout(r, ms));
const gate = () => {
  let open;
  const done = new Promise(r => {
    open = r;
  });
  return { done, open };
};

test('a second press during the write is ignored', async () => {
  const btn = mkEl();
  const { done, open } = gate();
  let runs = 0;
  const press = busyPress(btn, () => {
    runs++;
    return done;
  });
  const first = press();
  await press();
  assert.equal(runs, 1);
  assert.equal(btn.disabled, true);
  assert.equal(btn.getAttribute('aria-busy'), 'true');
  open();
  await first;
  assert.equal(btn.getAttribute('aria-busy'), null);
  assert.equal(btn.disabled, false);
});

test('a fast write never shows the saving label', async () => {
  const btn = mkEl();
  await busyPress(btn, async () => {})();
  await wait(350);
  assert.equal(btn.classList.has('busy'), false);
});

test('a slow write shows the saving label after 300 ms, and removes it', async () => {
  const btn = mkEl();
  const { done, open } = gate();
  const press = busyPress(btn, () => done);
  const p = press();
  await wait(120);
  assert.equal(btn.classList.has('busy'), false);
  await wait(250);
  assert.equal(btn.classList.has('busy'), true);
  open();
  await p;
  assert.equal(btn.classList.has('busy'), false);
});

test('an open dialog holds the saving label until it closes', async () => {
  const btn = mkEl();
  const { done, open } = gate();
  dialogOpen = true;
  const press = busyPress(btn, () => done);
  const p = press();
  await wait(350);
  assert.equal(btn.classList.has('busy'), false);
  dialogOpen = false;
  await wait(200);
  assert.equal(btn.classList.has('busy'), true);
  open();
  await p;
});

test('after a failed write the button is usable and after() still runs', async () => {
  const btn = mkEl();
  let synced = 0;
  const press = busyPress(
    btn,
    async () => {
      throw new Error('down');
    },
    () => synced++,
  );
  await assert.rejects(press);
  assert.equal(btn.disabled, false);
  assert.equal(btn.getAttribute('aria-busy'), null);
  assert.equal(synced, 1);
});

test('a control that had focus gets it back when it works again', async () => {
  const body = {};
  document.body = body;
  for (const wrap of [busyPress, rowBusy]) {
    const node = mkEl();
    document.activeElement = node;
    await wrap(node, async () => {
      document.activeElement = body;
    })();
    assert.equal(node.focused, 1);
  }
});

test('focus moved elsewhere during the run stays there', async () => {
  const node = mkEl();
  document.body = {};
  document.activeElement = node;
  await busyPress(node, async () => {
    document.activeElement = {};
  })();
  assert.equal(node.focused, 0);
});

test('a row action ignores a second press and restores the control', async () => {
  const node = mkEl();
  const { done, open } = gate();
  let runs = 0;
  const run = rowBusy(node, () => {
    runs++;
    return done;
  });
  const first = run();
  await run();
  assert.equal(runs, 1);
  open();
  await first;
  assert.equal(node.disabled, false);
  assert.equal(node.getAttribute('aria-busy'), null);
});
