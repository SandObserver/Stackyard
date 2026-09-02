/* The parser exists because the two source formats are YAML and a dependency
   is not available. What matters is not how much YAML it reads but that it
   never reads something as the wrong value: an item that imports with the wrong
   URL is silent, and a refused file is not.

   So the refusals are tested as carefully as the parses. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);

const { parseYaml, parseYamlTolerant, YamlLiteError } = await import('/js/yaml-lite.js');

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
  ['an alias to an anchor that is not there', 'a: *defaults\n', 'alias'],
  ['an anchor written on a key', '&defaults key: 1\n', 'anchor on a key'],
  ['a merge key that does not name a mapping', 'a: &n 1\nb:\n  <<: *n\n', 'merge key needs a mapping'],
  ['tab indentation', 'a:\n\tb: 1\n', 'tab indentation'],
  ['a second document', 'a: 1\n---\nb: 2\n', 'multi-document'],
  ['an unterminated flow collection', 'a: [1, 2\n', 'unterminated flow'],
  ['text after a flow collection', 'a: [1, 2] junk\n', 'trailing text'],
  ['a flow mapping keyed by a collection', 'a: { [1]: 2 }\n', 'not text'],
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
    parseYaml('a: 1\nb: 2\nc: *nope\n');
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

/* Every one of these came from a config someone actually keeps, Dashy's own
   default among them, which writes its navLinks level with the key rather than
   indented under it. */

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

/* Homepage's own documentation writes widget fields this way. */
test('brackets with contents read as the collection they are', () => {
  assert.deepEqual(plain(parseYaml('fields: ["wanted", "queued"]\n')), { fields: ['wanted', 'queued'] });
  assert.deepEqual(plain(parseYaml('tags: [a, b]\n')), { tags: ['a', 'b'] });
  assert.deepEqual(plain(parseYaml('opts: { a: 1 }\n')), { opts: { a: 1 } });
  assert.deepEqual(plain(parseYaml('a: [ 1 , 2 , ]\n')), { a: [1, 2] });
  assert.deepEqual(plain(parseYaml('a: [[1, 2], {b: [3]}]\n')), { a: [[1, 2], { b: [3] }] });
  assert.deepEqual(plain(parseYaml('a: {b: null, c: true, d: 1.5}\n')), { a: { b: null, c: true, d: 1.5 } });
  assert.deepEqual(plain(parseYaml('a: [x] # note\n')), { a: ['x'] });
});

/* A colon ends a flow key only with a space or a bracket after it, the same
   rule the block form uses, or a URL loses its port. */
test('a URL inside a flow collection keeps its port', () => {
  assert.deepEqual(plain(parseYaml('a: [http://host:8080/x]\n')), { a: ['http://host:8080/x'] });
  assert.deepEqual(plain(parseYaml('a: {url: http://host:8080}\n')), { a: { url: 'http://host:8080' } });
});

test('a flow mapping key with no value is null, not a missing key', () => {
  assert.deepEqual(plain(parseYaml('a: {b: , c: 1}\n')), { a: { b: null, c: 1 } });
});

test('a flow collection is null-prototyped too', () => {
  assert.equal(Object.getPrototypeOf(parseYaml('a: {constructor: mine}\n').a), null);
});

/* A flow collection written as a list element must not reach the key matcher
   first. The brace and the first key build a mapping that was never in the
   file. */
test('a flow collection reads in a list too, not only after a key', () => {
  assert.deepEqual(plain(parseYaml('sections:\n  - {name: Apps, items: []}\n')), {
    sections: [{ name: 'Apps', items: [] }],
  });
  assert.deepEqual(plain(parseYaml('sections:\n  - [a, b]\n')), { sections: [['a', 'b']] });
  assert.deepEqual(plain(parseYaml('sections:\n  - {}\n  - []\n')), { sections: [{}, []] });
});

/* Homepage replaces these in the raw text before it parses the file, so the
   braces are never YAML to it. Reading them as a flow mapping refuses a file
   whose only fault is keeping a secret out of the config. */
test('an environment placeholder is text, not a flow mapping', () => {
  assert.equal(parseYaml('href: {{HOMEPAGE_VAR_URL}}\n').href, '{{HOMEPAGE_VAR_URL}}');
  assert.equal(parseYaml('key: {{HOMEPAGE_FILE_TOKEN}} # secret\n').key, '{{HOMEPAGE_FILE_TOKEN}}');
  assert.equal(parseYaml('href: "{{HOMEPAGE_VAR_URL}}"\n').href, '{{HOMEPAGE_VAR_URL}}');
  assert.equal(parseYaml('href: ${DASHY_URL}\n').href, '${DASHY_URL}');
});

/* A comment after a quoted value is ordinary YAML, and the closing quote no
   longer has to be the end of the line. */
test('a quoted value may carry a trailing comment', () => {
  assert.equal(parseYaml('a: "x" # note\n').a, 'x');
  assert.equal(parseYaml("a: 'x' # note\n").a, 'x');
  assert.equal(parseYaml('a: "x # not a comment"\n').a, 'x # not a comment');
});

test('a list inside a list line refuses rather than reading as text', () => {
  assert.throws(() => parseYaml('a:\n  - - x\n'), /sequence inside a sequence/);
});

/* "*arr" is what a homelab calls the Sonarr and Radarr stack, and description
   is an ordinary Homepage field. Neither is an alias. */
test('& and * inside a value are text, not an anchor', () => {
  assert.equal(parseYaml('description: The *arr stack\n').description, 'The *arr stack');
  assert.equal(parseYaml('description: Movies &TV\n').description, 'Movies &TV');
  assert.equal(parseYaml('cron: "*/5 * * * *"\n').cron, '*/5 * * * *');
  assert.equal(parseYaml('- name: Plex **HD**\n')[0].name, 'Plex **HD**');
});

