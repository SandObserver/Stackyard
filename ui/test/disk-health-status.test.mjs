/* The bay light and its words, lifted from the widget's inline module. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { register } from 'node:module';

register('./js-root-hooks.mjs', import.meta.url);
Object.defineProperty(globalThis, 'navigator', { value: { language: 'en' }, configurable: true });
const { formatBytes } = await import('../js/format-number.js');

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

const alertFn = src.match(/function updateAlert\(\) \{[\s\S]*?\n\}/);
assert.ok(alertFn, 'updateAlert is defined in the widget');

function runAlert(bays) {
  const els = { alert: { hidden: true, textContent: '' }, nums: { hidden: false } };
  new Function(
    'bayData',
    'unread',
    'formatNumber',
    'wt',
    'wtCount',
    'formatList',
    'document',
    `${led[0]}; ${alertFn[0]}; updateAlert();`,
  )(
    bays,
    d => !!d?.error,
    n => String(n),
    (_k, fallback) => fallback,
    (_k, count, fallback, vars) => (count === 1 ? fallback.one : fallback.other).replace('{list}', vars.list),
    items => items.join(', '),
    { getElementById: id => els[id] },
  );
  return els;
}

test('a failed drive is named in words and replaces the bay numbers', () => {
  const els = runAlert([{ device_status: 0, hasSmart: true }, null, { device_status: 2, hasSmart: true }, null]);
  assert.equal(els.alert.hidden, false);
  assert.equal(els.nums.hidden, true);
  assert.equal(els.alert.textContent, 'Bay 3 failed');
});

test('several failed drives are listed by bay', () => {
  const els = runAlert([{ device_status: 1, hasSmart: true }, { device_status: 1, hasSmart: true }, null, null]);
  assert.equal(els.alert.textContent, 'Bays 1, 2 failed');
});

test('healthy, unread and SMART-less drives raise no alert', () => {
  const els = runAlert([
    { device_status: 0, hasSmart: true },
    { error: 'x' },
    { device_status: 3, hasSmart: false },
    null,
  ]);
  assert.equal(els.alert.hidden, true);
  assert.equal(els.nums.hidden, false);
});

const css = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));

test('bays are spaced by their own border, not a flex gap or a resting layer', () => {
  assert.doesNotMatch(css.match(/#bays \{[^}]*\}/)[0], /\bgap:/);
  assert.match(css, /\.bay \{[^}]*border:1\.5px solid transparent;[^}]*background-clip:padding-box;/);
  assert.doesNotMatch(css.match(/\.bay \{[^}]*\}/)[0], /will-change|background:/);
});

test('each bay carries its own status light', () => {
  assert.match(src, /<i class="led" id="led-\$\{i\}"><\/i>/);
  assert.doesNotMatch(src, /id="dots"/);
});

const capFn = src.match(/const CAP = .*;\n/);
const fmtFn = src.match(/function fmtCap\(c\)\{.*\}/);
const freeFn = src.match(/function freeText\(d\) \{[\s\S]*?\n\}/);
assert.ok(capFn && fmtFn && freeFn, 'CAP, fmtCap and freeText are defined in the widget');
const { fmtCap, freeText } = new Function(
  'wt',
  'formatBytes',
  `${capFn[0]} ${fmtFn[0]}; ${freeFn[0]}; return { fmtCap, freeText };`,
)((_k, fallback) => fallback, formatBytes);

test('free space is measured against the filesystem size, not the drive size', () => {
  assert.equal(freeText({ capacity: 4e12, free: 20e9, fsTotal: 100e9 }), '20 GB / 100 GB free');
  assert.equal(freeText({ free: 0, fsTotal: 100e9 }), '0 GB / 100 GB free');
});

test('a drive size counts in steps of 1000, with one decimal place under 10 TB', () => {
  assert.equal(fmtCap(500_107_862_016), '500 GB');
  assert.equal(fmtCap(999.6e9), '1 TB');
  assert.equal(fmtCap(4.5e12), '4.5 TB');
  assert.equal(fmtCap(18e12), '18 TB');
  assert.equal(fmtCap(0), '');
  assert.equal(fmtCap(undefined), '');
});
