const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapScrutinyDevices } = require('../src/scrutiny');

const summary = {
  a: { smart: {}, device: { device_id: 1, model_name: 'WD Red', device_name: 'sda', capacity: 4000, smart_support: { available: true } } },
  b: { smart: {}, device: { device_id: 2, device_serial_id: 'SER123', device_name: 'sdb', capacity: 8000, smart_support: { available: true } } },
  c: { smart: {}, device: { device_id: 3, device_name: 'sdc', capacity: 2000, smart_support: { available: true } } },
};

test('maps devices with SMART support to the widget shape', () => {
  const out = mapScrutinyDevices(summary);
  assert.deepEqual(out, [
    { device_id: 1, model_name: 'WD Red', device_name: 'sda', capacity: 4000 },
    { device_id: 2, model_name: 'SER123', device_name: 'sdb', capacity: 8000 },
    { device_id: 3, model_name: 'sdc', device_name: 'sdc', capacity: 2000 },
  ]);
});

test('drops devices without SMART support or without a smart block', () => {
  const out = mapScrutinyDevices({
    ok:      { smart: {}, device: { device_id: 1, device_name: 'sda', smart_support: { available: true } } },
    unsupp:  { smart: {}, device: { device_id: 2, device_name: 'sdb', smart_support: { available: false } } },
    nosmart: { device: { device_id: 3, device_name: 'sdc', smart_support: { available: true } } },
  });
  assert.deepEqual(out.map(d => d.device_id), [1]);
});

test('is null-safe for an empty or missing summary', () => {
  assert.deepEqual(mapScrutinyDevices(undefined), []);
  assert.deepEqual(mapScrutinyDevices(null), []);
  assert.deepEqual(mapScrutinyDevices({}), []);
});
