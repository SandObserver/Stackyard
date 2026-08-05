const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseXml: _parseXml } = require('../src/parse-xml');
const { plain } = require('../test-support/plain');

/* parseXml builds null-prototype objects on purpose, because its keys are tag
   and attribute names from the feed. assert/strict compares prototypes, so
   every result is copied onto an ordinary one before it is compared and the
   expectations below stay readable object literals. */
const parseXml = xml => plain(_parseXml(xml));

/* ── parseXml: general nested shape, matching the JSON shape widgets already read ── */

test('parseXml maps root attributes with lossless numeric coercion', () => {
  assert.deepEqual(parseXml('<MediaContainer size="3" title="Library"/>'),
    { MediaContainer: { size: 3, title: 'Library' } });
});

test('parseXml nests elements and turns repeated tags into arrays', () => {
  const xml = '<MediaContainer size="2">'
    + '<Metadata title="The Matrix" duration="8160000"><Player state="playing"/></Metadata>'
    + '<Metadata title="Ep1" type="episode"><Player state="paused"/></Metadata>'
    + '</MediaContainer>';
  const p = parseXml(xml);
  assert.equal(p.MediaContainer.size, 2);
  assert.ok(Array.isArray(p.MediaContainer.Metadata));
  assert.equal(p.MediaContainer.Metadata[0].title, 'The Matrix');
  assert.equal(p.MediaContainer.Metadata[0].duration, 8160000);
  assert.equal(p.MediaContainer.Metadata[0].Player.state, 'playing'); /* nested element attribute */
  assert.equal(p.MediaContainer.Metadata[1].Player.state, 'paused');
});

test('parseXml keeps a single occurrence as one object, not an array', () => {
  const p = parseXml('<MediaContainer><Metadata title="Solo"/></MediaContainer>');
  assert.equal(p.MediaContainer.Metadata.title, 'Solo');
  assert.ok(!Array.isArray(p.MediaContainer.Metadata));
});

test('parseXml collapses text-only elements to their coerced value', () => {
  assert.deepEqual(parseXml('<stats><total>14203</total><blocked>1876</blocked><name>home</name></stats>'),
    { stats: { total: 14203, blocked: 1876, name: 'home' } });
});

test('parseXml leaves IDs, version strings, exponents and huge integers as strings', () => {
  assert.deepEqual(parseXml('<r id="007" ver="1.10" exp="1e3" big="9007199254740993"/>'),
    { r: { id: '007', ver: '1.10', exp: '1e3', big: '9007199254740993' } });
});

test('parseXml decodes entities, handles both quote styles and CDATA', () => {
  assert.deepEqual(parseXml("<r a='x &amp; y' b=\"&lt;ok&gt;\"/>"), { r: { a: 'x & y', b: '<ok>' } });
  assert.deepEqual(parseXml('<note><![CDATA[<b>hi & bye</b>]]></note>'), { note: '<b>hi & bye</b>' });
});

/* ── Tag names that collide with inherited Object.prototype members ── */

test('parseXml keeps a tag named after an inherited member as a single value', () => {
  for (const name of ['toString', 'constructor', 'valueOf', 'hasOwnProperty',
    'isPrototypeOf', 'toLocaleString', 'propertyIsEnumerable', '__defineGetter__']) {
    const p = parseXml(`<r><${name}>hi</${name}></r>`);
    assert.equal(p.r[name], 'hi', name);
    assert.ok(!Array.isArray(p.r[name]), name);
    assert.deepEqual(Object.keys(p.r), [name], name);
  }
});

test('parseXml still arrays a repeated tag named after an inherited member', () => {
  assert.deepEqual(parseXml('<r><toString>a</toString><toString>b</toString></r>'),
    { r: { toString: ['a', 'b'] } });
});

/* A `__proto__` tag or attribute is kept as an ordinary key. On a plain object
   literal it was not: the assignment reached the prototype setter, the element
   vanished, and every later property read on that node resolved against
   feed-supplied data. Read the values with a descriptor, since `p.r.__proto__`
   would ask for the prototype rather than the key. */
test('parseXml keeps a __proto__ tag or attribute without polluting the prototype', () => {
  const own = (o, k) => Object.getOwnPropertyDescriptor(o, k)?.value;

  const tag = parseXml('<r><__proto__>x</__proto__></r>');
  assert.deepEqual(Object.keys(tag.r), ['__proto__']);
  assert.equal(own(tag.r, '__proto__'), 'x');

  const attr = parseXml('<r __proto__="x" a="1"/>');
  assert.deepEqual(Object.keys(attr.r).sort(), ['__proto__', 'a']);
  assert.equal(own(attr.r, '__proto__'), 'x');
  assert.equal(attr.r.a, 1);

  assert.equal({}.x, undefined);
  assert.equal(Object.prototype.x, undefined);
});

/* ── Malformed, truncated and pathological documents ── */

