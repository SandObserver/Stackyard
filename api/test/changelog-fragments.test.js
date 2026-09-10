const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { tmpDir } = require('../test-support/tmp');

const frag = require(path.join(__dirname, '..', '..', 'scripts', 'changelog-fragments.js'));
const cl = require(path.join(__dirname, '..', '..', 'scripts', 'changelog.js'));

const CHANGELOG = [
  ...cl.HEADER,
  '',
  '## [Unreleased]',
  '',
  '### Changed',
  '',
  '- An entry that was already here.',
  '',
  '## [1.0.0] - 2026-01-01',
  '',
  '### Added',
  '',
  '- The first release.',
  '',
  '[Unreleased]: https://github.com/SandObserver/stackyard/compare/v1.0.0...HEAD',
  '[1.0.0]: https://github.com/SandObserver/stackyard/releases/tag/v1.0.0',
  '',
].join('\n');

const of = (type, entry) => ({ file: `${type.toLowerCase()}-x.md`, type, entry });
const unreleased = markdown => {
  const doc = cl.parse(markdown);
  const u = cl.unreleased(doc);
  return u.sections.map(s => ({ type: s.type, entries: s.entries.map(e => e.text) }));
};

test('an entry joins the section it belongs to', () => {
  const out = frag.apply([of('Changed', 'A second entry.')], CHANGELOG);
  assert.deepEqual(unreleased(out), [
    { type: 'Changed', entries: ['An entry that was already here.', 'A second entry.'] },
  ]);
});

test('a section that does not exist yet is created', () => {
  const out = frag.apply([of('Fixed', 'A fix.')], CHANGELOG);
  assert.deepEqual(
    unreleased(out).map(s => s.type),
    ['Changed', 'Fixed'],
  );
});

/* Keep a Changelog fixes the order, and changelog-check fails on any other. */
test('new sections land in the order Keep a Changelog defines', () => {
  const out = frag.apply(
    [of('Security', 'A security fix.'), of('Added', 'A feature.'), of('Removed', 'A removal.')],
    CHANGELOG,
  );
  assert.deepEqual(
    unreleased(out).map(s => s.type),
    ['Added', 'Changed', 'Removed', 'Security'],
  );
});

test('the released sections below are left alone', () => {
  const out = frag.apply([of('Added', 'A feature.')], CHANGELOG);
  const released = cl.released(cl.parse(out));
  assert.equal(released.length, 1);
  assert.deepEqual(
    released[0].sections[0].entries.map(e => e.text),
    ['The first release.'],
  );
});

test('a long entry wraps, and its continuation is indented', () => {
  const long = 'A deliberately long entry that runs past the width the rest of the file keeps to, so it has to wrap.';
  const lines = frag.bullet(long).split('\n');
  assert.ok(lines.length > 1, 'did not wrap');
  assert.match(lines[0], /^- /);
  for (const l of lines.slice(1)) assert.match(l, /^ {2}\S/, `continuation not indented: ${l}`);
  for (const l of lines) assert.ok(l.length <= 80, `line over 80: ${l}`);
});

test('a second paragraph stays a separate line', () => {
  const lines = frag.bullet('The first line.\n\nDo this to migrate.').split('\n');
  assert.equal(lines[0], '- The first line.');
  assert.equal(lines.at(-1), '- Do this to migrate.');
});

/* The whole point of the folder: the result must still pass the gate. */
test('the folded file still parses as a valid changelog', () => {
  const out = frag.apply([of('Fixed', 'A fix.'), of('Added', 'A feature.')], CHANGELOG);
  const doc = cl.parse(out);
  assert.equal(doc.versions[0].name, 'Unreleased');
  assert.deepEqual(
    doc.links.map(l => l.name),
    ['Unreleased', '1.0.0'],
  );
  const order = unreleased(out).map(s => cl.TYPES.indexOf(s.type));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
});

/* Release, dependency and tooling pull requests add no fragment, so an empty
   folder must be a pass, not a missing-entry failure. */
test('a folder holding only its README yields nothing and no error', () => {
  const dir = tmpDir('frag');
  fs.writeFileSync(path.join(dir, 'README.md'), '# not a fragment');
  assert.deepEqual(frag.read(dir), { fragments: [], errors: [] });
});

test('a missing folder is not an error either', () => {
  const dir = path.join(tmpDir('frag'), 'never-created');
  assert.deepEqual(frag.read(dir), { fragments: [], errors: [] });
});

test('a well-named fragment is read with its section and text', () => {
  const dir = tmpDir('frag');
  fs.writeFileSync(path.join(dir, 'fixed-262-a-thing.md'), 'A thing no longer breaks.\n');
  assert.deepEqual(frag.read(dir), {
    fragments: [{ file: 'fixed-262-a-thing.md', type: 'Fixed', entry: 'A thing no longer breaks.' }],
    errors: [],
  });
});

test('each malformed fragment is named, and one does not hide another', () => {
  const dir = tmpDir('frag');
  fs.writeFileSync(path.join(dir, 'nosuch-thing.md'), 'x');
  fs.writeFileSync(path.join(dir, 'fixed-bullet.md'), '- already a bullet');
  fs.writeFileSync(path.join(dir, 'added-empty.md'), '   ');
  fs.writeFileSync(path.join(dir, 'Fixed-Caps.md'), 'x');
  const { fragments, errors } = frag.read(dir);
  assert.deepEqual(fragments, []);
  assert.equal(errors.length, 4);
  assert.match(errors.join('\n'), /nosuch-thing\.md: "nosuch" is not one of/);
  assert.match(errors.join('\n'), /fixed-bullet\.md: holds the entry text only/);
  assert.match(errors.join('\n'), /added-empty\.md: is empty/);
  assert.match(errors.join('\n'), /Fixed-Caps\.md: name must be/);
});
