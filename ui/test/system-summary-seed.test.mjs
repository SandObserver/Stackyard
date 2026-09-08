/* The chart holds one reading per tick and starts empty, so a fresh demo shows
   a flat widget for minutes. The demo host sends a past; this is what turns it
   into drawn bars. The function is lifted out of the widget's inline module,
   which cannot be imported. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'widgets/system-summary/index.html'), 'utf8');

const fn = src.match(/function seedFromPast\(slot, i, past\) \{[\s\S]*?\n\}/);
assert.ok(fn, 'seedFromPast is defined in the widget');

function load(bars) {
  const history = [{}, {}, {}, {}];
  for (const h of history) h.vals = Array(bars).fill(null);
  const seed = new Function('history', `${fn[0]}; return seedFromPast;`)(history);
  return { history, seed };
}

const past = { cpu: [1, 2, 3, 4, 5], ram: [9, 9], temps: { 0: [40, 41], 2: [70, 71] } };

test('a past fills the chart from the right and leaves room for the live value', () => {
  const { history, seed } = load(4);
  seed({ type: 'cpu' }, 0, past);
  assert.deepEqual(history[0].vals, [null, 3, 4, 5]);
});

test('a past shorter than the chart keeps the empty lead', () => {
  const { history, seed } = load(5);
  seed({ type: 'ram' }, 1, past);
  assert.deepEqual(history[1].vals, [null, null, null, 9, 9]);
});

test('a temperature slot reads the zone it names', () => {
  const { history, seed } = load(3);
  seed({ type: 'temp', thermalZone: 2 }, 0, past);
  assert.deepEqual(history[0].vals, [null, 70, 71]);
  const b = load(3);
  b.seed({ type: 'temp' }, 0, past);
  assert.deepEqual(b.history[0].vals, [null, 40, 41], 'no zone named means zone 0');
});

test('seeding happens once and never overwrites real readings', () => {
  const { history, seed } = load(4);
  seed({ type: 'cpu' }, 0, past);
  history[0].vals = [null, null, null, 99];
  seed({ type: 'cpu' }, 0, past);
  assert.deepEqual(history[0].vals, [null, null, null, 99]);
});

test('a chart already holding a reading is left alone', () => {
  const { history, seed } = load(4);
  history[2].vals = [null, null, null, 42];
  seed({ type: 'cpu' }, 2, past);
  assert.deepEqual(history[2].vals, [null, null, null, 42]);
});

test('a real host sends no past and the chart stays empty', () => {
  const { history, seed } = load(3);
  seed({ type: 'cpu' }, 0, undefined);
  assert.deepEqual(history[0].vals, [null, null, null]);
  seed({ type: 'disk', primary: '/' }, 0, past);
  assert.deepEqual(history[0].vals, [null, null, null], 'a disk slot draws no sparkline');
});
