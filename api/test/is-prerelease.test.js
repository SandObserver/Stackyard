const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { parseTag, isPrerelease, explain } = require('../../scripts/is-prerelease');

/* Which tags move `latest`, the tag an unpinned `docker pull` resolves to.

   A wrong answer here is not a build failure, it is a wrong image shipped
   quietly: a release candidate handed to everyone who never pinned a version,
   or a stable release nobody unpinned receives. */

test('a stable release is not a prerelease', () => {
  for (const tag of ['v1.5.0', '1.5.0', 'v2.0.0', 'v0.1.0', 'v10.20.30']) {
    assert.equal(isPrerelease(tag), false, `${tag} should be stable`);
  }
});

test('a release candidate is a prerelease', () => {
  for (const tag of ['v1.5.0-rc.1', 'v1.5.0-rc.2', 'v2.0.0-beta.3', 'v1.0.0-alpha', 'v1.0.0-0.3.7']) {
    assert.equal(isPrerelease(tag), true, `${tag} should be a prerelease`);
  }
});

test('build metadata does not make a release a candidate', () => {
  /* The hyphen heuristic this replaced called these prereleases, because the
     date inside the build metadata contains hyphens. */
  assert.equal(isPrerelease('v1.5.0+2026-08-08'), false);
  assert.equal(isPrerelease('v1.5.0+build.1'), false);
  assert.equal(parseTag('v1.5.0+2026-08-08').build, '2026-08-08');
});

test('a prerelease keeps its build metadata separate', () => {
  const parsed = parseTag('v1.5.0-rc.1+2026-08-08');
  assert.equal(parsed.prerelease, 'rc.1');
  assert.equal(parsed.build, '2026-08-08');
  assert.equal(isPrerelease('v1.5.0-rc.1+2026-08-08'), true);
});

test('anything that is not a version is treated as a prerelease', () => {
  /* The important direction. The hyphen heuristic read every one of these as a
     stable release and moved `latest` to it. */
  for (const tag of ['v1.5', 'v1', 'latest', 'v1.5.0.1', 'release-1.5.0', 'v01.5.0', 'v1.5.0-', '']) {
    assert.equal(isPrerelease(tag), true, `${tag || '(empty)'} should not be treated as stable`);
  }
});

test('a null or missing tag is a prerelease rather than a crash', () => {
  assert.equal(isPrerelease(undefined), true);
  assert.equal(isPrerelease(null), true);
});

test('the parse reports the parts it found', () => {
  assert.deepEqual(parseTag('v1.5.0-rc.2'), { major: 1, minor: 5, patch: 0, prerelease: 'rc.2', build: null });
  assert.equal(parseTag('nonsense'), null);
});

test('the explanation says which way it went and why', () => {
  assert.match(explain('v1.5.0'), /stable release/);
  assert.match(explain('v1.5.0-rc.1'), /prerelease/);
  assert.match(explain('v1.5'), /not a valid semver version/);
});

/* The workflow redirects stdout straight into $GITHUB_OUTPUT, so the exact
   shape of that line is load-bearing. */
test('the CLI writes one GITHUB_OUTPUT line and nothing else on stdout', () => {
  const script = path.join(__dirname, '..', '..', 'scripts', 'is-prerelease.js');
  const run = tag => execFileSync(process.execPath, [script, tag], { encoding: 'utf8' });
  assert.equal(run('v1.5.0'), 'prerelease=false\n');
  assert.equal(run('v1.5.0-rc.1'), 'prerelease=true\n');
  assert.equal(run('v1.5'), 'prerelease=true\n');
});

test('the CLI reads GITHUB_REF_NAME when given no argument', () => {
  const script = path.join(__dirname, '..', '..', 'scripts', 'is-prerelease.js');
  const out = execFileSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REF_NAME: 'v3.0.0-beta.1' },
  });
  assert.equal(out, 'prerelease=true\n');
});
