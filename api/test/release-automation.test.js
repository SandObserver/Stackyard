const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

/* GITHUB_TOKEN starts no workflow run, so a tag or a release page it creates
   ends the chain silently. */

const ROOT = path.join(__dirname, '..', '..');
const wf = f => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8');

const APP_TOKEN = 'steps.app.outputs.token';

test('release prep opens a pull request rather than writing to the default branch', () => {
  const src = wf('release-prep.yml');
  assert.match(src, /workflow_dispatch/, 'the release has to be startable by hand');
  assert.match(src, /gh pr create/);
  assert.match(src, /HEAD:\$\{BRANCH\}/, 'the push must go to the release branch');
  assert.doesNotMatch(src, /HEAD:\$\{BASE\}/, 'a direct push to the default branch is rejected by the ruleset');
});

test('the tag and the release page are pushed with the app token', () => {
  for (const f of ['release-tag.yml', 'release.yml', 'ca-template-changes.yml']) {
    const src = wf(f);
    assert.ok(src.includes(APP_TOKEN), `${f} does not use the app token`);
    assert.doesNotMatch(
      src,
      /GH_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN/,
      `${f} uses GITHUB_TOKEN, which starts no workflow run`,
    );
  }
});

test('tagging is skipped unless the changelog says this version is released', () => {
  const src = wf('release-tag.yml');
  assert.match(src, /changelog-check\.js --release/, 'a version bump alone must not tag a release');
  assert.match(src, /git ls-remote --exit-code --tags/, 'an existing tag must not be pushed again');
});

test('the release page is published from the changelog, after the image', () => {
  const doc = yaml.load(wf('release.yml'));
  const page = doc.jobs['release-page'];
  assert.ok(page, 'release.yml has no release-page job');
  assert.equal(page.needs, 'verify-published', 'the page must not describe an image that failed to publish');
  assert.equal(
    doc.jobs['verify-published'].needs,
    'build-and-push',
    'verification reads the pushed image, so it runs after the push',
  );
  const script = page.steps.map(s => s.run || '').join('\n');
  assert.match(script, /release-notes\.js/, 'the notes must come from CHANGELOG.md');
  assert.match(script, /gh release create/);
  assert.match(script, /--verify-tag/, 'the page must refuse to create its own tag');
  assert.match(script, /gh release view/, 'republishing an existing page would overwrite it');
});

test('the release workflows grant the built-in token nothing', () => {
  for (const f of ['release-prep.yml', 'release-tag.yml', 'ca-template-changes.yml']) {
    const doc = yaml.load(wf(f));
    assert.deepEqual(doc.permissions, {}, `${f} should leave GITHUB_TOKEN with no scope`);
  }
  const release = yaml.load(wf('release.yml'));
  assert.deepEqual(release.jobs['release-page'].permissions, {});
});

test('a stable release asks the documentation site to rebuild', () => {
  const doc = yaml.load(wf('release.yml'));
  const job = doc.jobs['docs-rebuild'];
  assert.ok(job, 'release.yml has no docs-rebuild job');
  assert.equal(job.needs, 'release-page', 'the site must not describe a release page that failed');
  assert.deepEqual(job.permissions, {}, 'the rebuild needs no scope on this repository');
  assert.match(String(job.if), /prerelease == 'false'/, 'an rc tag must not move the site');
  assert.equal(doc.jobs['release-page'].outputs?.prerelease, '${{ steps.tag.outputs.prerelease }}');
  const script = job.steps.map(s => s.run || '').join('\n');
  assert.match(script, /DOCS_DEPLOY_HOOK_URL is not set/, 'a missing hook must not fail the release');
  assert.doesNotMatch(script, /echo\s+"?\$HOOK/, 'the hook URL is a credential and must not be printed');
});

test('the release runs one at a time', () => {
  for (const f of ['release-prep.yml', 'release-tag.yml']) {
    const doc = yaml.load(wf(f));
    assert.equal(doc.concurrency?.group, 'release', `${f} needs the shared release concurrency group`);
  }
});

test('the changelog write job never runs pull request code', () => {
  const doc = yaml.load(wf('changelog.yml'));
  assert.deepEqual(doc.permissions, {});
  const write = doc.jobs.write;
  assert.match(write.if, /merged == true/, 'an unmerged pull request must not write the changelog');
  const checkout = write.steps.find(s => String(s.uses).startsWith('actions/checkout'));
  assert.equal(checkout.with.ref, '${{ github.event.repository.default_branch }}');
  assert.equal(checkout.with['persist-credentials'], false);
  const script = write.steps.map(s => s.run || '').join('\n');
  assert.doesNotMatch(script, /\$\{\{/, 'event data must reach the script through env, never inline');
  assert.ok(wf('changelog.yml').includes(APP_TOKEN), 'the push must use the app token');
});
