import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { passwordMismatch } from '../js/password-policy.js';
import { setRevealed } from '../js/password-reveal.js';
import { ICONS, STYLES, symbol } from '../js/icon-set.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

function fakeButton(href) {
  const attrs = { 'aria-pressed': 'false' };
  const use = { href, getAttribute: () => use.href, setAttribute: (_, v) => (use.href = v) };
  return {
    attrs,
    use,
    getAttribute: k => attrs[k],
    setAttribute: (k, v) => (attrs[k] = v),
    querySelector: () => use,
  };
}

test('a confirmation typed with decomposed accents matches', () => {
  assert.equal(passwordMismatch('café-terrace-one', 'café-terrace-one'), false);
  assert.equal(passwordMismatch('café-terrace-one', 'cafe-terrace-one'), true);
  assert.equal(passwordMismatch('a long passphrase', ''), true);
});

test('every reveal button and field change together', () => {
  const buttons = [fakeButton('#sy-solid-eye'), fakeButton('#sy-solid-eye')];
  const fields = [{ type: 'password' }, { type: 'password' }];
  setRevealed(/** @type {any} */ (buttons), /** @type {any} */ (fields), true);
  assert.deepEqual(
    fields.map(f => f.type),
    ['text', 'text'],
  );
  for (const b of buttons) {
    assert.equal(b.attrs['aria-pressed'], 'true');
    assert.equal(b.use.href, '#sy-solid-eye-slash');
  }
  setRevealed(/** @type {any} */ (buttons), /** @type {any} */ (fields), false);
  assert.equal(fields[0].type, 'password');
  assert.equal(buttons[1].use.href, '#sy-solid-eye');
});

test('the slash cuts a gap through the eye in every style and draws outside the cut', () => {
  for (const style of Object.keys(STYLES)) {
    for (const sharp of [false, true]) {
      const { defs, sym } = symbol('eye-slash', ICONS['eye-slash'], style, sharp);
      assert.match(defs, /<path d="M4 4l16 16" fill="none" stroke="#000" stroke-width="6"/, `${style} cut`);
      const masked = sym.match(/<g mask="[^"]+">(.*?)<\/g>/)?.[1] || '';
      assert.doesNotMatch(masked, /M4 4l16 16/, `${style} slash must not be masked`);
      assert.match(sym, /<\/g><path d="M4 4l16 16"/, `${style} slash drawn`);
    }
  }
});

test('every password screen is a form with a submit button and a username for password managers', async () => {
  const admin = await read('../admin/index.html');
  const login = admin.match(/<form id="login-form"[^>]*>([\s\S]*?)<\/form>/)?.[1] || '';
  assert.match(login, /autocomplete="username"/);
  assert.match(login, /id="login-pw"[^>]*autocomplete="current-password"/);
  assert.match(login, /id="login-btn" type="submit"/);

  const dashboard = await read('../js/dashboard.js');
  const setup = dashboard.match(/<form class="setup-card"[^>]*>(.*?)<\/form>/)?.[1] || '';
  assert.match(setup, /autocomplete="username"/);
  assert.match(setup, /id="setup-set" type="submit"/);

  const recovery = await read('../js/config-recovery.js');
  const code = recovery.match(/<form class="cfg-recovery-form"[^>]*>([\s\S]*?)<\/form>/)?.[1] || '';
  assert.match(code, /autocomplete="username"/);
  assert.match(code, /type="submit"/);

  assert.match(admin, /id="sec-user"[^>]*autocomplete="username"/);
});

test('Settings has a confirmation row, and both rows offer the reveal button', async () => {
  const admin = await read('../admin/index.html');
  assert.match(admin, /id="ie-pw2"[\s\S]*?data-i18n="general.confirmPassword"/);
  assert.match(admin, /<input id="sec-pw2"\s+type="password"[^>]*autocomplete="new-password"/);
  for (const row of ['ie-pw', 'ie-pw2']) {
    const markup = admin.match(new RegExp(`id="${row}">(.*?)</div>`))?.[1] || '';
    assert.match(markup, /class="pw-reveal"[^>]*aria-pressed="false"[^>]*data-i18n-al="common.showPassword"/, row);
  }
});
