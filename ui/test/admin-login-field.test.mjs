/* The sign-in box comes back each time a session expires. A password left in it
   is sent again by a single Enter. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const field = () => ({ value: '', disabled: false, style: {}, textContent: '', focus() {} });
const els = {
  'login-screen': {
    open: false,
    isConnected: true,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
      this.onclose?.();
    },
  },
  'login-btn': field(),
  'login-pw': field(),
  'login-err': field(),
  'login-form': { querySelectorAll: () => [] },
};
globalThis.location = { host: 'stackyard.local', hostname: 'stackyard.local' };
globalThis.document = {
  activeElement: null,
  body: {},
  getElementById: id => els[id] ?? null,
  querySelectorAll: () => [],
  addEventListener() {},
};

let status = 200;
globalThis.fetch = async () => ({
  ok: status < 400,
  status,
  json: async () => (status < 400 ? { ok: true } : { error: 'Wrong password', kind: 'auth' }),
});

const { requireLogin } = await import('../js/admin-auth.js');

const submit = () => els['login-form'].onsubmit({ preventDefault() {} });

test('a successful sign-in leaves the password field empty', async () => {
  status = 200;
  const back = requireLogin();
  els['login-pw'].value = 'quiet otter lantern 42';
  submit();
  assert.equal(await back, true);
  assert.equal(els['login-screen'].open, false);
  assert.equal(els['login-pw'].value, '', 'the next sign-in box opens with the old password in it');
});

test('a refused sign-in still empties the field and keeps the box open', async () => {
  status = 401;
  requireLogin();
  els['login-pw'].value = 'wrong';
  submit();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(els['login-pw'].value, '');
  assert.equal(els['login-screen'].open, true);
});
