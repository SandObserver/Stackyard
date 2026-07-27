const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseXml } = require('../src/parse-xml');

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

/* A `__proto__` tag or attribute is dropped rather than stored: the assignment
   reaches the prototype setter instead of creating an own key. Nothing leaks
   into Object.prototype, so this is a lossy read of a name no API emits. */
test('parseXml drops a __proto__ tag or attribute without polluting the prototype', () => {
  assert.deepEqual(Object.keys(parseXml('<r><__proto__>x</__proto__></r>').r), []);
  assert.deepEqual(parseXml('<r __proto__="x" a="1"/>'), { r: { a: 1 } });
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
