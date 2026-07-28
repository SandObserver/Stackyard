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

/* Replaces 'preserve keeps the value when a secret is unchecked without a
   retype', which asserted the opposite. Restoring into a non-secret row moved
   the stored credential into a row that scrubRows sends to the browser in full,
   so unticking the Secret box and saving handed it back in plaintext. */
test('preserve clears the value when a secret row arrives as non-secret', () => {
  const stored = { badge: { headers: [{ key: 'X-Api-Key', value: 'REAL', secret: true }] } };
  const incoming = { badge: { headers: [{ key: 'X-Api-Key', secret: false }] } };
  preserveItemBadgeSecrets(incoming, stored);
  assert.equal(incoming.badge.headers[0].value, '');
  assert.equal(incoming.badge.headers[0].secret, false);
});

test('a stored secret cannot be read back by unticking Secret', () => {
  /* The full round trip, which is what the finding actually was. */
  const stored = { badge: { headers: [{ key: 'X-Api-Key', value: 'SUPER-SECRET', secret: true }] } };

  const masked = JSON.parse(JSON.stringify(stored));
  scrubItemBadgeSecrets(masked);
  assert.equal(masked.badge.headers[0].value, undefined, 'the browser never sees the value');

  const incoming = { badge: { headers: [{ key: 'X-Api-Key', secret: false }] } };
  preserveItemBadgeSecrets(incoming, stored);
  scrubItemBadgeSecrets(incoming);
  const out = JSON.stringify(incoming);
  assert.ok(!out.includes('SUPER-SECRET'), `the stored secret came back: ${out}`);
});

test('preserve still refills a row that is left marked secret', () => {
  const stored = { badge: { headers: [{ key: 'X-Api-Key', value: 'REAL', secret: true }] } };
  const incoming = { badge: { headers: [{ key: 'X-Api-Key', secret: true, valueSet: true }] } };
  preserveItemBadgeSecrets(incoming, stored);
  assert.equal(incoming.badge.headers[0].value, 'REAL', 'an untouched credential must survive a save');
  assert.ok(!('valueSet' in incoming.badge.headers[0]));
});

test('a retyped non-secret value is kept as sent', () => {
  const stored = { badge: { headers: [{ key: 'X-Api-Key', value: 'REAL', secret: true }] } };
  const incoming = { badge: { headers: [{ key: 'X-Api-Key', secret: false, value: 'plain' }] } };
  preserveItemBadgeSecrets(incoming, stored);
  assert.equal(incoming.badge.headers[0].value, 'plain');
});

test('an ordinary non-secret row is unaffected', () => {
  const stored = { badge: { params: [{ key: 'mode', value: 'full', secret: false }] } };
  const incoming = { badge: { params: [{ key: 'mode', value: 'short', secret: false }] } };
  preserveItemBadgeSecrets(incoming, stored);
  assert.equal(incoming.badge.params[0].value, 'short');
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
