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

/* A metric literally named __proto__ is discarded: the assignment reaches the
   prototype setter and a primitive write through it is a no-op. Recorded so a
   future change to the accumulator does not turn this into pollution. */
test('parsePrometheus drops a __proto__ metric without polluting the prototype', () => {
  const out = parsePrometheus('__proto__ 5\nreal 1');
  assert.deepEqual(Object.keys(out), ['real']);
  assert.equal({}.x, undefined);
  assert.equal(Object.prototype.x, undefined);
});
