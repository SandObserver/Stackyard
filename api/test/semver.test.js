/* Regression tests for P6-5 and P6-11: the update check.

   The old comparison split on '.' and ran parseInt over the parts, so
   "1.5.0-rc.1" parsed as [1, 5, 0, 1]: parseInt("0-rc") is 0 and the trailing
   ".1" became a fourth number. The release "1.5.0" therefore compared as older
   than its own release candidate, and anyone running an rc was told they were up
   to date, permanently and silently.

   Precedence is implemented from semver.org section 11 rather than approximated.
   The approximation that only asks "does it have a suffix" gets rc.2 against
   rc.10 wrong, which the old code happened to get right. */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseVersion, compareVersions, isNewer } = require('../src/semver');

/* ── the finding ──────────────────────────────────────────────────────────── */

test('a release outranks its own release candidate', () => {
  assert.equal(isNewer('1.5.0', '1.5.0-rc.1'), true);
  assert.equal(isNewer('1.5.0', '1.5.0-rc1'), true, 'with or without the dot');
  assert.equal(isNewer('1.5.0-rc.1', '1.5.0'), false);
});

test('a prerelease no longer parses its suffix as another number', () => {
  assert.deepEqual(parseVersion('1.5.0-rc.1'), { nums: [1, 5, 0], pre: ['rc', '1'] });
  assert.deepEqual(parseVersion('1.5.0'), { nums: [1, 5, 0], pre: [] });
});

/* Worked by accident before, and must keep working. */
test('prerelease numbers compare numerically, not as text', () => {
  assert.equal(isNewer('1.5.0-rc.10', '1.5.0-rc.2'), true, 'the case an approximation gets wrong');
  assert.equal(isNewer('1.0.0-beta.11', '1.0.0-beta.2'), true);
});

/* ── ordinary comparisons ─────────────────────────────────────────────────── */

test('release numbers compare as numbers', () => {
  assert.equal(isNewer('1.5.0', '1.4.0'), true);
  assert.equal(isNewer('1.4.0', '1.5.0'), false);
  assert.equal(isNewer('1.10.0', '1.9.0'), true, 'ten is above nine');
  assert.equal(isNewer('2.0.0', '1.99.99'), true);
});

test('an identical version is not newer', () => {
  for (const v of ['1.4.0', '1.5.0-rc.1', '0.0.0']) assert.equal(isNewer(v, v), false);
});

test('a leading v is ignored', () => {
  assert.equal(isNewer('v2.0.0', '1.9.9'), true);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
});

test('build metadata carries no precedence', () => {
  assert.equal(compareVersions('1.0.0+build9', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0+a', '1.0.0+b'), 0);
});

test('missing segments count as zero', () => {
  assert.equal(compareVersions('1.5', '1.5.0'), 0);
  assert.equal(compareVersions('1', '1.0.0'), 0);
  assert.equal(isNewer('1.5.1', '1.5'), true);
});

/* ── the spec's own example ───────────────────────────────────────────────── */

/* semver.org gives this exact ordering. Checking the published chain is cheaper
   and more convincing than inventing cases. */
test('the ordering from the specification holds', () => {
  const chain = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
  ];
  for (let i = 1; i < chain.length; i++) {
    assert.equal(compareVersions(chain[i], chain[i - 1]), 1, `${chain[i]} should follow ${chain[i - 1]}`);
    assert.equal(compareVersions(chain[i - 1], chain[i]), -1, 'and the reverse');
  }
});

test('a numeric identifier ranks below an alphanumeric one', () => {
  assert.equal(compareVersions('1.0.0-1', '1.0.0-alpha'), -1);
});

test('a longer prerelease wins when the shared parts are equal', () => {
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0-alpha'), 1);
});

/* ── junk ─────────────────────────────────────────────────────────────────── */

test('input with no usable numbers is treated as 0.0.0', () => {
  for (const v of ['', null, undefined, 'not-a-version', {}, []]) {
    assert.doesNotThrow(() => compareVersions(v, '1.0.0'));
    assert.deepEqual(parseVersion(v).nums, [0, 0, 0], `for ${JSON.stringify(v)}`);
    assert.equal(isNewer(v, '1.0.0'), false, `${JSON.stringify(v)} must not look newer`);
  }
});

test('a non-numeric segment counts as zero', () => {
  assert.equal(compareVersions('1.x.0', '1.0.0'), 0);
  assert.deepEqual(parseVersion('1.x.0').nums, [1, 0, 0]);
});

/* A dash always starts the prerelease, per the spec, so "1.-2.0" is 1.0.0 with
   the prerelease "2.0" rather than a malformed number. That makes it rank below
   1.0.0, which is the safe direction: an unrecognisable version never looks
   newer than a real one. */
test('a dash always begins the prerelease', () => {
  assert.deepEqual(parseVersion('1.-2.0'), { nums: [1, 0, 0], pre: ['2', '0'] });
  assert.equal(compareVersions('1.-2.0', '1.0.0'), -1);
});

/* A bare number is a legitimate version, since 1.5 and 2 are accepted above. */
test('a numeric input is read as its major version', () => {
  assert.deepEqual(parseVersion(5).nums, [5, 0, 0]);
  assert.equal(isNewer(5, '1.0.0'), true);
});
