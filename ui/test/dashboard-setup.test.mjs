/* The first-run password prompt on the dashboard. */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import { catalogRoutes, fakeFetch, fire, installDom, settle } from './fake-dom.mjs';

register('./js-root-hooks.mjs', import.meta.url);

let setReply = { status: 200, body: {} };
const fetch = fakeFetch({
  ...catalogRoutes(),
  'POST /api/auth/set-password': () => (typeof setReply === 'function' ? setReply() : setReply),
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
  assert.equal(ov.getAttribute('closedby'), 'none');
});

test('a close nobody chose opens it again', () => {
  ov.close();
  assert.ok(ov.open, 'a second Escape left the dashboard without the prompt');
  assert.ok(ov.isConnected);
  assert.equal(doc.activeElement, $('setup-pw'));
});

test('it is a form with a username and a submit button for password managers', () => {
  const form = ov.querySelector('form.setup-card');
  assert.ok(form);
  assert.equal(form.querySelector('input[name="username"]').getAttribute('autocomplete'), 'username');
  assert.equal($('setup-set').getAttribute('type'), 'submit');
  assert.equal($('setup-pw').getAttribute('autocomplete'), 'new-password');
});

test('each field has a visible label and is required', () => {
  const names = {
    'setup-pw': 'setup.newPassword',
    'setup-pw2': 'setup.confirmPassword',
    'setup-code': 'hostBlock.code',
  };
  for (const [id, key] of Object.entries(names)) {
    const label = ov.querySelector(`label[for="${id}"]`);
    assert.ok(label, `${id} has no label`);
    assert.equal(label.textContent, t(key));
    assert.ok($(id).hasAttribute('required'), `${id} is not required`);
    assert.equal($(id).getAttribute('placeholder'), null, `${id} still names itself with a placeholder`);
  }
});

test('the meter draws as many bars as the rules fill, and its hint is read once per band', async () => {
  assert.equal(ov.querySelectorAll('#setup-bars .pwbar').length, passwordMeter(STRONG).lit);
  assert.equal($('setup-hint').getAttribute('role'), null, 'a status hint is read after every character');
  assert.equal($('setup-pw').getAttribute('aria-describedby'), 'setup-hint');
  const live = $('setup-live');
  assert.equal(live.getAttribute('aria-live'), 'polite');
  assert.ok(ov.contains(live), 'a region outside the modal is inert and never read');
  assert.equal(live.textContent, '');
  type('setup-pw', 'q');
  const counting = live.textContent;
  assert.equal(counting, $('setup-hint').textContent);
  type('setup-pw', 'qu');
  assert.equal(live.textContent, counting, 'each character was announced');
  assert.notEqual($('setup-hint').textContent, counting);
  type('setup-pw', STRONG);
  assert.equal(live.textContent, t('pwStrength.enough'));
  type('setup-pw', '');
});

test('Set stays available and a submit names the first field to fix', () => {
  const sent = () => fetch.calls.filter(c => c.url === '/api/auth/set-password').length;
  assert.equal($('setup-set').disabled, false);
  const form = ov.querySelector('form');
  fire(form, 'submit', { cancelable: true });
  assert.equal(doc.activeElement, $('setup-pw'));
  assert.equal($('setup-pw').getAttribute('aria-invalid'), 'true');
  assert.match($('setup-pw').getAttribute('aria-describedby'), /\bsetup-err\b/);
  assert.equal($('setup-err').textContent, t('hostBlock.tooShort'));
  type('setup-pw', STRONG);
  assert.equal($('setup-pw').getAttribute('aria-invalid'), null);
  assert.equal($('setup-pw').getAttribute('aria-describedby'), 'setup-hint');
  assert.equal($('setup-err').style.display, 'none');
  fire(form, 'submit', { cancelable: true });
  assert.equal(doc.activeElement, $('setup-pw2'));
  assert.equal($('setup-err').textContent, t('setup.mismatch'));
  type('setup-pw2', STRONG);
  fire(form, 'submit', { cancelable: true });
  assert.equal(doc.activeElement, $('setup-code'));
  assert.equal($('setup-code').getAttribute('aria-invalid'), 'true');
  assert.equal($('setup-err').textContent, t('hostBlock.codeMissing'));
  type('setup-code', ' ');
  fire(form, 'submit', { cancelable: true });
  assert.equal($('setup-err').textContent, '', 'a repeated error is cleared so it is read again');
  assert.equal(sent(), 0, 'an incomplete form was sent');
});

test('a mismatch is said when the confirmation is left, and goes when it is edited', () => {
  type('setup-code', 'ABCD-1234');
  type('setup-pw2', 'q');
  assert.equal($('setup-err').style.display, 'none', 'the mismatch shows on the first character');
  fire($('setup-pw2'), 'blur', { bubbles: false });
  assert.equal($('setup-err').textContent, t('setup.mismatch'));
  assert.equal($('setup-pw2').getAttribute('aria-invalid'), 'true');
  type('setup-pw2', `${STRONG}x`);
  assert.equal($('setup-pw2').getAttribute('aria-invalid'), null);
  assert.equal($('setup-err').style.display, 'none');
  type('setup-pw2', STRONG);
  fire($('setup-pw2'), 'blur', { bubbles: false });
  assert.equal($('setup-err').style.display, 'none');
});

test('Set is off only while the request is out', async () => {
  let answer;
  setReply = () => new Promise(r => (answer = r));
  type('setup-code', 'ABCD-1234');
  fire(ov.querySelector('form'), 'submit', { cancelable: true });
  assert.ok($('setup-set').disabled);
  assert.ok($('setup-skip').disabled);
  answer({ status: 400, body: { kind: 'internal', code: 'internal.unknown' } });
  await settle();
  assert.equal($('setup-set').disabled, false);
  assert.equal($('setup-skip').disabled, false);
  assert.equal($('setup-err').textContent, t('setup.failed'));
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
