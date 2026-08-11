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
  ['flow mappings', 'a: { b: 1 }\n', 'flow collections'],
  ['flow sequences', 'a: [1, 2]\n', 'flow collections'],
  ['block scalars', 'a: |\n  line one\n', 'block scalars'],
  ['folded scalars', 'a: >\n  line one\n', 'block scalars'],
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
