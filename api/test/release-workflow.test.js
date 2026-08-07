/* Regression tests for P17-1: a tag published without running any checks.

   .github/workflows/release.yml triggers on a v* tag and went straight from
   checkout to build-and-push. No tests, no lint, no typecheck: whatever main
   happened to contain was published to ghcr.io and tagged latest, which the
   public demo pulls. It also ran the mutating form of bump-cache-busting.js,
   rewriting 39 files, so the image was built from content nothing had verified.

   Both workflows now call one composite action, so the release cannot quietly
   fall behind what a pull request has to pass. These read the YAML as text
   rather than parsing it, which needs no dependency and is enough to pin the
   wiring; GitHub is the only thing that can truly validate a workflow. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const ACTION = '.github/actions/checks/action.yml';
const RELEASE = '.github/workflows/release.yml';
const TESTS = '.github/workflows/test.yml';

const action = read(ACTION);
const release = read(RELEASE);
const tests = read(TESTS);

test('the shared checks action exists and is a composite action', () => {
  assert.match(action, /using:\s*composite/);
  assert.match(action, /inputs:/);
});

/* The point of the change: one definition of what passing means. */
test('both workflows run the shared checks', () => {
  for (const [name, src] of [['release', release], ['tests', tests]]) {
    assert.match(src, /uses:\s*\.\/\.github\/actions\/checks/, `${name} does not use the shared checks`);
  }
});

test('the release runs the checks in release mode', () => {
  assert.match(release, /uses:\s*\.\/\.github\/actions\/checks[\s\S]{0,80}?mode:\s*release/);
});

test('the tests workflow runs them in test mode', () => {
  assert.match(tests, /uses:\s*\.\/\.github\/actions\/checks[\s\S]{0,80}?mode:\s*test/);
});

/* Each check the project relies on has to be in the shared action, or one
   workflow silently stops running it. */
test('the shared action runs every check the project has', () => {
  for (const step of [
    'npm test',                                  /* backend */
    'node --test',                               /* frontend */
    'npm run lint',
    'npm run typecheck',
    'npm run paths:ui',
    'bump-cache-busting.js --check',
    'docker build',
  ]) {
    assert.ok(action.includes(step), `the shared action does not run: ${step}`);
  }
});

/* The half that corrupted the artefact. The mutating pass is still needed, since
   --check only proves a stamp is present and not that it is current, but it must
   come after the suite: it writes entryVersions into every widget manifest, and
   widget-manifests.test.js asserts that field is never committed. */
test('the release stamps cache-busting after the tests, not before', () => {
  const stampAt = action.indexOf('name: Stamp asset cache-busting');
  const backendAt = action.indexOf('name: Run backend tests');
  const frontendAt = action.indexOf('name: Run frontend tests');
  assert.ok(stampAt !== -1, 'the release must still stamp: --check does not verify a stamp is current');
  assert.ok(backendAt !== -1 && frontendAt !== -1);
  assert.ok(stampAt > backendAt, 'stamping must not run before the backend tests');
  assert.ok(stampAt > frontendAt, 'stamping must not run before the frontend tests');
});

test('the stamp pass is release-only and its convergence is checked', () => {
  const stampBlock = action.slice(action.indexOf('name: Stamp asset cache-busting'));
  assert.match(stampBlock, /if:\s*inputs\.mode == 'release'/, 'stamping must not run on a pull request');
  assert.ok(action.includes('Verify stamping is settled'),
    'a second stamp pass must be asserted to change nothing, or the image differs from a rebuild');
});

/* The failure this replaces: the release doing its own thing. */
test('the release does not run checks of its own outside the shared action', () => {
  const beforeAction = release.slice(0, release.indexOf('uses: ./.github/actions/checks'));
  for (const stray of ['npm test', 'npm run lint', 'bump-cache-busting']) {
    assert.ok(!beforeAction.includes(stray),
      `release.yml runs "${stray}" before the shared checks; it belongs in the action`);
  }
});

test('the release still publishes only after the checks', () => {
  const checksAt = release.indexOf('uses: ./.github/actions/checks');
  const pushAt = release.indexOf('docker/build-push-action');
  assert.ok(checksAt !== -1 && pushAt !== -1);
  assert.ok(checksAt < pushAt, 'the image must not be built and pushed before the checks run');
});

/* A release builds and pushes for real straight afterwards, so a smoke build in
   the shared action would just repeat a slow multi-platform step. */
test('the smoke build is skipped on the release path', () => {
  const smoke = action.slice(action.indexOf('name: Docker build smoke test'));
  assert.match(smoke, /if:\s*inputs\.mode == 'test'/);
});
