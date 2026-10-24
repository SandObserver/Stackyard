const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseVersion, missingSecurityRelease } = require('../../scripts/node-security');

const RELEASES = [
  { version: 'v26.12.1', security: true },
  { version: 'v24.23.0', security: false },
  { version: 'v24.22.1', security: true },
  { version: 'v24.22.0', security: false },
  { version: 'v24.21.3', security: true },
  { version: 'v22.23.4', security: true },
];

test('an image behind a security release on its line is reported', () => {
  assert.equal(missingSecurityRelease('24.22.0', RELEASES), 'v24.22.1');
  assert.equal(missingSecurityRelease('v24.21.0', RELEASES), 'v24.22.1');
});

test('an image on or past the newest security release passes', () => {
  assert.equal(missingSecurityRelease('24.22.1', RELEASES), null);
  assert.equal(missingSecurityRelease('24.23.0', RELEASES), null);
});

test('releases on other major lines are ignored', () => {
  assert.equal(missingSecurityRelease('22.23.4', RELEASES), null);
  assert.equal(missingSecurityRelease('25.0.0', RELEASES), null);
});

test('a newer release without security fixes is not reported', () => {
  assert.equal(missingSecurityRelease('24.22.1', [{ version: 'v24.23.0', security: false }]), null);
});

test('an unreadable installed version throws rather than passing', () => {
  for (const v of ['', 'latest', '24.22', undefined]) {
    assert.throws(() => missingSecurityRelease(v, RELEASES), /not a Node.js version/);
  }
});

test('the parse accepts both spellings', () => {
  assert.deepEqual(parseVersion('v24.22.1'), [24, 22, 1]);
  assert.deepEqual(parseVersion('24.22.1'), [24, 22, 1]);
  assert.equal(parseVersion('v24.22.1-rc.1'), null);
});
