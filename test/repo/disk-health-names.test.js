const { test } = require('node:test');
const assert = require('node:assert/strict');

const widget = require('../../ui/widgets/disk-health/data.js');

const summary = {
  a: {
    device: { device_id: 'a', friendly_name: 'Parity', model_name: 'WD Red', device_name: 'sda', device_status: 0 },
  },
  b: { device: { device_id: 'b', friendly_name: '', model_name: 'WD Blue', device_name: 'sdb', device_status: 0 } },
};

test('the device list uses a friendly name and falls back to the model', async () => {
  const ctx = {
    endpoint: 'devices',
    config: { diskProvider: 'scrutiny', scrutinyUrl: 'http://scrutiny' },
    KIND: {},
    normalizeBase: url => url,
    fail: message => {
      throw new Error(message);
    },
    fetchJSON: async () => ({ status: 200, data: { data: { summary } } }),
  };
  ctx.dispatchProvider = handlers => handlers.scrutiny(ctx);
  const { options } = await widget(ctx);
  assert.deepEqual(
    options.map(o => o.label),
    ['Parity', 'WD Blue'],
  );
});

test('the card uses a friendly name and falls back to the model', async () => {
  const ctx = {
    endpoint: 'health',
    config: { diskProvider: 'scrutiny', scrutinyUrl: 'http://scrutiny', bays: ['a', 'b'] },
    KIND: {},
    normalizeBase: url => url,
    serviceLink: url => url,
    fail: message => {
      throw new Error(message);
    },
    fetchJSON: async () => ({ status: 200, data: { data: { summary } } }),
  };
  ctx.dispatchProvider = handlers => handlers.scrutiny(ctx);
  const { bays } = await widget(ctx);
  assert.deepEqual(
    bays.map(b => b.model_name),
    ['Parity', 'WD Blue'],
  );
});
