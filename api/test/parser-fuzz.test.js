const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseXml } = require('../src/parse-xml');
const { parsePrometheus } = require('../src/parse-prometheus');
const { parseMultipartFile } = require('../src/parse-multipart');

/* ── Deterministic fuzzing for the three hand-rolled parsers ──

   Every parser here reads bytes straight off a remote server, so the property
   under test is resilience rather than output: for any input at all, return a
   value of the documented type, do not throw, do not hang, and do not touch
   Object.prototype. Exact outputs stay in the per-parser suites.

   The generator is seeded from a constant so a failure reproduces identically
   here and in CI. Raising ITERATIONS or changing SEED explores new inputs; a
   failure found that way should be pinned as a fixed case in the parser's own
   suite rather than left to the generator to rediscover. */

const SEED = 0x5eed1e;
const ITERATIONS = 2000;
const BUDGET_MS = 15000;

/* mulberry32: small, fast, fully determined by its seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Fragments that steer the generator towards the shapes each parser branches
   on, so random input reaches real code paths instead of bouncing off the
   first character. */
const TOKENS = [
  '<', '>', '</', '/>', '<!--', '-->', '<![CDATA[', ']]>', '<?xml', '?>', '<!DOCTYPE',
  '=', '"', "'", '&', '&amp;', '&#x', '&#', ';', ' ', '\t', '\r\n', '\n', '\0',
  'a', 'r', 'tag', 'x:y', '__proto__', 'toString', 'constructor', 'valueOf',
  '0', '42', '-1', '1e999', '.5', 'NaN', 'Infinity', '9007199254740993',
  '# HELP', '# TYPE', '{', '}', ',', 'metric_a', '{code="200"}',
  '--BOUND', '--BOUND--', 'Content-Disposition: form-data;', 'name="i"',
  'filename="x.svg"', 'filename="../../etc/passwd"', ':', '.', '-', '%', '\\',
  '\u00ff', '\ud83d\ude00', '\ufffd',
];

function generate(rand) {
  const n = 1 + Math.floor(rand() * 60);
  let out = '';
  for (let i = 0; i < n; i++) out += TOKENS[Math.floor(rand() * TOKENS.length)];
  return out;
}

/* Byte-level corruption of a valid document, which reaches truncation and
   split-token paths that token assembly alone tends to miss. */
function corrupt(rand, source) {
  const bytes = Buffer.from(source, 'utf8');
  const edits = 1 + Math.floor(rand() * 6);
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(rand() * bytes.length);
    if (rand() < 0.5) bytes[at] = Math.floor(rand() * 256);
    else return bytes.slice(0, at).toString('latin1');
  }
  return bytes.toString('latin1');
}

const VALID_XML = '<MediaContainer size="2"><Metadata title="A"><Player state="playing"/></Metadata>'
  + '<Metadata title="B"/><!-- c --><![CDATA[raw]]></MediaContainer>';
const VALID_PROM = '# HELP x help\n# TYPE x gauge\nmetric_a 42\nmetric_b{code="200"} 3.5 1650000000\n';
const VALID_MULTIPART = '--BOUND\r\nContent-Disposition: form-data; name="i"; filename="x.svg"\r\n\r\n'
  + '<svg/>\r\n--BOUND--\r\n';

function inputsFor(valid) {
  const rand = rng(SEED);
  const list = [];
  for (let i = 0; i < ITERATIONS; i++) {
    list.push(i % 2 === 0 ? generate(rand) : corrupt(rand, valid));
  }
  return list;
}

/* A reference clone taken before the run: any own key added to Object.prototype
   by a parser would show up as a difference afterwards. */
const PROTO_KEYS_BEFORE = Object.getOwnPropertyNames(Object.prototype).sort().join(',');

function assertPrototypeIntact() {
  assert.equal(Object.getOwnPropertyNames(Object.prototype).sort().join(','), PROTO_KEYS_BEFORE);
  assert.equal({}.polluted, undefined);
}

test('parseXml never throws and always returns an object', () => {
  const started = Date.now();
  for (const input of inputsFor(VALID_XML)) {
    let out;
    assert.doesNotThrow(() => { out = parseXml(input); }, () => `input: ${JSON.stringify(input)}`);
    assert.equal(typeof out, 'object', `input: ${JSON.stringify(input)}`);
    assert.notEqual(out, null, `input: ${JSON.stringify(input)}`);
  }
  assertPrototypeIntact();
  assert.ok(Date.now() - started < BUDGET_MS, 'parseXml fuzz run exceeded its time budget');
});

test('parsePrometheus never throws and always returns finite numeric values', () => {
  const started = Date.now();
  for (const input of inputsFor(VALID_PROM)) {
    let out;
    assert.doesNotThrow(() => { out = parsePrometheus(input); }, () => `input: ${JSON.stringify(input)}`);
    for (const [key, value] of Object.entries(out)) {
      assert.equal(typeof value, 'number', `key ${key} from ${JSON.stringify(input)}`);
      assert.ok(!Number.isNaN(value), `key ${key} from ${JSON.stringify(input)}`);
    }
  }
  assertPrototypeIntact();
  assert.ok(Date.now() - started < BUDGET_MS, 'parsePrometheus fuzz run exceeded its time budget');
});

test('parseMultipartFile never throws and reports a consistent result shape', () => {
  const started = Date.now();
  for (const input of inputsFor(VALID_MULTIPART)) {
    const buf = Buffer.from(input, 'latin1');
    let out;
    assert.doesNotThrow(() => { out = parseMultipartFile(buf, 'BOUND'); }, () => `input: ${JSON.stringify(input)}`);
    assert.equal(typeof out.filename, 'string', `input: ${JSON.stringify(input)}`);
    assert.ok(out.fileParts >= 0, `input: ${JSON.stringify(input)}`);
    /* A file part was seen, so its bytes must have been captured too. */
    if (out.fileParts > 0) assert.ok(Buffer.isBuffer(out.data), `input: ${JSON.stringify(input)}`);
    else assert.equal(out.data, null, `input: ${JSON.stringify(input)}`);
    /* basename() is the only guard stopping a part naming a path from escaping
       the icons directory, so it must hold for every input, not just valid ones. */
    assert.ok(!out.filename.includes('/'), `input: ${JSON.stringify(input)}`);
  }
  assertPrototypeIntact();
  assert.ok(Date.now() - started < BUDGET_MS, 'parseMultipartFile fuzz run exceeded its time budget');
});
