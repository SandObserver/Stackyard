const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { newestRelease, toChangesText, writeChanges } = require('../../scripts/ca-changes');

/* What the app store shows as "what changed" on a release. Taking the wrong
   section publishes notes for work that has not shipped. */

const SAMPLE = `# Changelog

## [Unreleased]

### Added

- Something not shipped yet.

## [1.6.1] - 2026-08-14

### Fixed

- A real fix.

## [1.6.0] - 2026-08-13

### Added

- An older feature.

[Unreleased]: https://example.com/compare/v1.6.1...HEAD
`;

test('the unreleased section is never used', () => {
  const r = newestRelease(SAMPLE);
  assert.equal(r.version, '1.6.1');
  assert.equal(r.date, '2026-08-14');
  assert.match(r.body, /A real fix/);
  assert.doesNotMatch(r.body, /not shipped yet/);
});

test('the section stops at the next version', () => {
  assert.doesNotMatch(newestRelease(SAMPLE).body, /An older feature/);
});

test('a changelog with no dated section yields null', () => {
  assert.equal(newestRelease('# Changelog\n\n## [Unreleased]\n\n- pending\n'), null);
});

test('compare-link definitions are dropped', () => {
  const text = toChangesText(newestRelease(SAMPLE));
  assert.doesNotMatch(text, /https:\/\/example\.com\/compare/);
  assert.match(text, /### 1\.6\.1 - 2026-08-14/);
});

test('xml metacharacters are escaped', () => {
  const out = writeChanges('<Container><Changes>old</Changes></Container>', 'a & b <tag>');
  assert.match(out, /a &amp; b &lt;tag&gt;/);
  assert.doesNotMatch(out, /<tag>/);
});

test('a template with no Changes element is refused', () => {
  assert.throws(() => writeChanges('<Container></Container>', 'x'), /no <Changes> element/);
});

test('the real changelog and template agree with the script', () => {
  const root = path.join(__dirname, '..', '..');
  const release = newestRelease(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
  assert.ok(release, 'CHANGELOG.md must have a dated version section');
  const xml = fs.readFileSync(path.join(root, 'templates', 'stackyard.xml'), 'utf8');
  assert.doesNotThrow(() => writeChanges(xml, toChangesText(release)));
});
