/* The parser exists because the two source formats are YAML and a dependency
   is not available. What matters is not how much YAML it reads but that it
   never reads something as the wrong value: an item that imports with the wrong
   URL is silent, and a refused file is not.

   So the refusals are tested as carefully as the parses. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const { parseYaml, YamlLiteError } = await import('/js/yaml-lite.js');

const plain = v => JSON.parse(JSON.stringify(v));

test('reads a Homepage services file, nested group included', () => {
  const doc = parseYaml(`---
# My services
- Media:
    - Plex:
        href: http://plex:32400
        icon: plex.png
        siteMonitor: http://plex:32400/web
    - Downloads:
        - Sonarr:
            href: http://sonarr:8989
            ping: sonarr.lan
- Tools:
    - Uptime:
        href: 'http://up:3001'
`);
  assert.deepEqual(plain(doc), [
    {
      Media: [
        { Plex: { href: 'http://plex:32400', icon: 'plex.png', siteMonitor: 'http://plex:32400/web' } },
        { Downloads: [{ Sonarr: { href: 'http://sonarr:8989', ping: 'sonarr.lan' } }] },
      ],
    },
    { Tools: [{ Uptime: { href: 'http://up:3001' } }] },
  ]);
});

test('reads the extra list level a bookmarks file has', () => {
  const doc = parseYaml(`- Developer:
    - Github:
        - abbr: GH
          href: https://github.com/
          icon: github
`);
  assert.deepEqual(plain(doc), [
    { Developer: [{ Github: [{ abbr: 'GH', href: 'https://github.com/', icon: 'github' }] }] },
  ]);
});

test('keeps a port and a fragment out of the key split', () => {
  const doc = parseYaml('url: http://host:8080/path#top\n');
  assert.equal(doc.url, 'http://host:8080/path#top');
});

test('reads booleans, numbers, null and quoted scalars', () => {
  const doc = parseYaml(`a: true
b: false
c: 42
d: 3.5
e: ~
f: "quoted: value"
g: 'it''s here'
h: yes
`);
  assert.deepEqual(plain(doc), {
    a: true,
    b: false,
    c: 42,
    d: 3.5,
    e: null,
    f: 'quoted: value',
    g: "it's here",
    h: true,
  });
});

test('strips a trailing comment but not a colour or a fragment', () => {
  assert.equal(parseYaml('a: value # trailing\n').a, 'value');
  assert.equal(parseYaml('a: "#00ff00"\n').a, '#00ff00');
  assert.equal(parseYaml('a: http://h/#frag\n').a, 'http://h/#frag');
});

test('objects have a null prototype, so a config key cannot answer as an inherited member', () => {
  const doc = parseYaml('constructor: mine\ntoString: also mine\n');
  assert.equal(Object.getPrototypeOf(doc), null);
  assert.equal(doc.constructor, 'mine');
  assert.equal(doc.toString, 'also mine');
});

/* Each of these is a construct the parser could guess at. Guessing produces an
   item that looks imported and points somewhere else. */
for (const [name, text, reason] of [
  ['anchors', 'base: &defaults\n  icon: x\napp:\n  href: http://a\n', 'anchors'],
  ['aliases', 'a: *defaults\n', 'anchors'],
  ['merge keys', 'a:\n  <<: *defaults\n', 'merge keys'],
  ['flow mappings with contents', 'a: { b: 1 }\n', 'flow collections'],
  ['flow sequences with contents', 'a: [1, 2]\n', 'flow collections'],
  ['tab indentation', 'a:\n\tb: 1\n', 'tab indentation'],
  ['a second document', 'a: 1\n---\nb: 2\n', 'multi-document'],
]) {
  test(`refuses ${name} rather than guessing`, () => {
    assert.throws(
      () => parseYaml(text),
      err => {
        assert.ok(err instanceof YamlLiteError, `expected YamlLiteError, got ${err.name}`);
        assert.match(err.reason, new RegExp(reason));
        assert.ok(Number.isInteger(err.line) && err.line > 0, 'error carries a line number');
        return true;
      },
    );
  });
}

