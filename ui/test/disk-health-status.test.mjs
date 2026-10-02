/* The bay light and its words, lifted from the widget's inline module. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const src = fs.readFileSync(new URL('../widgets/disk-health/index.html', import.meta.url), 'utf8');
const led = src.match(/function ledClass\(s, hasSmart\) \{[\s\S]*?\n\}/);
const text = src.match(/function statusText\(s, hasSmart\) \{[\s\S]*?\n\}/);
assert.ok(led && text, 'ledClass and statusText are defined in the widget');
const { ledClass, statusText } = new Function('wt', `${led[0]}; ${text[0]}; return { ledClass, statusText };`)(
  (_k, fallback) => fallback,
);

test('any status but 0 is a red, failed drive', () => {
  for (const s of [1, 2, 3]) {
    assert.equal(ledClass(s, true), 'red');
    assert.equal(statusText(s, true), 'Failed');
  }
});

test('a passed drive is green and says Healthy', () => {
  assert.equal(ledClass(0, true), 'green');
  assert.equal(statusText(0, true), 'Healthy');
});

test('a drive without SMART data has no light', () => {
  assert.equal(ledClass(0, false), '');
  assert.equal(statusText(2, false), 'No SMART data');
});
