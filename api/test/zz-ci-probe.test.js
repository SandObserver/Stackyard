const test = require('node:test');
const assert = require('node:assert/strict');

test('ci probe fails on purpose', () => {
  assert.equal(1, 2, 'probe');
});
