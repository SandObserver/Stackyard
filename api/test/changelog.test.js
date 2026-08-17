const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmpDir } = require('../test-support/tmp.js');

/* The changelog is the release record and the source of the release notes. A
   malformed one publishes a release describing the wrong version, or none. */

const ROOT = path.join(__dirname, '..', '..');
const cl = require(path.join(ROOT, 'scripts', 'changelog.js'));
const { dateTheSection } = require(path.join(ROOT, 'scripts', 'release-prep.js'));
const { notesFor } = require(path.join(ROOT, 'scripts', 'release-notes.js'));

const HEADER = `${cl.HEADER.join('\n')}\n`;

const sample = `${HEADER}
## [Unreleased]

### Added

- Widget for the doorbell.

## [1.1.0] - 2026-02-02

### Added

- Folders on the dashboard.

## [1.0.0] - 2026-01-01

### Added

- First release.

[Unreleased]: https://github.com/SandObserver/stackyard/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/SandObserver/stackyard/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/SandObserver/stackyard/releases/tag/v1.0.0
`;

const check = args => {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'changelog-check.js'), ...args], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    return 0;
  } catch (e) {
    return e.status;
  }
};

test('the parser separates versions, sections and links', () => {
  const doc = cl.parse(sample);
  assert.deepEqual(
    doc.versions.map(v => v.name),
    ['Unreleased', '1.1.0', '1.0.0'],
  );
  assert.equal(cl.unreleased(doc).sections[0].entries[0].text, 'Widget for the doorbell.');
  assert.equal(cl.released(doc)[0].date, '2026-02-02');
  assert.equal(doc.links.length, 3);
});

test('a wrapped entry is read as one entry', () => {
  const doc = cl.parse(`${HEADER}
## [Unreleased]

### Fixed

- A long line that continues
  onto a second line.

[Unreleased]: https://github.com/SandObserver/stackyard/compare/v1.0.0...HEAD
`);
  const entries = cl.unreleased(doc).sections[0].entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, 'A long line that continues onto a second line.');
});

test('a date that is not a real day is rejected', () => {
  assert.ok(cl.validDate('2026-02-28'));
  assert.ok(!cl.validDate('2026-02-30'));
  assert.ok(!cl.validDate('26-02-01'));
  assert.ok(!cl.validDate(null));
});

test('the implied bump follows the sections present', () => {
  const bump = types => cl.impliedBump({ sections: types.map(t => ({ type: t })) });
  assert.equal(bump(['Removed']), 'major');
  assert.equal(bump(['Added', 'Fixed']), 'minor');
  assert.equal(bump(['Fixed', 'Security']), 'patch');
  assert.equal(cl.actualBump('1.6.1', '1.7.0'), 'minor');
  assert.equal(cl.actualBump('1.6.1', '1.6.2'), 'patch');
  assert.equal(cl.actualBump('1.6.1', '2.0.0'), 'major');
});

test('compare links accept either capitalisation of the repository path', () => {
  assert.ok(cl.linkMatches('https://github.com/SandObserver/stackyard/compare/v1.0.0...HEAD', 'compare/v1.0.0...HEAD'));
  assert.ok(cl.linkMatches('https://github.com/SandObserver/Stackyard/compare/v1.0.0...HEAD', 'compare/v1.0.0...HEAD'));
  assert.ok(!cl.linkMatches('https://example.com/compare/v1.0.0...HEAD', 'compare/v1.0.0...HEAD'));
});

test('the committed changelog passes the gate', () => {
  assert.equal(check([]), 0);
});

test('the gate agrees with the released version, and rejects any other', () => {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'api', 'package.json'), 'utf8')).version;
  assert.equal(check(['--release', version]), 0);
  assert.equal(check(['--release', '99.0.0']), 1);
});

/* Each mutation is one rule. A gate that has never been seen to fail is a
   guess. */
test('the gate rejects a broken structure', () => {
  const dir = tmpDir('changelog');
  const cases = {
    'paraphrased header': sample.replace('are documented in this file', 'will be documented in this file'),
    'missing date': sample.replace('## [1.1.0] - 2026-02-02', '## [1.1.0]'),
    'impossible date': sample.replace('2026-02-02', '2026-02-30'),
    'versions out of order': sample.replace('## [1.1.0] - 2026-02-02', '## [0.9.0] - 2026-02-02'),
    'invented section': sample.replace('### Added\n\n- Folders', '### Tweaked\n\n- Folders'),
    'empty section': sample.replace('### Added\n\n- Folders on the dashboard.', '### Added'),
    'wrong compare link': sample.replace('compare/v1.0.0...v1.1.0', 'compare/v0.9.0...v1.1.0'),
    'missing link definition': sample.replace(/^\[1\.1\.0\]:.*$/m, ''),
    'first release not linked to its tag': sample.replace('releases/tag/v1.0.0', 'compare/v0.9.0...v1.0.0'),
  };
  for (const [name, markdown] of Object.entries(cases)) {
    const file = path.join(dir, `${name.replace(/\s+/g, '-')}.md`);
    fs.writeFileSync(file, markdown, 'utf8');
    assert.equal(check(['--file', file]), 1, `${name} should fail the gate`);
  }
  fs.writeFileSync(path.join(dir, 'good.md'), sample, 'utf8');
  assert.equal(check(['--file', path.join(dir, 'good.md')]), 0, 'the sample itself must pass');
});

test('style problems warn without failing', () => {
  const file = path.join(tmpDir('changelog'), 'style.md');
  fs.writeFileSync(
    file,
    sample.replace('- Widget for the doorbell.', '- Added a widget you can use, because we wanted it.'),
    'utf8',
  );
  assert.equal(check(['--file', file]), 0, 'style is advisory');
});

test('release prep dates the section and writes both links', () => {
  const { markdown, previous } = dateTheSection(sample, '1.2.0', '2026-03-03');
  assert.equal(previous, '1.1.0');
  assert.match(markdown, /## \[Unreleased\]\n\n## \[1\.2\.0\] - 2026-03-03\n/);
  assert.match(markdown, /\[Unreleased\]: https:\/\/github\.com\/SandObserver\/stackyard\/compare\/v1\.2\.0\.\.\.HEAD/);
  assert.match(
    markdown,
    /\[1\.2\.0\]: https:\/\/github\.com\/SandObserver\/stackyard\/compare\/v1\.1\.0\.\.\.v1\.2\.0/,
  );
});

test('the prepared changelog still parses as one release ahead', () => {
  const { markdown } = dateTheSection(sample, '1.2.0', '2026-03-03');
  const doc = cl.parse(markdown);
  assert.equal(cl.unreleased(doc).sections.length, 0);
  assert.equal(cl.released(doc)[0].name, '1.2.0');
  assert.equal(cl.released(doc)[0].sections[0].entries[0].text, 'Widget for the doorbell.');
});

test('release notes are the section body without the link definitions', () => {
  const notes = notesFor(sample, '1.1.0');
  assert.match(notes, /### Added/);
  assert.match(notes, /Folders on the dashboard\./);
  assert.doesNotMatch(notes, /compare\//);
  assert.doesNotMatch(notes, /First release/);
  assert.equal(notesFor(sample, 'v1.1.0'), notes);
  assert.equal(notesFor(sample, '9.9.9'), null);
});
