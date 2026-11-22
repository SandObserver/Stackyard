/* The sign-in box comes back each time a session expires. A password left in it
   is sent again by a single Enter. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const field = () => ({
  value: '',
  disabled: false,
  style: {},
  textContent: '',
  attrs: {},
  get validity() {
    return { valueMissing: this.value === '' };
  },
  focus() {},
  setAttribute(k, v) {
    this.attrs[k] = v;
  },
  removeAttribute(k) {
    delete this.attrs[k];
  },
});
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
  'login-reveal': {
    attrs: { 'aria-pressed': 'false' },
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    },
    getAttribute(k) {
      return this.attrs[k];
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    querySelector: () => null,
    click() {
      for (const fn of this.listeners.click || []) fn();
    },
  },
};
els['login-pw'].type = 'password';
globalThis.location = { host: 'stackyard.local', hostname: 'stackyard.local' };
globalThis.document = {
  activeElement: null,
  body: {},
  getElementById: id => els[id] ?? null,
  querySelectorAll: () => [],
  addEventListener() {},
};

let status = 200;
let refusal = { error: 'Wrong password', kind: 'auth' };
let offline = false;
let posts = 0;
globalThis.fetch = async () => {
  posts++;
  if (offline) throw new TypeError('Failed to fetch');
  return { ok: status < 400, status, json: async () => (status < 400 ? { ok: true } : refusal) };
};

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

test('a refused sign-in ties the error to the field until the next try', async () => {
  status = 401;
  requireLogin();
  els['login-pw'].value = 'wrong';
  submit();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(els['login-pw'].attrs['aria-invalid'], 'true');
  assert.equal(els['login-pw'].attrs['aria-describedby'], 'login-err');
  status = 200;
  els['login-pw'].value = 'quiet otter lantern 42';
  submit();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(els['login-pw'].attrs['aria-invalid'], undefined);
  assert.equal(els['login-pw'].attrs['aria-describedby'], undefined);
});

test('an empty sign-in sends nothing, so it costs no attempt', async () => {
  status = 401;
  requireLogin();
  const before = posts;
  els['login-pw'].value = '';
  submit();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(posts, before);
  assert.equal(els['login-screen'].open, true);
});

test('an empty sign-in says what is missing and ties it to the field', async () => {
  status = 401;
  requireLogin();
  els['login-pw'].value = '';
  submit();
  await new Promise(r => setTimeout(r, 60));
  assert.match(els['login-err'].textContent, /login\.empty|Enter your password/);
  assert.equal(els['login-err'].style.display, 'block');
  assert.equal(els['login-pw'].attrs['aria-invalid'], 'true');
  assert.equal(els['login-pw'].attrs['aria-describedby'], 'login-err');
  status = 200;
  els['login-pw'].value = 'quiet otter lantern 42';
  submit();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(els['login-err'].style.display, 'none');
  assert.equal(els['login-pw'].attrs['aria-invalid'], undefined);
  assert.equal(els['login-pw'].attrs['aria-describedby'], undefined);
});

for (const [name, setUp] of [
  [
    'too many attempts',
    () => ((status = 429), (refusal = { error: 'Too many', kind: 'blocked', code: 'blocked.rate-limit' })),
  ],
  ['a busy server', () => ((status = 503), (refusal = { error: 'Busy', kind: 'blocked', code: 'blocked.busy' }))],
  ['no answer', () => (offline = true)],
]) {
  test(`${name} shows the error but does not call the password wrong`, async () => {
    setUp();
    requireLogin();
    els['login-pw'].value = 'quiet otter lantern 42';
    submit();
    await new Promise(r => setTimeout(r, 0));
    status = 200;
    refusal = { error: 'Wrong password', kind: 'auth' };
    offline = false;
    assert.equal(els['login-err'].style.display, 'block');
    assert.ok(els['login-err'].textContent);
    assert.equal(els['login-pw'].attrs['aria-invalid'], undefined);
    assert.equal(els['login-pw'].attrs['aria-describedby'], 'login-err');
  });
}

test('the same refusal twice is read again', async () => {
  status = 401;
  refusal = { error: 'Wrong password', kind: 'auth' };
  requireLogin();
  els['login-pw'].value = 'wrong';
  submit();
  await new Promise(r => setTimeout(r, 0));
  const said = els['login-err'].textContent;
  assert.ok(said);
  els['login-pw'].value = 'wrong';
  submit();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(els['login-err'].textContent, '', 'unchanged text is not read again');
  await new Promise(r => setTimeout(r, 60));
  assert.equal(els['login-err'].textContent, said);
});

test('the password can be shown, is wired once, and is hidden again after sign-in', async () => {
  const rev = els['login-reveal'];
  requireLogin();
  requireLogin();
  assert.equal(rev.listeners.click.length, 1, 'each sign-in box would toggle the field once more');
  rev.click();
  assert.equal(els['login-pw'].type, 'text');
  assert.equal(rev.attrs['aria-pressed'], 'true');
  status = 200;
  els['login-pw'].value = 'quiet otter lantern 42';
  submit();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(els['login-pw'].type, 'password');
  assert.equal(rev.attrs['aria-pressed'], 'false');
});
