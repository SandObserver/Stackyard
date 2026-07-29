/* Regression tests for P5-1: a stored credential could be redirected.

   /api/widget-options/:id and /api/badge-proxy both let the request choose the
   destination while the server supplies the credential, and both restored on the
   item id alone. Posting a config with the URL changed and the secret omitted
   sent the real secret to the caller's host in plaintext.

   The rule is in api/src/secret-scope.js: restore only when every non-secret
   field is identical to what is saved. These tests pin the rule; the end-to-end
   behaviour of both endpoints is in secret-scope-integration.test.js. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.WIDGETS_PATH = path.join(__dirname, '../../ui/widgets');

const {
  stableEqual, stripWidgetSecrets, widgetConfigMatchesSaved,
  rowsMatch, badgeRequestMatchesSaved,
} = require('../src/secret-scope');
const { getRegistry } = require('../src/widgets');

const books = getRegistry().books;
const SAVED = { absUrl: 'https://real.example', absKey: 'STORED-KEY', absKeySet: true };

/* ── stableEqual ──────────────────────────────────────────────────────────── */

test('stableEqual ignores key order', () => {
  assert.equal(stableEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
});

test('stableEqual respects array order', () => {
  assert.equal(stableEqual([1, 2], [2, 1]), false);
  assert.equal(stableEqual([1, 2], [1, 2]), true);
});

test('stableEqual distinguishes a missing key from an undefined one', () => {
  assert.equal(stableEqual({ a: 1 }, { a: 1, b: undefined }), false);
});

test('stableEqual compares nested structures', () => {
  assert.equal(stableEqual({ a: [{ b: 1 }] }, { a: [{ b: 1 }] }), true);
  assert.equal(stableEqual({ a: [{ b: 1 }] }, { a: [{ b: 2 }] }), false);
});

test('stableEqual handles null and mixed types', () => {
  assert.equal(stableEqual(null, null), true);
  assert.equal(stableEqual(null, {}), false);
  assert.equal(stableEqual(0, '0'), false);
});

/* ── stripWidgetSecrets ───────────────────────────────────────────────────── */

test('stripWidgetSecrets removes declared secrets and their Set flags', () => {
  const out = stripWidgetSecrets(SAVED, books);
  assert.deepEqual(out, { absUrl: 'https://real.example' });
});

test('stripWidgetSecrets does not mutate its input', () => {
  const input = { absUrl: 'x', absKey: 'k' };
  stripWidgetSecrets(input, books);
  assert.equal(input.absKey, 'k');
});

/* ── widgetConfigMatchesSaved ─────────────────────────────────────────────── */

test('an unchanged config restores the stored secret', () => {
  assert.equal(widgetConfigMatchesSaved({ absUrl: 'https://real.example' }, SAVED, books), true);
});

/* The finding itself. */
test('a redirected destination does not restore the stored secret', () => {
  assert.equal(widgetConfigMatchesSaved({ absUrl: 'https://evil.example' }, SAVED, books), false);
});

test('any other changed field also declines, not just the URL', () => {
  assert.equal(widgetConfigMatchesSaved({ absUrl: 'https://real.example', href: '/x' }, SAVED, books), false);
});

test('a differing secret value never affects the decision', () => {
  const posted = { absUrl: 'https://real.example', absKey: 'whatever-the-caller-typed' };
  assert.equal(widgetConfigMatchesSaved(posted, SAVED, books), true);
});

test('key order alone is not a change', () => {
  assert.equal(widgetConfigMatchesSaved({ absKeySet: true, absUrl: 'https://real.example' }, SAVED, books), true);
});

test('an unknown widget type never restores', () => {
  assert.equal(widgetConfigMatchesSaved({ absUrl: 'https://real.example' }, SAVED, undefined), false);
});

/* ── rowsMatch and badgeRequestMatchesSaved ───────────────────────────────── */

const STORED_BADGE = {
  url: 'https://real.example/api',
  headers: [{ key: 'X-Api-Key', value: 'STORED-KEY', secret: true }],
  params: [{ key: 'mode', value: 'full', secret: false }],
};
const asSent = {
  url: 'https://real.example/api',
  headers: [{ key: 'X-Api-Key', secret: true }],
  params: [{ key: 'mode', value: 'full', secret: false }],
};

test('an unchanged badge request restores', () => {
  assert.equal(badgeRequestMatchesSaved(asSent, STORED_BADGE), true);
});

/* The finding itself, on the second endpoint. */
test('a redirected badge URL does not restore', () => {
  const moved = Object.assign({}, asSent, { url: 'https://evil.example/collect' });
  assert.equal(badgeRequestMatchesSaved(moved, STORED_BADGE), false);
});

test('a renamed header does not restore', () => {
  const renamed = Object.assign({}, asSent, { headers: [{ key: 'X-Other', secret: true }] });
  assert.equal(badgeRequestMatchesSaved(renamed, STORED_BADGE), false);
});

test('flipping a row out of secret does not restore', () => {
  const flipped = Object.assign({}, asSent, { headers: [{ key: 'X-Api-Key', secret: false }] });
  assert.equal(badgeRequestMatchesSaved(flipped, STORED_BADGE), false);
});

test('an added or removed row does not restore', () => {
  const extra = Object.assign({}, asSent, { params: [...asSent.params, { key: 'x', value: '1', secret: false }] });
  assert.equal(badgeRequestMatchesSaved(extra, STORED_BADGE), false);
  assert.equal(badgeRequestMatchesSaved(Object.assign({}, asSent, { params: [] }), STORED_BADGE), false);
});

test('a changed non-secret param value does not restore', () => {
  const changed = Object.assign({}, asSent, { params: [{ key: 'mode', value: 'short', secret: false }] });
  assert.equal(badgeRequestMatchesSaved(changed, STORED_BADGE), false);
});

test('rowsMatch treats a reorder as a change', () => {
  const a = [{ key: 'a', value: '1', secret: false }, { key: 'b', value: '2', secret: false }];
  assert.equal(rowsMatch([a[1], a[0]], a), false);
  assert.equal(rowsMatch(a, a), true);
});

test('a badge request with nothing stored never restores', () => {
  assert.equal(badgeRequestMatchesSaved(asSent, null), false);
  assert.equal(badgeRequestMatchesSaved(asSent, undefined), false);
});
