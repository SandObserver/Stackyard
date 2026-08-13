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
import { badgeErrorAdvice, optionsErrorAdvice, KIND, TONE } from '../js/admin-error.js';

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

/* A private address is what most homelab installs point a badge at, and one
   setting unblocks it. The API sends a reason code, never the address, so the
   advice must key off the code. */
test('a blocked private address names the setting that allows it', () => {
  const message = 'The request was blocked.';
  const a = badgeErrorAdvice({ kind: KIND.BLOCKED, message, detail: { reason: 'private-address' } });
  assert.equal(a.tone, TONE.WARN);
  assert.match(a.message, /ALLOW_PRIVATE_IPS=true/);
  assert.ok(a.message.includes(message), 'keeps the original reason');
  assert.equal(a.openAuth, false);
  assert.equal(a.sessionExpired, false);
});

/* The message the API actually sends for a private address carries no wording
   to match on, so a matcher over the text advises nobody. */
test('a block without the reason code gets no private-address advice', () => {
  const a = badgeErrorAdvice({ kind: KIND.BLOCKED, message: 'The request was blocked.' });
  assert.equal(a.tone, TONE.ERROR);
  assert.doesNotMatch(a.message, /ALLOW_PRIVATE_IPS/);
});

test('the widget options Fetch gives the same advice', () => {
  const blocked = { kind: KIND.BLOCKED, message: 'The request was blocked.', detail: { reason: 'private-address' } };
  assert.match(optionsErrorAdvice(blocked).message, /ALLOW_PRIVATE_IPS=true/);
  assert.equal(optionsErrorAdvice(blocked).tone, TONE.WARN, 'a fixable setting is not a hard error');
  const plain = optionsErrorAdvice({ kind: KIND.BLOCKED, message: 'The request was blocked.' });
  assert.match(plain.message, /^Fetch failed: /);
  assert.equal(plain.tone, TONE.ERROR);
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

/* ── optionsErrorAdvice (P11-2) ───────────────────────────────────────────── */

test('the retype instruction is shown on its own, without a failure prefix', async () => {
  const { optionsErrorAdvice } = await import('../js/admin-error.js');
  const msg =
    'This configuration has changed since it was saved, so the stored credential was not used. Enter the credential to test these settings.';
  assert.equal(optionsErrorAdvice({ kind: KIND.INVALID, message: msg }).message, msg);
});

test('any other failure keeps the Fetch failed prefix', async () => {
  const { optionsErrorAdvice } = await import('../js/admin-error.js');
  assert.equal(optionsErrorAdvice({ kind: KIND.NETWORK, message: 'boom' }).message, 'Fetch failed: boom');
  assert.equal(optionsErrorAdvice(new Error('boom')).message, 'Fetch failed: boom');
});

test('optionsErrorAdvice tolerates an error with no message', async () => {
  const { optionsErrorAdvice } = await import('../js/admin-error.js');
  assert.equal(optionsErrorAdvice({ kind: KIND.INVALID }).message, 'Fetch failed: Request failed.');
});
