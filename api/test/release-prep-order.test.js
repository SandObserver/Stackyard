const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpDir } = require('../test-support/tmp');

const ROOT = path.join(__dirname, '..', '..');

/* The repository's own changelog is not an input here. Release prep empties
   [Unreleased], so on a release branch the real file gives prep nothing to
   release and every case below becomes the same abort. */
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

/** A copy of the release machinery with a known changelog.
    @param {string} name @returns {string} absolute path to the copy */
function seededRepo(name) {
  const dir = path.join(tmpDir(name), 'repo');
  for (const p of ['scripts', 'api/package.json', 'render.yaml']) {
    const dst = path.join(dir, p);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.cpSync(path.join(ROOT, p), dst, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), SEED_CHANGELOG);
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

const changelogIn = dir => fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');

test('a release that aborts leaves the changelog alone', () => {
  const dir = seededRepo('relprep-abort');
  assert.equal(prep(dir, '1.0.0'), 1);
  assert.equal(changelogIn(dir), SEED_CHANGELOG, 'the changelog was rewritten');
});

test('a release that succeeds dates the pending entries', () => {
  const dir = seededRepo('relprep-ok');
  const version = '99.0.0';
  assert.equal(prep(dir, version), 0);
  const after = changelogIn(dir);
  assert.match(after, /## \[Unreleased\]\n\n## \[99\.0\.0\] - \d{4}-\d{2}-\d{2}\n\n### Added\n\n- A seeded entry/);
});

test('nothing pending aborts without touching the changelog', () => {
  const dir = seededRepo('relprep-empty');
  const emptied = SEED_CHANGELOG.replace('### Added\n\n- A seeded entry, so the section is not empty.\n\n', '');
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), emptied);
  assert.equal(prep(dir, '99.0.0'), 1);
  assert.equal(changelogIn(dir), emptied, 'the changelog was rewritten');
});
