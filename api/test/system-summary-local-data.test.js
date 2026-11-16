const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dispatchProvider } = require('../src/provider-dispatch');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'system-summary', 'data.js'));

const SENSORS = [
  { id: 'coretemp/Package id 0', label: 'Package id 0 (coretemp)', chip: 'coretemp', raw: 'Package id 0' },
  { id: 'iwlwifi_1/temp1', label: 'iwlwifi_1', chip: 'iwlwifi_1', raw: '' },
];

function ctxFor(config, extra = {}) {
  const asked = [];
  const metrics = {
    cpuSample: async () => ({ cpu: 5, iowait: 1 }),
    ramPercent: () => 50,
    diskStats: () => ({ usedPct: 10, totalGb: 100 }),
    procCount: () => 200,
    uptimeSeconds: () => 60,
    tempSensors: () => SENSORS,
    sensorTemps: keys => {
      asked.push(keys);
      return Object.fromEntries(keys.map((k, i) => [k, 40 + i]));
    },
  };
  const ctx = { config, settings: {}, metrics, params: new URLSearchParams(), ...extra };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return { ctx, asked };
}

test('each temperature slot is read by the sensor it names', async () => {
  const slots = [{ type: 'temp', localSensor: 'cpu' }, { type: 'temp', localSensor: 'thermal_zone1' }, { type: 'cpu' }];
  const { ctx, asked } = ctxFor({ slots });
  const r = await dataFn(ctx);
  assert.deepEqual(asked, [['cpu', 'thermal_zone1']]);
  assert.deepEqual(r.temps, { cpu: 40, thermal_zone1: 41 });
  assert.equal('temp' in r, false);
});

test('a sensor value left by another source is not read on this machine', async () => {
  const { ctx, asked } = ctxFor({ slots: [{ type: 'temp', sensor: 'Core 0', localSensor: 'cpu' }] });
  await dataFn(ctx);
  assert.deepEqual(asked, [['cpu']]);
});

test('no temperature slot reads no sensor', async () => {
  const { ctx, asked } = ctxFor({ slots: [{ type: 'cpu' }] });
  const r = await dataFn(ctx);
  assert.deepEqual(asked, []);
  assert.deepEqual(r.temps, {});
});

test('the local sensor list offers the automatic CPU first, then each sensor', async () => {
  const { ctx } = ctxFor({ slots: [] }, { endpoint: 'sensors', row: { type: 'temp', localSensor: 'cpu' } });
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, [
    { value: 'cpu', label: 'CPU (automatic)', labelKey: 'slots.sensor.opt.cpu' },
    { value: 'coretemp/Package id 0', label: 'Package id 0 (coretemp)' },
    { value: 'iwlwifi_1/temp1', label: 'iwlwifi_1' },
  ]);
});

test('a slot still on a zone number keeps that zone in the list until another is picked', async () => {
  const { ctx } = ctxFor({ slots: [] }, { endpoint: 'sensors', row: { type: 'temp', localSensor: 'thermal_zone1' } });
  const r = await dataFn(ctx);
  assert.deepEqual(r.options[1], {
    value: 'thermal_zone1',
    label: 'Thermal Zone 1 (can change after a restart)',
    labelKey: 'slots.sensor.opt.zone',
    labelVars: { n: '1' },
  });
  assert.equal(r.options.length, 4);
});
