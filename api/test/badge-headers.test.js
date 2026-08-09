const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  toRows,
  rowsToObject: _rowsToObject,
  requestParts: _requestParts,
  scrubItemBadgeSecrets,
  preserveItemBadgeSecrets,
  migrateItemBadgeHeaders,
  droppedRowCount,
  firstMalformedRow,
} = require('../src/badge-headers');
const { plain } = require('../test-support/plain');

/* Both build null-prototype objects, because their keys are header and param
   names from stored config. assert/strict compares prototypes, so the results
   are copied onto an ordinary one and the expectations stay object literals. */
const rowsToObject = rows => plain(_rowsToObject(rows));
const requestParts = item => plain(_requestParts(item));

test('toRows converts the old object shape to non-secret rows', () => {
  assert.deepEqual(toRows({ 'X-Api-Key': 'abc', Accept: 'application/json' }), [
    { key: 'X-Api-Key', value: 'abc', secret: false },
    { key: 'Accept', value: 'application/json', secret: false },
  ]);
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
  const item = {
    type: 'app',
    badge: {
      headers: [
        { key: 'X-Api-Key', value: 'REAL', secret: true },
        { key: 'Accept', value: 'application/json', secret: false },
      ],
    },
  };
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
  const stored = {
    type: 'app',
    badge: {
      headers: [
        { key: 'X-Api-Key', value: 'REAL', secret: true },
        { key: 'Accept', value: 'application/json', secret: false },
      ],
    },
  };
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

/* ── P4-4: one bad element discarded the whole row array ─────────────────────
   isRowArray required every element to be valid, so a single bad one sent the
   array to the legacy-object branch: the indices became header names and each
   row stringified. The request went out with a header called "0" whose value was
   "[object Object]" and without the real credential, so the service answered as
   it would to any stranger. After the structured-error work that reads as
   "authentication required", pointing the user at a credential that was stored
   correctly all along.

   An array is rows now. Bad elements are skipped on read, because this runs on
   stored config and refusing would break a badge over one damaged entry, and
   refused on write so they cannot be stored in the first place. */

test('a single bad element no longer discards the real rows', () => {
  const rows = [{ key: 'X-Api-Key', value: 'k', secret: true }, null];
  assert.deepEqual(rowsToObject(rows), { 'X-Api-Key': 'k' });
});

test('the indices never become header names', () => {
  const out = rowsToObject([{ key: 'A', value: '1', secret: false }, 'oops']);
  assert.ok(!('0' in out), `index leaked as a header: ${JSON.stringify(out)}`);
  assert.ok(!JSON.stringify(out).includes('[object Object]'));
});

test('every kind of junk element is skipped', () => {
  for (const bad of [null, undefined, 'x', 5, true, [], { noKey: 1 }, { key: 5 }]) {
    const out = rowsToObject([{ key: 'A', value: '1', secret: false }, bad]);
    assert.deepEqual(out, { A: '1' }, `failed for ${JSON.stringify(bad)}`);
  }
});

test('an array of only junk yields nothing rather than nonsense', () => {
  assert.deepEqual(rowsToObject([null, 'x', 5]), {});
});

test('the legacy object shape still converts', () => {
  assert.deepEqual(rowsToObject({ 'X-Api-Key': 'k', Accept: 'json' }), { 'X-Api-Key': 'k', Accept: 'json' });
});

/* A clean array is handed back unchanged, so the common path neither allocates
   nor breaks callers that rely on getting the same array back. */
test('a clean row array is not copied', () => {
  const rows = [{ key: 'A', value: '1', secret: false }];
  assert.equal(toRows(rows), rows);
});

test('droppedRowCount reports how much was skipped', () => {
  assert.equal(droppedRowCount([{ key: 'A', value: '1' }]), 0);
  assert.equal(droppedRowCount([{ key: 'A', value: '1' }, null, 'x']), 2);
  assert.equal(droppedRowCount({ A: '1' }), 0, 'the legacy shape drops nothing');
  assert.equal(droppedRowCount(undefined), 0);
});

/* ── refused on the way in ────────────────────────────────────────────────── */

test('firstMalformedRow names the field and the position', () => {
  assert.deepEqual(firstMalformedRow({ badge: { headers: [{ key: 'A', value: '1' }, null] } }), {
    field: 'badge.headers',
    index: 1,
  });
  assert.deepEqual(firstMalformedRow({ badge: { params: ['x'] } }), { field: 'badge.params', index: 0 });
  assert.deepEqual(firstMalformedRow({ monitoring: { activity: { headers: [5] } } }), {
    field: 'monitoring.activity.headers',
    index: 0,
  });
});

test('a clean item reports nothing', () => {
  assert.equal(firstMalformedRow({ badge: { headers: [{ key: 'A', value: '1', secret: false }] } }), null);
  assert.equal(firstMalformedRow({ badge: {} }), null);
  assert.equal(firstMalformedRow({}), null);
  assert.equal(firstMalformedRow(null), null);
});

/* The old shape is still valid config and must not be rejected on save. */
test('the legacy object shape is not treated as malformed', () => {
  assert.equal(firstMalformedRow({ badge: { headers: { 'X-Api-Key': 'k' } } }), null);
});
