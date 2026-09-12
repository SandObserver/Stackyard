/* release-prep can abort after the fragments have been folded, so it plans the
   fold, runs every check, and only then writes and deletes. A local run that
   tripped a check used to lose the fragment files and leave CHANGELOG.md
   rewritten. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpDir } = require('../test-support/tmp');

const ROOT = path.join(__dirname, '..', '..');

/* The repository's own changelog is not an input here. Release prep empties
   [Unreleased] and deletes the fragments, so on a release branch the real files
   give prep nothing to release and every case below becomes the same abort. */
const SEED_CHANGELOG = `# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A seeded entry, so the section is not empty.

## [1.2.0] - 2026-01-02

### Fixed

- A seeded fix.

[Unreleased]: https://github.com/SandObserver/stackyard/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/SandObserver/stackyard/compare/v1.1.0...v1.2.0
`;

const SEED_FRAGMENTS = {
  'README.md': '# Changelog fragments\n',
  'fixed-seed-a-thing.md': 'A seeded thing no longer breaks.\n',
  'added-seed-a-feature.md': 'A seeded feature.\n',
};

/** A copy of the release machinery with a known changelog and fragment set.
    @param {string} name @returns {string} absolute path to the copy */
function seededRepo(name) {
  const dir = path.join(tmpDir(name), 'repo');
  for (const p of ['scripts', 'api/package.json', 'render.yaml']) {
    const dst = path.join(dir, p);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(path.join(ROOT, p), dst, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), SEED_CHANGELOG);
  fs.mkdirSync(path.join(dir, 'changelog.d'), { recursive: true });
  for (const [file, body] of Object.entries(SEED_FRAGMENTS)) {
    fs.writeFileSync(path.join(dir, 'changelog.d', file), body);
  }
  return dir;
}

const prep = (dir, version) => {
  try {
    execFileSync(process.execPath, ['scripts/release-prep.js', version], { cwd: dir, stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status;
  }
};

const fragmentsIn = dir => fs.readdirSync(path.join(dir, 'changelog.d')).sort();
const changelogIn = dir => fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');

test('a release that aborts keeps the fragments and the changelog', () => {
  const dir = seededRepo('relprep-abort');
  const before = fragmentsIn(dir);
  /* Older than the seeded release, which is checked after the fold used to run. */
  assert.equal(prep(dir, '1.0.0'), 1);
  assert.deepEqual(fragmentsIn(dir), before, 'the fragments were deleted');
  assert.equal(changelogIn(dir), SEED_CHANGELOG, 'the changelog was rewritten');
});

test('a release that succeeds still folds and deletes', () => {
  const dir = seededRepo('relprep-ok');
  const version = '99.0.0';
  assert.equal(prep(dir, version), 0);
  assert.deepEqual(fragmentsIn(dir), ['README.md'], 'the fragments were left behind');

  const after = changelogIn(dir);
  assert.match(after, new RegExp(`## \\[${version}\\]`));
  assert.match(after, /- A seeded thing no longer breaks\./, 'a fragment was not folded in');
  assert.match(after, /- A seeded feature\./, 'a fragment was not folded in');
});

test('nothing pending at all aborts without touching the fragments', () => {
  const dir = seededRepo('relprep-empty');
  /* The fold runs before the empty check, so a fragment on disk is itself
     something to release. Nothing is pending only when both are empty. */
  for (const file of Object.keys(SEED_FRAGMENTS)) {
    if (file !== 'README.md') fs.rmSync(path.join(dir, 'changelog.d', file));
  }
  const emptied = SEED_CHANGELOG.replace('### Added\n\n- A seeded entry, so the section is not empty.\n\n', '');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), emptied);

  assert.equal(prep(dir, '99.0.0'), 1);
  assert.deepEqual(fragmentsIn(dir), ['README.md'], 'the fragments were deleted');
  assert.equal(changelogIn(dir), emptied, 'the changelog was rewritten');
});