test('parseXml returns an empty object for every non-string input', () => {
  for (const v of [null, undefined, 42, {}, [], true, Symbol('x'), () => {}]) {
    assert.deepEqual(parseXml(v), {});
  }
});

test('parseXml closes unclosed elements at end of input', () => {
  assert.deepEqual(parseXml('<r><a>1</r>'), { r: { a: 1 } });
  assert.deepEqual(parseXml('<r><a>1'), { r: { a: 1 } });
});

test('parseXml ignores a stray closing tag that was never opened', () => {
  assert.deepEqual(parseXml('<r></nope><a>1</a></r>'), { r: { a: 1 } });
});

test('parseXml unwinds to the matching ancestor on a mismatched close', () => {
  assert.deepEqual(parseXml('<r><a><b>1</a><c>2</c></r>'), { r: { a: { b: 1 }, c: 2 } });
});

test('parseXml survives truncated comments, CDATA, declarations and DOCTYPE', () => {
  assert.deepEqual(parseXml('<r><!-- never closed'), { r: '' });
  assert.deepEqual(parseXml('<r><![CDATA[open'), { r: 'open' });
  assert.deepEqual(parseXml('<?xml unterminated'), {});
  assert.deepEqual(parseXml('<!DOCTYPE unterminated'), {});
  assert.deepEqual(parseXml('<r'), {});
});

test('parseXml keeps text alongside children under #text', () => {
  const p = parseXml('<r>lead<a>1</a>tail</r>');
  assert.equal(p.r['#text'], 'leadtail');
  assert.equal(p.r.a, 1);
});

test('parseXml decodes numeric character references and leaves unknown entities alone', () => {
  assert.deepEqual(parseXml('<r a="&#65;&#x42;" b="&nbsp;&unknown;"/>'),
    { r: { a: 'AB', b: '&nbsp;&unknown;' } });
});

test('parseXml leaves an out-of-range numeric reference as written', () => {
  assert.deepEqual(parseXml('<r>&#x110000;</r>'), { r: '&#x110000;' });
});

test('parseXml handles self-closing tags with spacing and attribute quirks', () => {
  assert.deepEqual(parseXml('<r  a = "1"   b=\'2\'  />'), { r: { a: 1, b: 2 } });
  assert.deepEqual(parseXml('<r a=""/>'), { r: { a: '' } });
});

test('parseXml bounds pathological nesting depth without throwing', () => {
  const deep = '<n>'.repeat(500) + 'x' + '</n>'.repeat(500);
  assert.doesNotThrow(() => parseXml(deep));
  assert.ok(parseXml(deep).n);
});

test('parseXml bounds a pathological node count without throwing', () => {
  const wide = `<r>${'<i>1</i>'.repeat(9000)}</r>`;
  const p = parseXml(wide);
  assert.ok(Array.isArray(p.r.i));
  assert.ok(p.r.i.length <= 5000);
});

test('parseXml ignores declaration, comments and DOCTYPE, and is safe on junk', () => {
  assert.deepEqual(parseXml('<?xml version="1.0"?><!DOCTYPE x><!-- c --><r v="1"/>'), { r: { v: 1 } });
  assert.deepEqual(parseXml('not xml'), {});
  assert.deepEqual(parseXml(''), {});
  assert.deepEqual(parseXml(null), {});
});

/* ── P4-2: a '>' inside a quoted attribute value ──────────────────────────────
   The tag scanner was indexOf('>'), which took the first one anywhere, while the
   attribute matcher below it already understood quoting. So <a t="x>y"> ended the
   tag in the middle of the attribute: the element lost its attributes, its text
   became the leftover markup, and the damage ran on into its siblings.

   Only '<' and '&' have to be escaped inside an attribute value, so a raw '>'
   there is valid XML, and feeds do emit it, typically in an episode title or a
   search string. */

test('a > inside a double-quoted attribute does not end the tag', () => {
  assert.deepEqual(parseXml('<r><a t="a>b">1</a></r>'), { r: { a: { t: 'a>b', '#text': 1 } } });
});

test('a > inside a single-quoted attribute does not end the tag', () => {
  assert.deepEqual(parseXml("<r><a t='a>b'>1</a></r>"), { r: { a: { t: 'a>b', '#text': 1 } } });
});

test('both quote styles are handled in one tag', () => {
  assert.deepEqual(parseXml(`<r><a t="a>b" u='c>d'>1</a></r>`), { r: { a: { t: 'a>b', u: 'c>d', '#text': 1 } } });
});

test('a quote of the other kind inside a value is just a character', () => {
  assert.deepEqual(parseXml(`<r><a t="it's">1</a></r>`), { r: { a: { t: "it's", '#text': 1 } } });
  assert.deepEqual(parseXml(`<r><a t='say "hi"'>1</a></r>`), { r: { a: { t: 'say "hi"', '#text': 1 } } });
});

/* The shape this actually breaks in practice: the mangled element used to
   swallow its following sibling. */
