const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  toRows, rowsToObject, requestParts,
  scrubItemBadgeSecrets, preserveItemBadgeSecrets, migrateItemBadgeHeaders,
} = require('../src/badge-headers');

test('toRows converts the old object shape to non-secret rows', () => {
  assert.deepEqual(
    toRows({ 'X-Api-Key': 'abc', Accept: 'application/json' }),
    [{ key: 'X-Api-Key', value: 'abc', secret: false }, { key: 'Accept', value: 'application/json', secret: false }],
  );
  assert.deepEqual(toRows(undefined), []);
  assert.deepEqual(toRows(null), []);
});

test('toRows leaves an existing row array untouched', () => {
  const rows = [{ key: 'a', value: 'b', secret: true }];
  assert.equal(toRows(rows), rows);
});

test('rowsToObject skips blank keys and null values', () => {
  const rows = [
    { key: 'A', value: '1', secret: false },
    { key: '', value: '2', secret: false },
    { key: 'B', secret: true },
  ];
  assert.deepEqual(rowsToObject(rows), { A: '1' });
});

test('scrub hides secret values, keeps non-secret ones', () => {
  const item = { type: 'app', badge: { headers: [
    { key: 'X-Api-Key', value: 'REAL', secret: true },
    { key: 'Accept', value: 'application/json', secret: false },
  ] } };
  scrubItemBadgeSecrets(item);
  assert.deepEqual(item.badge.headers, [
    { key: 'X-Api-Key', secret: true, valueSet: true },
    { key: 'Accept', value: 'application/json', secret: false },
  ]);
});

test('scrub covers both badge and activity blocks', () => {
  const item = {
    badge: { params: [{ key: 'k', value: 'v', secret: true }] },
    monitoring: { activity: { headers: [{ key: 'h', value: 'v', secret: true }] } },
  };
  scrubItemBadgeSecrets(item);
  assert.equal(item.badge.params[0].value, undefined);
  assert.equal(item.monitoring.activity.headers[0].value, undefined);
});

test('preserve restores an untouched secret from stored config', () => {
  const stored = { badge: { headers: [{ key: 'X-Api-Key', value: 'REAL', secret: true }] } };
  const incoming = { badge: { headers: [{ key: 'X-Api-Key', secret: true, valueSet: true }] } };
  preserveItemBadgeSecrets(incoming, stored);
  assert.equal(incoming.badge.headers[0].value, 'REAL');
  assert.equal(incoming.badge.headers[0].valueSet, undefined);
});

test('preserve takes a retyped value over the stored one', () => {
  const stored = { badge: { headers: [{ key: 'X-Api-Key', value: 'REAL', secret: true }] } };
  const incoming = { badge: { headers: [{ key: 'X-Api-Key', value: 'NEW', secret: true }] } };
  preserveItemBadgeSecrets(incoming, stored);
  assert.equal(incoming.badge.headers[0].value, 'NEW');
});

test('preserve keeps the value when a secret is unchecked without a retype', () => {
  const stored = { badge: { headers: [{ key: 'X-Api-Key', value: 'REAL', secret: true }] } };
  const incoming = { badge: { headers: [{ key: 'X-Api-Key', secret: false }] } };
  preserveItemBadgeSecrets(incoming, stored);
  assert.equal(incoming.badge.headers[0].value, 'REAL');
  assert.equal(incoming.badge.headers[0].secret, false);
});

test('preserve does not leak a stored value into a new unrelated key', () => {
  const stored = { badge: { headers: [{ key: 'X-Api-Key', value: 'REAL', secret: true }] } };
  const incoming = { badge: { headers: [{ key: 'X-New', secret: true }] } };
  preserveItemBadgeSecrets(incoming, stored);
  assert.equal(incoming.badge.headers[0].value, undefined);
});

test('scrub then preserve round-trips without losing the secret', () => {
  const stored = { type: 'app', badge: { headers: [
    { key: 'X-Api-Key', value: 'REAL', secret: true },
    { key: 'Accept', value: 'application/json', secret: false },
  ] } };
  const sent = JSON.parse(JSON.stringify(stored));
  scrubItemBadgeSecrets(sent);
  /* browser edits nothing and posts the scrubbed shape back */
  preserveItemBadgeSecrets(sent, stored);
  assert.equal(sent.badge.headers[0].value, 'REAL');
  assert.deepEqual(requestParts(sent).headers, { 'X-Api-Key': 'REAL', Accept: 'application/json' });
});

test('requestParts prefers the activity block when enabled', () => {
  const item = {
    badge: { headers: [{ key: 'from', value: 'badge', secret: false }] },
    monitoring: { activity: { enabled: true, headers: [{ key: 'from', value: 'activity', secret: false }] } },
  };
  assert.deepEqual(requestParts(item).headers, { from: 'activity' });
});

test('migration converts old objects to rows, defaulting to non-secret', () => {
  const item = { type: 'app', monitoring: { activity: { headers: { 'X-Api-Key': 'abc' }, params: { a: '1' } } } };
  assert.equal(migrateItemBadgeHeaders(item), true);
  assert.deepEqual(item.monitoring.activity.headers, [{ key: 'X-Api-Key', value: 'abc', secret: false }]);
  assert.deepEqual(item.monitoring.activity.params, [{ key: 'a', value: '1', secret: false }]);
});

test('migration is a no-op on already-migrated rows', () => {
  const item = { badge: { headers: [{ key: 'a', value: 'b', secret: true }] } };
  assert.equal(migrateItemBadgeHeaders(item), false);
});