/* Dashy's own documentation recommends anchors. An anchor on a plain value is
   the common shape, and its value is the same with or without the anchor. */
test('an anchor on a value keeps the value, and its alias resolves', () => {
  assert.equal(parseYaml('server: &local my-docker\n').server, 'my-docker');
  assert.deepEqual(plain(parseYaml('a: &n 1\nb: *n\n')), { a: 1, b: 1 });
  assert.deepEqual(plain(parseYaml('a:\n  - &ref x\n  - *ref\n')), { a: ['x', 'x'] });
});

/* Dashy's editor writes every item as an anchor on the dash line with the item
   indented under it, then repeats the item by alias on its other pages. A whole
   config written by the Dashy UI is this shape throughout. */
test('an anchor on a block is reusable by alias', () => {
  assert.deepEqual(plain(parseYaml('base: &d\n  icon: x\napp:\n  <<: *d\n  href: http://a\n')), {
    base: { icon: 'x' },
    app: { icon: 'x', href: 'http://a' },
  });
  assert.deepEqual(plain(parseYaml('a:\n  - &r\n    t: A\n  - *r\n')), { a: [{ t: 'A' }, { t: 'A' }] });
});

/* A key already written wins over the one merged in, which is what a merge
   means. Reversing it would silently rewrite a service's URL. */
test('a merge key never overwrites a key the mapping already has', () => {
  assert.deepEqual(plain(parseYaml('d: &d\n  url: http://old\n  icon: x\na:\n  <<: *d\n  url: http://new\n')).a, {
    url: 'http://new',
    icon: 'x',
  });
});

test('a merge key takes a list of anchors as well as one', () => {
  assert.deepEqual(plain(parseYaml('p: &p\n  a: 1\nq: &q\n  b: 2\nr:\n  <<: [*p, *q]\n')).r, { a: 1, b: 2 });
});

/* Hand-aligned configs pad the dash, so the continuation keys sit one column
   further in. The offset is read, not assumed. */
test('a list element keeps its own key column, however the dash is padded', () => {
  const one = plain(parseYaml('sections:\n  - name: Apps\n    icon: box\n'));
  assert.deepEqual(plain(parseYaml('sections:\n  -  name: Apps\n     icon: box\n')), one);
  assert.deepEqual(plain(parseYaml('sections:\n  -   name: Apps\n      icon: box\n')), one);
});

test('a double-quoted key decodes its escapes the way a value does', () => {
  assert.deepEqual(Object.keys(parseYaml('"a\\nb": 1\n')), ['a\nb']);
});

/* Every trailing newline, which is the whole difference between "keep" and the
   default. Blank lines are not stripped before the fold. */
test('the keep indicator keeps more than one trailing newline', () => {
  assert.equal(parseYaml('a: |+\n  x\n\n\nb: 1\n').a, 'x\n\n\n');
  assert.equal(parseYaml('a: |+\n').a, '');
  assert.equal(parseYaml('a: |\n  x\n\n\nb: 1\n').a, 'x\n');
  assert.equal(parseYaml('a: |-\n  x\n\n\nb: 1\n').a, 'x');
});

/* Refusing a whole file over one line protects nothing: the importer discards
   most of what a config holds. Tolerant mode drops the node the problem is in
   and says which line it was. */

test('tolerant mode keeps the rest of the file and reports what it dropped', () => {
  const { doc, errors } = parseYamlTolerant('a: 1\nb: *nope\nc: 3\n');
  assert.deepEqual(plain(doc), { a: 1, c: 3 });
  assert.deepEqual(errors, [{ line: 2, reason: 'an alias to a block anchor is not supported' }]);
});

/* The unreadable key is the only thing lost. Its siblings, the service holding
   it and every other service in the file are all still there. */
test('a dropped key costs that key and nothing around it', () => {
  const { doc, errors } = parseYamlTolerant(`- Media:
    - Plex:
        href: http://plex:32400
        widget:
          fields: [broken
          type: plex
    - Sonarr:
        href: http://sonarr:8989
`);
  assert.deepEqual(plain(doc), [
    {
      Media: [
        { Plex: { href: 'http://plex:32400', widget: { type: 'plex' } } },
        { Sonarr: { href: 'http://sonarr:8989' } },
      ],
    },
  ]);
  assert.deepEqual(errors, [{ line: 5, reason: 'unterminated flow collection' }]);
});

/* A key whose value is a block loses the block with it, or the orphaned lines
   below read as keys of the parent. */
test('a dropped key takes the block underneath it', () => {
  const { doc, errors } = parseYamlTolerant('a:\n  &anchored key: 1\n    icon: x\n  href: http://a\n');
  assert.deepEqual(plain(doc), { a: { href: 'http://a' } });
  assert.equal(errors.length, 1);
});

test('a dropped list element costs that element only', () => {
  const { doc, errors } = parseYamlTolerant('a:\n  - &ok x\n  - *missing\n  - z\n');
  assert.deepEqual(plain(doc), { a: ['x', 'z'] });
  assert.equal(errors.length, 1);
});

test('tolerant mode still throws when the whole file cannot be scanned', () => {
  assert.throws(() => parseYamlTolerant('a:\n\tb: 1\n'), /tab indentation/);
});

test('a clean file reports no errors and parses identically either way', () => {
  const text = '- Media:\n    - Plex:\n        href: http://plex:32400\n';
  const { doc, errors } = parseYamlTolerant(text);
  assert.deepEqual(errors, []);
  assert.deepEqual(plain(doc), plain(parseYaml(text)));
});