test('a feed-like document keeps its structure', () => {
  const xml = '<rss><item><enclosure url="http://h/f?a=1" title="S01>E02"/><title>ok</title></item></rss>';
  assert.deepEqual(parseXml(xml), {
    rss: { item: { enclosure: { url: 'http://h/f?a=1', title: 'S01>E02' }, title: 'ok' } },
  });
});

test('a > in element text is unaffected', () => {
  assert.deepEqual(parseXml('<r><a>2 &gt; 1</a></r>'), { r: { a: '2 > 1' } });
});

test('an encoded > in an attribute still works', () => {
  assert.deepEqual(parseXml('<r><a t="a&gt;b">1</a></r>'), { r: { a: { t: 'a>b', '#text': 1 } } });
});

test('a > inside a doctype system identifier does not end it early', () => {
  assert.deepEqual(parseXml('<!DOCTYPE r SYSTEM "a>b"><r><a>1</a></r>'), { r: { a: 1 } });
});

/* An unterminated quote ends the document, which is what an unterminated tag
   already did. It must not throw or loop. */
test('an unterminated attribute quote ends the document safely', () => {
  assert.doesNotThrow(() => parseXml('<r><a t="oops</r>'));
  assert.doesNotThrow(() => parseXml("<r><a t='oops"));
  assert.doesNotThrow(() => parseXml('<r><a t="'));
});

test('a closing tag is unaffected by quote tracking', () => {
  assert.deepEqual(parseXml('<r><a t="x>y">1</a><b>2</b></r>'), { r: { a: { t: 'x>y', '#text': 1 }, b: 2 } });
});

test('several attributes each containing > all survive', () => {
  const out = parseXml('<r><a p="1>2" q="3>4" s="5>6">t</a></r>');
  assert.deepEqual(out, { r: { a: { p: '1>2', q: '3>4', s: '5>6', '#text': 't' } } });
});

/* ── P4-5: truncation was silent ─────────────────────────────────────────────
   The parser stops at MAX_NODES and returns what it read, and said nothing about
   it. A 3000-item feed and a 2499-item feed were indistinguishable to the caller,
   so a badge or widget showed a number that was simply wrong and looked fine.

   MAX_NODES counts nodes, not items, deliberately: the cap bounds memory and
   work, and nodes are what consume them. A feed whose items are two nodes each
   therefore stops at about 2499 items, sooner than the constant suggests. That is
   not an off-by-one; exactly 5000 nodes are kept. */

const _feed = n => '<rss><channel>'
  + Array.from({ length: n }, (_, i) => `<item><title>T${i}</title></item>`).join('')
  + '</channel></rss>';

test('a document within the caps is not flagged', () => {
  assert.equal(parseXml('<r><a>1</a></r>')['#truncated'], undefined);
  assert.equal(parseXml(_feed(100))['#truncated'], undefined);
});

test('a document over the node cap is flagged', () => {
  const out = parseXml(_feed(4000));
  assert.equal(out['#truncated'], true);
  assert.ok(out.rss.channel.item.length < 4000, 'and is genuinely short');
});

/* The boundary, pinned exactly, so a change to the cap or the counting shows up
   here rather than in someone's badge. */
test('the cap keeps exactly as many nodes as it says', () => {
  /* rss + channel + n*(item + title) nodes. 5000 nodes is 2499 whole items. */
  assert.equal(parseXml(_feed(2499))['#truncated'], undefined, '5000 nodes exactly should fit');
  assert.equal(parseXml(_feed(2499)).rss.channel.item.length, 2499);
  assert.equal(parseXml(_feed(2500))['#truncated'], true, 'one node over should be flagged');
  assert.equal(parseXml(_feed(2500)).rss.channel.item.length, 2499);
});

/* Past the depth cap an element is kept but nothing nested inside it is, which
   loses data just as the node cap does. */
test('exceeding the depth cap is flagged too', () => {
  const deep = '<r>' + '<a>'.repeat(80) + 'x' + '</a>'.repeat(80) + '</r>';
  assert.equal(parseXml(deep)['#truncated'], true);
  const shallow = '<r>' + '<a>'.repeat(10) + 'x' + '</a>'.repeat(10) + '</r>';
  assert.equal(parseXml(shallow)['#truncated'], undefined);
});

/* '#' cannot start an XML name, so the flag can never be mistaken for an element,
   which is why it matches the existing '#text' convention. */
test('the flag cannot collide with an element name', () => {
  const out = parseXml('<r><truncated>no</truncated></r>');
  assert.equal(out['#truncated'], undefined);
  assert.equal(out.r.truncated, 'no');
});

test('the flag sits beside the root, not inside it', () => {
  const out = parseXml(_feed(4000));
  assert.ok('#truncated' in out);
  assert.ok(!('#truncated' in out.rss), 'nesting it would collide with document content');
});

test('an empty or unparseable document is not flagged', () => {
  assert.equal(parseXml('')['#truncated'], undefined);
  assert.equal(parseXml('not xml at all')['#truncated'], undefined);
});
