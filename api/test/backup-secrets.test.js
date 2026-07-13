const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyBackupSlotDonors } = require('../src/backup-secrets');

test('fills a duplicati slot password from a sibling with the same url', () => {
  const slots = [
    { provider: 'duplicati', dupUrl: 'http://d:8200', dupPass: 'secret' },
    { provider: 'duplicati', dupUrl: 'http://d:8200' },
  ];
  applyBackupSlotDonors(slots);
  assert.equal(slots[1].dupPass, 'secret');
  assert.equal(slots[1].dupPassSet, true);
});

test('fills a kopia slot password from a sibling with the same url', () => {
  const slots = [
    { provider: 'kopia', kopiaUrl: 'http://k:51515' },
    { provider: 'kopia', kopiaUrl: 'http://k:51515', kopiaPass: 'ksecret' },
  ];
  applyBackupSlotDonors(slots);
  assert.equal(slots[0].kopiaPass, 'ksecret');
  assert.equal(slots[0].kopiaPassSet, true);
});

test('does not overwrite a password the slot already has', () => {
  const slots = [
    { provider: 'duplicati', dupUrl: 'http://d:8200', dupPass: 'donor' },
    { provider: 'duplicati', dupUrl: 'http://d:8200', dupPass: 'own' },
  ];
  applyBackupSlotDonors(slots);
  assert.equal(slots[1].dupPass, 'own');
});

test('does not copy across a different url or provider', () => {
  const slots = [
    { provider: 'duplicati', dupUrl: 'http://a:8200', dupPass: 'secret' },
    { provider: 'duplicati', dupUrl: 'http://b:8200' },
    { provider: 'kopia', kopiaUrl: 'http://a:8200' },
  ];
  applyBackupSlotDonors(slots);
  assert.equal(slots[1].dupPass, undefined);
  assert.equal(slots[2].kopiaPass, undefined);
});

test('is a no-op for a non-array', () => {
  assert.doesNotThrow(() => applyBackupSlotDonors(undefined));
  assert.doesNotThrow(() => applyBackupSlotDonors(null));
});