test('reports the line the problem is on', () => {
  try {
    parseYaml('a: 1\nb: 2\nc: [3]\n');
    assert.fail('should have thrown');
  } catch (err) {
    assert.equal(err.line, 3);
  }
});

test('a single leading document marker is fine', () => {
  assert.deepEqual(plain(parseYaml('---\na: 1\n')), { a: 1 });
});

test('an empty or comment-only file parses to nothing', () => {
  assert.equal(parseYaml(''), null);
  assert.equal(parseYaml('# just a note\n\n'), null);
});

/* ── layouts real files use ───────────────────────────────────────────────── */

/* Every one of these came from a config someone actually keeps. Each used to
   refuse the whole file, including Dashy's own default config, which writes its
   navLinks level with the key rather than indented under it. */

test('a sequence written level with its key belongs to that key', () => {
  assert.deepEqual(plain(parseYaml('pageInfo:\n  navLinks:\n  - title: A\n    path: http://a\n')), {
    pageInfo: { navLinks: [{ title: 'A', path: 'http://a' }] },
  });
});

test('a sequence indented under its key means the same thing', () => {
  const flush = parseYaml('a:\n  b:\n  - x: 1\n');
  const nested = parseYaml('a:\n  b:\n    - x: 1\n');
  assert.deepEqual(plain(flush), plain(nested));
});

test("a mapping level with a key is the next key, not that key's value", () => {
  assert.deepEqual(plain(parseYaml('a:\n  b:\n  c: 2\n')), { a: { b: null, c: 2 } });
});

test('a Homepage group nested by two spaces reads like one nested by four', () => {
  const two = parseYaml('- Group:\n  - Service:\n      href: http://a\n');
  const four = parseYaml('- Group:\n    - Service:\n        href: http://a\n');
  assert.deepEqual(plain(two), plain(four));
});

test('a folded value is joined into one line, which is how a long key is wrapped', () => {
  assert.equal(parseYaml('key: >-\n  abc\n  def\n').key, 'abc def');
  assert.equal(parseYaml('icon: >-\n  https://example.com/a.svg\n').icon, 'https://example.com/a.svg');
});

test('a literal value keeps its line breaks', () => {
  assert.equal(parseYaml('note: |\n  one\n  two\n').note, 'one\ntwo\n');
  assert.equal(parseYaml('note: |-\n  one\n  two\n').note, 'one\ntwo');
});

test('a folded value on the same line as a list dash is still read', () => {
  assert.deepEqual(plain(parseYaml('- items:\n  - key: >-\n      abc123\n')), [{ items: [{ key: 'abc123' }] }]);
});

/* The body of a block is text. A parser that kept reading it as structure would
   see a list item, a comment or a tab in there and either refuse a valid file or
   mis-read it. */
test('the body of a block is never read as structure', () => {
  assert.equal(
    parseYaml('note: |\n  - not a list item\n  # not a comment\n').note,
    '- not a list item\n# not a comment\n',
  );
  assert.equal(parseYaml('note: |\n  has\ta tab\n').note, 'has\ta tab\n');
  assert.deepEqual(plain(parseYaml('a: |\n  text\nb: 2\n')), { a: 'text\n', b: 2 });
});

test('an empty pair of brackets is a value, not a refusal', () => {
  assert.deepEqual(plain(parseYaml('sections: []\n')), { sections: [] });
  assert.deepEqual(plain(parseYaml('appConfig: {}\n')), { appConfig: {} });
});

test('brackets with contents still refuse, since that is where guessing starts', () => {
  assert.throws(() => parseYaml('tags: [a, b]\n'), /flow collections/);
  assert.throws(() => parseYaml('opts: { a: 1 }\n'), /flow collections/);
});
