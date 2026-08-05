const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePrometheus } = require('../src/parse-prometheus');

test('parsePrometheus extracts numeric metric lines', () => {
  const out = parsePrometheus('# HELP x\nmetric_a 42\nmetric_b 3.5\n# comment\nbad_line');
  assert.equal(out['metric_a'], 42);
  assert.equal(out['metric_b'], 3.5);
  assert.ok(!('bad_line' in out));
});

test('parsePrometheus reads negative, exponent and fractional values', () => {
  const out = parsePrometheus('a -1\nb +2\nc 1.5e3\nd -2.5E-2\ne .5');
  assert.equal(out.a, -1);
  assert.equal(out.b, 2);
  assert.equal(out.c, 1500);
  assert.equal(out.d, -0.025);
  assert.equal(out.e, 0.5);
});

test('parsePrometheus keeps labelled series as distinct keys', () => {
  const out = parsePrometheus('http_requests_total{method="get",code="200"} 7\n'
    + 'http_requests_total{method="post",code="200"} 9');
  assert.equal(out['http_requests_total{method="get",code="200"}'], 7);
  assert.equal(out['http_requests_total{method="post",code="200"}'], 9);
});

test('parsePrometheus tolerates CRLF, blank lines and trailing timestamps', () => {
  const out = parsePrometheus('\r\n\r\nmetric_a 42 1650000000000\r\n   \r\nmetric_b 7\r\n');
  assert.equal(out.metric_a, 42);
  assert.equal(out.metric_b, 7);
});

test('parsePrometheus skips lines with no usable numeric value', () => {
  const out = parsePrometheus('a NaN\nb +Inf\nc -Inf\nd\ne \nf abc\n1bad 5');
  assert.deepEqual(Object.keys(out), []);
});

test('parsePrometheus takes the last value when a series repeats', () => {
  assert.equal(parsePrometheus('a 1\na 2\na 3').a, 3);
});

/* A metric literally named __proto__ is kept as an ordinary key. On a plain
   object literal it was silently discarded, because a primitive written through
   the prototype setter is a no-op. */
test('parsePrometheus keeps a __proto__ metric without polluting the prototype', () => {
  const out = parsePrometheus('__proto__ 5\nreal 1');
  assert.deepEqual(Object.keys(out).sort(), ['__proto__', 'real']);
  assert.equal(Object.getOwnPropertyDescriptor(out, '__proto__').value, 5);
  assert.equal({}.x, undefined);
  assert.equal(Object.prototype.x, undefined);
});

/* P4-10: the two parsers disagreed on bad input. parseXml guards its argument
   and returns an empty object; this one called text.split straight away and
   threw a TypeError. Both are handed upstream bodies and both are toolbox
   methods a widget's data.js can call, so passing an already-parsed JSON body
   threw out of the data function and became a 502, where the same mistake with
   XML quietly returned {}. */
test('parsePrometheus returns an empty object for every non-string input', () => {
  for (const v of [null, undefined, 42, {}, [], true, Symbol('x'), () => {}]) {
    assert.deepEqual(Object.keys(parsePrometheus(v)), [], String(typeof v));
  }
});

test('parsePrometheus and parseXml agree on non-string input', () => {
  const { parseXml } = require('../src/parse-xml');
  for (const v of [null, undefined, 42, {}, [], true]) {
    assert.deepEqual(Object.keys(parsePrometheus(v)), Object.keys(parseXml(v)), String(typeof v));
  }
});

/* The reason this one is not capped the way parseXml is: it is linear in the
   body, and the body is already bounded. Sized well under FETCH_SIZE_LIMIT so
   the test stays quick while still covering many thousands of series. */
test('a large body is read in full rather than truncated', () => {
  let body = '';
  for (let i = 0; i < 20000; i++) body += `series_number_${i} ${i}\n`;
  const out = parsePrometheus(body);
  assert.equal(Object.keys(out).length, 20000, 'every series must survive');
  assert.equal(out.series_number_19999, 19999);
  assert.ok(!Object.keys(out).some(k => k.startsWith('#')), 'and nothing is flagged as truncated');
});

/* ── P4-10: XML was recognised by content, metrics only by marker ────────────
   The XML branch matches on content-type OR a body sniff. The metrics branch
   required content-type AND a `# TYPE` comment, but `# HELP` and `# TYPE` are
   both optional in the exposition format, so an exporter that omits them while
   correctly declaring `text/plain; version=0.0.4` fell through and came back as
   a raw string.

   The fix keys off the registered content type rather than sniffing the body.
   A '<' opening a document is unambiguous; a metric line is not, and "Version
   1.2" in a plain-text response matches the metric grammar exactly. */

const { looksLikeMetrics } = require('../src/proxy');
const BARE = 'up 1\nprocess_cpu_seconds_total 0.5\n';

test('the versioned exposition content type is metrics without a TYPE comment', () => {
  assert.equal(looksLikeMetrics('text/plain; version=0.0.4; charset=utf-8', BARE), true);
});

test('openmetrics is metrics without a TYPE comment', () => {
  assert.equal(looksLikeMetrics('application/openmetrics-text; version=1.0.0', BARE), true);
});

test('a bare text/plain still needs a TYPE comment', () => {
  assert.equal(looksLikeMetrics('text/plain; charset=utf-8', '# TYPE up gauge\nup 1\n'), true);
  assert.equal(looksLikeMetrics('text/plain; charset=utf-8', BARE), false, 'unchanged: stays a string');
});

/* Why the body is not sniffed: this line is valid metric syntax. */
test('plain prose is not mistaken for metrics', () => {
  assert.equal(looksLikeMetrics('text/plain', 'Version 1.2\n'), false);
  assert.equal(looksLikeMetrics('text/plain', 'Status OK\n'), false);
});

test('xml and an absent content type are not metrics', () => {
  assert.equal(looksLikeMetrics('application/xml', '<r><a>1</a></r>'), false);
  assert.equal(looksLikeMetrics('', BARE), false, 'no content-type: behaviour unchanged');
});
