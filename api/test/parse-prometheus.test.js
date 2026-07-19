const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePrometheus } = require('../src/parse-prometheus');

test('parsePrometheus extracts numeric metric lines', () => {
  const out = parsePrometheus('# HELP x\nmetric_a 42\nmetric_b 3.5\n# comment\nbad_line');
  assert.equal(out['metric_a'], 42);
  assert.equal(out['metric_b'], 3.5);
  assert.ok(!('bad_line' in out));
});
