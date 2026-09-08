const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { metrics } = require('../src/demo-data');
const { dispatchProvider } = require('../src/provider-dispatch');

const statsFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'system-summary', 'data.js'));

function ctxFor(config, m) {
  const ctx = { endpoint: undefined, config, settings: {}, metrics: m };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return ctx;
}

const SLOTS = { slots: [{ type: 'cpu' }, { type: 'ram' }, { type: 'temp', thermalZone: 1 }] };

test('a demo series ends at the value the metric reports now', () => {
  const s = metrics.series('cpu', 40, 10);
  assert.equal(s.length, 40);
  assert.equal(s.at(-1), metrics.cpuSample().cpu);
  assert.ok(
    s.every(v => v >= 8 && v <= 46),
    'every point stays inside the curve range',
  );
});

test('a demo series keeps each metric decimal precision', () => {
  assert.ok(metrics.series('cpu', 5, 10).every(v => Number.isInteger(v)));
  assert.ok(metrics.series('procs', 5, 10).every(v => Number.isInteger(v)));
  assert.ok(metrics.series('iowait', 5, 10).every(v => Math.round(v * 10) === v * 10));
});

test('the demo host supplies a past for every charted slot', async () => {
  const r = await statsFn(ctxFor(SLOTS, metrics));
  assert.equal(r.history.cpu.length, 120);
  assert.equal(r.history.ram.length, 120);
  assert.deepEqual(Object.keys(r.history.temps).sort(), ['0', '1']);
  assert.equal(r.history.temps[1].length, 120);
  assert.equal(r.history.cpu.at(-1), r.cpu);
  assert.equal(r.history.ram.at(-1), r.ram);
});

test('a real host supplies no history', async () => {
  const real = {
    cpuSample: async () => ({ cpu: 3, iowait: 0.1 }),
    ramPercent: () => 40,
    diskStats: () => ({ usedPct: 10, totalGb: 100 }),
    cpuTemp: () => 41,
    procCount: () => 200,
    uptimeSeconds: () => 60,
  };
  const r = await statsFn(ctxFor(SLOTS, real));
  assert.equal(r.history, undefined);
  assert.equal(r.cpu, 3);
});
