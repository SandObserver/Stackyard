const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { metrics, CURVES } = require('../src/demo-data');
const { dispatchProvider } = require('../src/provider-dispatch');

const statsFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'system-summary', 'data.js'));

function ctxFor(config, m) {
  const ctx = { endpoint: undefined, config, settings: {}, metrics: m };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return ctx;
}

const SLOTS = { slots: [{ type: 'cpu' }, { type: 'ram' }, { type: 'temp', thermalZone: 1 }] };

/* The curve is a function of the clock, so two reads a few milliseconds apart
   can round to neighbouring values. The point is that the series ends where the
   live value is, not that two separate reads are identical. */
const CONTINUOUS = 1;

test('a demo series ends at the value the metric reports now', () => {
  const [, min, max] = CURVES.cpu;
  const s = metrics.series('cpu', 40, 10);
  assert.equal(s.length, 40);
  assert.ok(Math.abs(s.at(-1) - metrics.cpuSample().cpu) <= CONTINUOUS);
  assert.ok(
    s.every(v => v >= min && v <= max),
    'every point stays inside the curve range',
  );
});

/* Sampling the current clock reaches an extreme only when the run happens to
   land on one. Sweep the clock so they are always visited. */
test('no curve leaves its declared range, at any point on the clock', () => {
  const realNow = Date.now;
  try {
    for (const [kind, [period, min, max]] of Object.entries(CURVES)) {
      /* The wobble runs on its own period. A span far longer than the wave
         brings the two into phase. */
      let lo = Infinity;
      let hi = -Infinity;
      for (let t = 0; t < period * 500; t += period / 40) {
        Date.now = () => t * 1000;
        const v = metrics.series(kind, 1, 10)[0];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      assert.ok(lo >= min, `${kind} fell to ${lo}, below its declared minimum of ${min}`);
      assert.ok(hi <= max, `${kind} rose to ${hi}, above its declared maximum of ${max}`);
    }
  } finally {
    Date.now = realNow;
  }
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
  assert.ok(Math.abs(r.history.cpu.at(-1) - r.cpu) <= CONTINUOUS);
  assert.ok(Math.abs(r.history.ram.at(-1) - r.ram) <= CONTINUOUS);
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
