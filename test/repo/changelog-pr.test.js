const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const pr = require(path.join(__dirname, '..', '..', 'scripts', 'changelog-pr.js'));
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

const body = changelog =>
  [
    '**Summary**',
    '- A change.',
    '',
    '**Changelog**',
    ...changelog,
    '',
    '**Testing**',
    'All green.',
    '',
    '**Checklist**',
    '- [x] Done.',
  ].join('\n');

const unreleased = markdown =>
  cl.unreleased(cl.parse(markdown)).sections.map(s => ({ type: s.type, entries: s.entries.map(e => e.text) }));

test('entries under several sections are read in order', () => {
  const { entries, errors } = pr.parse(
    body(['', '### Fixed', '- A fix.', '- Another fix.', '', '### Changed', '- A change.']),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(entries, [
    { type: 'Fixed', entry: 'A fix.' },
    { type: 'Fixed', entry: 'Another fix.' },
    { type: 'Changed', entry: 'A change.' },
  ]);
});

/* Summary and Checklist bullets sit outside the section and are not entries. */
test('bullets in the other template sections are ignored', () => {
  const { entries } = pr.parse(body(['### Fixed', '- A fix.']));
  assert.deepEqual(
    entries.map(e => e.entry),
    ['A fix.'],
  );
});

test('a description with no Changelog section yields nothing and no error', () => {
  assert.deepEqual(pr.parse('**Summary**\n- A change.\n\n**Testing**\nAll green.'), { entries: [], errors: [] });
  assert.deepEqual(pr.parse(''), { entries: [], errors: [] });
  assert.deepEqual(pr.parse(null), { entries: [], errors: [] });
});

test('an empty section, "None" and the template comment yield nothing', () => {
  for (const lines of [[], ['None'], ['_None._'], ['<!-- ### Fixed', '- An example. -->'], ['### Fixed', '-']]) {
    assert.deepEqual(pr.parse(body(lines)), { entries: [], errors: [] }, JSON.stringify(lines));
  }
});

test('no comment marker survives, nested or unclosed', () => {
  const nested = pr.parse(body(['<!-<!-- x -->- hidden -->', '### Fixed', '- A fix.']));
  assert.deepEqual(nested, { entries: [{ type: 'Fixed', entry: 'A fix.' }], errors: [] });
  const unclosed = pr.parse(body(['### Fixed', '- A fix.', '<!-- ### Added', '- Not an entry.']));
  assert.deepEqual(unclosed.entries, [{ type: 'Fixed', entry: 'A fix.' }]);
});

/* GitHub stores descriptions typed in the browser with CRLF line endings. */
test('CRLF line endings read the same as LF', () => {
  const crlf = body(['### Fixed', '- A fix.']).replace(/\n/g, '\r\n');
  assert.deepEqual(pr.parse(crlf).entries, [{ type: 'Fixed', entry: 'A fix.' }]);
});

test('a heading form of the section title is accepted', () => {
  for (const title of ['## Changelog', '# Changelog', '**Changelog:**', '**changelog**']) {
    const text = `${title}\n### Fixed\n- A fix.\n\n## Testing\nAll green.`;
    assert.deepEqual(pr.parse(text).entries, [{ type: 'Fixed', entry: 'A fix.' }], title);
  }
});

test('an entry wrapped over indented lines is one entry', () => {
  const { entries } = pr.parse(body(['### Fixed', '- A fix that is long', '  enough to wrap.']));
  assert.deepEqual(entries, [{ type: 'Fixed', entry: 'A fix that is long enough to wrap.' }]);
});

test('section names are matched without regard to case', () => {
  assert.deepEqual(pr.parse(body(['### fixed', '- A fix.'])).entries, [{ type: 'Fixed', entry: 'A fix.' }]);
});

test('each malformed line is named', () => {
  assert.match(pr.parse(body(['### Bugfixes', '- A fix.'])).errors.join(), /"Bugfixes" is not one of/);
  assert.match(pr.parse(body(['- A fix.'])).errors.join(), /has no ### section heading/);
  assert.match(pr.parse(body(['### Fixed', 'A fix without a bullet.'])).errors.join(), /is not a "- " entry/);
});

test('an entry joins the section it belongs to', () => {
  const out = pr.apply([{ type: 'Changed', entry: 'A second entry.' }], CHANGELOG);
  assert.deepEqual(unreleased(out), [
    { type: 'Changed', entries: ['An entry that was already here.', 'A second entry.'] },
  ]);
});

/* Keep a Changelog fixes the order, and changelog-check fails on any other. */
test('new sections land in the order Keep a Changelog defines', () => {
  const out = pr.apply(
    [
      { type: 'Security', entry: 'A security fix.' },
      { type: 'Added', entry: 'A feature.' },
      { type: 'Removed', entry: 'A removal.' },
    ],
    CHANGELOG,
  );
  assert.deepEqual(
    unreleased(out).map(s => s.type),
    ['Added', 'Changed', 'Removed', 'Security'],
  );
});

test('the released sections below are left alone', () => {
  const out = pr.apply([{ type: 'Added', entry: 'A feature.' }], CHANGELOG);
  assert.deepEqual(
    cl.released(cl.parse(out))[0].sections[0].entries.map(e => e.text),
    ['The first release.'],
  );
});

/* A re-run workflow must not add the same entries twice. */
test('applying the same entries twice changes nothing the second time', () => {
  const entries = [
    { type: 'Fixed', entry: 'A fix.' },
    { type: 'Changed', entry: 'An entry that was already here.' },
  ];
  const once = pr.apply(entries, CHANGELOG);
  assert.equal(pr.apply(entries, once), once);
  assert.deepEqual(unreleased(once), [
    { type: 'Changed', entries: ['An entry that was already here.'] },
    { type: 'Fixed', entries: ['A fix.'] },
  ]);
});

test('a long entry wraps, and its continuation is indented', () => {
  const long = 'A deliberately long entry that runs past the width the rest of the file keeps to, so it has to wrap.';
  const lines = pr.bullet(long).split('\n');
  assert.ok(lines.length > 1, 'did not wrap');
  for (const l of lines.slice(1)) assert.match(l, /^ {2}\S/, `continuation not indented: ${l}`);
  for (const l of lines) assert.ok(l.length <= 80, `line over 80: ${l}`);
  const out = pr.apply([{ type: 'Fixed', entry: long }], CHANGELOG);
  assert.equal(pr.apply([{ type: 'Fixed', entry: long }], out), out, 'a wrapped entry was added twice');
});

test('the result still parses as a valid changelog', () => {
  const out = pr.apply(
    [
      { type: 'Fixed', entry: 'A fix.' },
      { type: 'Added', entry: 'A feature.' },
    ],
    CHANGELOG,
  );
  const doc = cl.parse(out);
  assert.equal(doc.versions[0].name, 'Unreleased');
  assert.deepEqual(
    doc.links.map(l => l.name),
    ['Unreleased', '1.0.0'],
  );
});
