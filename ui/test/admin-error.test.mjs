/* Regression tests for the frontend half of the structured error contract (P11-3).

   ui/js/admin-error.js decides what the admin UI does about a failure. It
   replaces the substring matching in admin-app-form.js `fetchBadge`, which
   looked for '401' or 'ECONNREFUSED' inside the error text, broke silently, and
   had no test at all.

   The backend half lives in api/test/api-error.test.js. The vocabulary check
   below is the seam between them: a kind added on one side and forgotten on the
   other fails here rather than shipping. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { badgeErrorAdvice, KIND, TONE } from '../js/admin-error.js';

/* api/src/api-error.js is CommonJS (the server half of the codebase is), so it
   needs createRequire rather than a plain import. */
const require = createRequire(import.meta.url);
const { KINDS } = require('../../api/src/api-error.js');

test('frontend and backend agree on the exact set of kinds', () => {
  assert.deepEqual(Object.values(KIND).sort(), [...KINDS].sort());
});

/* ── badgeErrorAdvice: the behaviour the substring matching used to provide ── */

test('a network failure still suggests the container name', () => {
  const a = badgeErrorAdvice({ kind: KIND.NETWORK, detail: { code: 'ECONNREFUSED' }, message: 'x' });
  assert.equal(a.tone, TONE.WARN);
  assert.match(a.message, /container name/);
  assert.equal(a.openAuth, false);
});

test('a timeout gets the same advice as a refused connection', () => {
  assert.match(badgeErrorAdvice({ kind: KIND.TIMEOUT }).message, /container name/);
});

test('an upstream 401 opens the Authentication section', () => {
  const a = badgeErrorAdvice({ kind: KIND.UPSTREAM, detail: { status: 401 } });
  assert.equal(a.openAuth, true);
  assert.equal(a.tone, TONE.WARN);
  assert.match(a.message, /Authentication required/);
});

test('an upstream 403 opens the Authentication section', () => {
  assert.equal(badgeErrorAdvice({ kind: KIND.UPSTREAM, detail: { status: 403 } }).openAuth, true);
});

test('an upstream 500 does not suggest credentials', () => {
  assert.equal(badgeErrorAdvice({ kind: KIND.UPSTREAM, detail: { status: 500 } }).openAuth, false);
});

/* This is the misfire the audit entry did not mention: the old `isAuth` branch
   matched 'Unauthori', which is the text of our OWN session-expiry error, so an
   expired admin session told the user to add an upstream API key. */
test('our own expired session does not offer an upstream API key', () => {
  const a = badgeErrorAdvice({ kind: KIND.AUTH, message: 'Unauthorised' });
  assert.equal(a.openAuth, false, 'must not tick the Authentication toggle');
  assert.equal(a.sessionExpired, true);
  assert.match(a.message, /session/i);
});

/* Previously fell through to the generic red branch: the reason text contains
   neither '403' nor 'Forbidden', so neither matcher fired. */
test('an SSRF block shows its own reason', () => {
  const a = badgeErrorAdvice({ kind: KIND.BLOCKED, message: 'Blocked: localhost is a private address.' });
  assert.match(a.message, /private address/);
  assert.equal(a.openAuth, false);
});

/* A private address is what most homelab installs point a badge at, and one
   setting unblocks it. */
test('a blocked private address names the setting that allows it', () => {
  for (const message of [
    'Blocked: 192.168.1.5 is a private address.',
    'Blocked: nas.lan resolves to private IP 10.0.0.4.',
  ]) {
    const a = badgeErrorAdvice({ kind: KIND.BLOCKED, message });
    assert.equal(a.tone, TONE.WARN, message);
    assert.match(a.message, /ALLOW_PRIVATE_IPS=true/, message);
    assert.match(a.message, new RegExp(message.replace(/[.]/g, '\\.')), 'keeps the original reason');
    assert.equal(a.openAuth, false);
    assert.equal(a.sessionExpired, false);
  }
});

test('other blocked reasons are still shown verbatim', () => {
  for (const message of ['Invalid URL', 'Blocked: nas.lan could not be resolved.', 'Blocked: ftp: is not allowed.']) {
    const a = badgeErrorAdvice({ kind: KIND.BLOCKED, message });
    assert.equal(a.tone, TONE.ERROR, message);
    assert.equal(a.message, message);
  }
});

test('an error with no kind degrades to a plain failure, it does not throw', () => {
  const a = badgeErrorAdvice(new Error('something odd'));
  assert.equal(a.tone, TONE.ERROR);
  assert.equal(a.message, 'something odd');
  assert.equal(a.openAuth, false);
});

test('an unknown future kind degrades instead of crashing an older frontend', () => {
  const a = badgeErrorAdvice({ kind: 'quota-exceeded', message: 'Too many requests.' });
  assert.equal(a.tone, TONE.ERROR);
  assert.equal(a.message, 'Too many requests.');
});

/* ── optionsErrorText (P11-2) ─────────────────────────────────────────────── */

test('the retype instruction is shown on its own, without a failure prefix', async () => {
  const { optionsErrorText } = await import('../js/admin-error.js');
  const msg =
    'This configuration has changed since it was saved, so the stored credential was not used. Enter the credential to test these settings.';
  assert.equal(optionsErrorText({ kind: KIND.INVALID, message: msg }), msg);
});

test('any other failure keeps the Fetch failed prefix', async () => {
  const { optionsErrorText } = await import('../js/admin-error.js');
  assert.equal(optionsErrorText({ kind: KIND.NETWORK, message: 'boom' }), 'Fetch failed: boom');
  assert.equal(optionsErrorText(new Error('boom')), 'Fetch failed: boom');
});

test('optionsErrorText tolerates an error with no message', async () => {
  const { optionsErrorText } = await import('../js/admin-error.js');
  assert.equal(optionsErrorText({ kind: KIND.INVALID }), 'Fetch failed: Request failed.');
});
