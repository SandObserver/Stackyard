/* What the System Summary draws from a reading. The functions are lifted out of
   the widget's inline module, which cannot be imported. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const src = fs.readFileSync(new URL('../widgets/system-summary/index.html', import.meta.url), 'utf8');

function lift(name, sig, deps = {}) {
  const m = src.match(new RegExp(`function ${name}\\(${sig}\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} is defined in the widget`);
  return new Function(...Object.keys(deps), `${m[0]}; return ${name};`)(...Object.values(deps));
}
function liftConst(name) {
  const m = src.match(new RegExp(`const ${name} = ([^;]+);`));
  assert.ok(m, `${name} is defined in the widget`);
  return new Function(`return ${m[1]};`)();
}

const REFRESH_SECONDS = liftConst('REFRESH_SECONDS');
const reading = liftConst('reading');
const refreshSeconds = lift('refreshSeconds', 'wc', { REFRESH_SECONDS });
const valueText = lift('valueText', 'type, v', { formatNumber: n => String(n) });
const scaleFor = lift('scaleFor', 'type, vals');
const readingFor = lift('readingFor', 'slot, data', { reading });

test('the refresh setting takes only the offered choices, 10 s otherwise', () => {
  assert.equal(refreshSeconds({ refresh: '5' }), 5);
  assert.equal(refreshSeconds({ refresh: '60' }), 60);
  assert.equal(refreshSeconds({}), 10);
  for (const bad of ['0', '1', '-5', '3600', 'abc', null, ''])
    assert.equal(refreshSeconds({ refresh: bad }), 10, String(bad));
  assert.equal(refreshSeconds(undefined), 10);
});

test('anything but a finite, non-negative number is no reading', () => {
  for (const bad of [null, undefined, NaN, Infinity, -1, '42', {}, []]) assert.equal(reading(bad), null, String(bad));
  assert.equal(reading(0), 0);
  assert.equal(reading(12.5), 12.5);
});

test('a missing source field, sensor or zone reads as no reading, not as zero', () => {
  assert.equal(readingFor({ type: 'cpu' }, {}), null);
  assert.equal(readingFor({ type: 'temp', sensor: 'nvme' }, { temps: { 0: 40 } }), null);
  assert.equal(readingFor({ type: 'temp' }, { temps: { 0: 40 } }), 40);
  assert.equal(readingFor({ type: 'temp', thermalZone: 2 }, { temps: { 2: 71 } }), 71);
  assert.equal(readingFor({ type: 'nonsense' }, { cpu: 5 }), null);
});

test('each type writes its own unit, and a missing value writes a dash', () => {
  assert.equal(valueText('cpu', 23.4), '23%');
  assert.equal(valueText('ram', 140), '100%', 'a share never reads above 100');
  assert.equal(valueText('temp', 51.6), '52°');
  assert.equal(valueText('procs', 318), '318');
  assert.equal(valueText('cpu', null), '—');
});

test('shares and temperatures draw against 0 to 100', () => {
  assert.deepEqual(scaleFor('cpu', [1, 2]), { min: 0, max: 100 });
  assert.deepEqual(scaleFor('temp', [90]), { min: 0, max: 100 });
});

test('a process count draws against its own window, and above the mean is full strength', () => {
  const s = scaleFor('procs', [300, null, 310, 320]);
  assert.equal(s.max, 320);
  assert.ok(Math.abs((300 - s.min) / (s.max - s.min) - 0.12) < 1e-9, 'the low sits 12% up, so it still shows');
  assert.equal(s.dim(305), true);
  assert.equal(s.dim(315), false);
});

test('a flat or empty process window still draws', () => {
  assert.deepEqual(scaleFor('procs', [200, 200]), { min: 199, max: 201 });
  assert.deepEqual(scaleFor('procs', [null, null]), {});
});
