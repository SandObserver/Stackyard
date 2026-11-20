/* The first-run password prompt on the dashboard. */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import { catalogRoutes, fakeFetch, fire, installDom, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

let setReply = { status: 200, body: {} };
const fetch = fakeFetch({
  ...catalogRoutes(),
  'POST /api/auth/set-password': () => setReply,
  'POST /api/auth/dismiss-setup': {},
});
const dom = installDom({ fetch, location: 'http://nas.local/' });
const { initI18n, t } = await import('../js/i18n.js');
await initI18n('en');
const { createDashboardState } = await import('../js/dashboard-state.js');
const { showSetupPrompt } = await import('../js/dashboard-setup.js');
const { passwordMeter } = await import('../js/password-policy.js');

const dash = createDashboardState();
dash.items = [{ id: 'a', type: 'app' }];
const closed = showSetupPrompt(dash);
const doc = dom.document;
const ov = doc.querySelector('dialog.setup-prompt');
const $ = id => doc.getElementById(id);
const type = (id, value) => {
  $(id).value = value;
  fire($(id), 'input');
};
const STRONG = 'quiet otter lantern 42';

test('the prompt is a modal dialog with the field focused', () => {
  assert.ok(ov, 'no prompt');
  assert.ok(ov.open, 'not opened with showModal');
  assert.equal(doc.activeElement, $('setup-pw'));
  assert.equal(ov.getAttribute('aria-labelledby'), 'setup-title');
  assert.equal($('setup-title').textContent, t('setup.title'));
});

test('Escape does not dismiss it', () => {
  assert.equal(fire(ov, 'cancel', { bubbles: false, cancelable: true }), false);
});

test('it is a form with a username and a submit button for password managers', () => {
  const form = ov.querySelector('form.setup-card');
  assert.ok(form);
  assert.equal(form.querySelector('input[name="username"]').getAttribute('autocomplete'), 'username');
  assert.equal($('setup-set').getAttribute('type'), 'submit');
  assert.equal($('setup-pw').getAttribute('autocomplete'), 'new-password');
});

test('the meter draws as many bars as the rules fill, and its hint is announced', () => {
  assert.equal(ov.querySelectorAll('#setup-bars .pwbar').length, passwordMeter(STRONG).lit);
  assert.equal($('setup-hint').getAttribute('role'), 'status');
  assert.equal($('setup-pw').getAttribute('aria-describedby'), 'setup-hint');
});

test('Set stays off until the password is strong, confirmed and the code is typed', () => {
  assert.ok($('setup-set').disabled);
  type('setup-pw', STRONG);
  assert.notEqual($('setup-hint').textContent, '');
  assert.ok($('setup-set').disabled, 'no confirmation yet');
  type('setup-pw2', `${STRONG}x`);
  assert.equal($('setup-err').textContent, t('setup.mismatch'));
  assert.ok($('setup-set').disabled, 'a mismatch can be set');
  type('setup-pw2', STRONG);
  assert.equal($('setup-err').textContent, '');
  assert.ok($('setup-set').disabled, 'no setup code yet');
  type('setup-code', ' ');
  assert.ok($('setup-set').disabled, 'a blank code counts');
  type('setup-code', 'ABCD-1234');
  assert.equal($('setup-set').disabled, false);
});

test('a wrong code is said in words and puts focus back on the code', async () => {
  setReply = { status: 400, body: { kind: 'invalid', code: 'invalid.setup-code' } };
  fire(ov.querySelector('form'), 'submit', { cancelable: true });
  await settle();
  const sent = fetch.calls.find(c => c.url === '/api/auth/set-password');
  assert.deepEqual(JSON.parse(sent.body), { password: STRONG, code: 'ABCD-1234' });
  assert.equal($('setup-err').textContent, t('hostBlock.codeWrong'));
  assert.equal(doc.activeElement, $('setup-code'));
  assert.equal($('setup-set').disabled, false);
});

test('a set password reloads the page', async () => {
  setReply = { status: 200, body: {} };
  fire(ov.querySelector('form'), 'submit', { cancelable: true });
  await settle();
  assert.equal(dom.location.reloads, 1);
});

test('Skip tells the server and closes the prompt', async () => {
  $('setup-skip').click();
  await settle();
  assert.ok(fetch.calls.some(c => c.url === '/api/auth/dismiss-setup' && c.method === 'POST'));
  await closed;
  assert.equal(doc.querySelector('dialog.setup-prompt'), null);
});
