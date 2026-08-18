const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');
const { dispatchProvider } = require('../src/provider-dispatch');
const { errorParts } = require('../test-support/widget-ctx');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'system-summary', 'data.js'));

const BOOTED = '2026-08-15T00:00:00.000Z';

const REPLY = {
  metrics: {
    cpu: { percentTotal: 18.5 },
    memory: { percentTotal: 55.25 },
    temperature: {
      sensors: [
        { name: 'CPU Package', current: { value: 51, unit: 'CELSIUS' } },
        { name: 'Motherboard', current: { value: 104, unit: 'FAHRENHEIT' } },
      ],
    },
  },
  info: { os: { uptime: BOOTED } },
  shares: [
    { name: 'media', size: 8 * 1024 ** 2, used: 2 * 1024 ** 2 },
    { name: 'appdata', size: 1024 ** 2, used: 1024 ** 2 / 4 },
  ],
  array: { capacity: { kilobytes: { total: 20 * 1024 ** 2, used: 5 * 1024 ** 2 } } },
};

function ctxFor(config, reply = { status: 200, data: { data: REPLY } }, endpoint = 'system') {
  const sent = [];
  const ctx = {
    endpoint,
    config: { statProvider: 'unraid', unraidUrl: 'tower.local', unraidApiKey: 'KEY', ...config },
    normalizeBase,
    fetchJSON: async (url, opts) => {
      sent.push({ url, opts, query: JSON.parse(opts.body || '{}').query || '' });
      return typeof reply === 'function' ? reply(sent.at(-1)) : reply;
    },
    ...errorParts(),
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return { ctx, sent };
}

const SLOTS = [
  { type: 'cpu' },
  { type: 'temp', sensor: 'CPU Package' },
  { type: 'disk', primary: 'media', secondary: '' },
];

test('the request is a POST to /graphql carrying the key', async () => {
  const { ctx, sent } = ctxFor({ slots: SLOTS });
  await dataFn(ctx);
  assert.equal(sent[0].url, 'http://tower.local/graphql');
  assert.equal(sent[0].opts.method, 'POST');
  assert.equal(sent[0].opts.headers['x-api-key'], 'KEY');
});

test('the metrics map onto the shape the widget already renders', async () => {
  const { ctx } = ctxFor({ slots: SLOTS });
  const r = await dataFn(ctx);
  assert.equal(r.cpu, 18.5);
  assert.equal(r.ram, 55.25);
  assert.equal(r.iowait, null, 'Unraid reports no IO wait');
  assert.equal(r.procs, null, 'Unraid reports no process count');
  assert.equal(r.temps['CPU Package'], 51);
  assert.equal(r.temps.Motherboard, 40, 'a Fahrenheit sensor is converted');
});

test('a named slot reads a share and a blank one reads the whole array', async () => {
  const { ctx } = ctxFor({ slots: [{ type: 'disk', primary: 'media', secondary: 'appdata' }, { type: 'disk' }] });
  const r = await dataFn(ctx);
  assert.deepEqual(r.disks, [
    { mount: 'media', usedPct: 25, totalGb: 8 },
    { mount: 'appdata', usedPct: 25, totalGb: 1 },
    { mount: '', usedPct: 25, totalGb: 20 },
  ]);
});

test('boot time becomes an elapsed uptime', async () => {
  const { ctx } = ctxFor({ slots: SLOTS });
  const r = await dataFn(ctx);
  const expected = Math.round((Date.now() - Date.parse(BOOTED)) / 1000);
  assert.ok(Math.abs(r.uptime - expected) <= 1, `${r.uptime} should be about ${expected}`);
});

test('shares and the array are only asked for when a slot needs them', async () => {
  const { ctx, sent } = ctxFor({ slots: [{ type: 'cpu' }, { type: 'ram' }] });
  await dataFn(ctx);
  assert.doesNotMatch(sent[0].query, /shares/);
  assert.doesNotMatch(sent[0].query, /array/);
  assert.doesNotMatch(sent[0].query, /temperature/, 'nor the temperature block');

  const withDisk = ctxFor({ slots: [{ type: 'disk', primary: 'media' }] });
  await dataFn(withDisk.ctx);
  assert.match(withDisk.sent[0].query, /shares/);
  assert.doesNotMatch(withDisk.sent[0].query, /array/);
});

test('a GraphQL error is reported as written, and a permission problem as an auth failure', async () => {
  const denied = ctxFor({ slots: SLOTS }, { status: 200, data: { errors: [{ message: 'Forbidden resource' }] } });
  await assert.rejects(dataFn(denied.ctx), e => {
    assert.equal(e.kind, 'auth');
    assert.match(e.message, /Forbidden resource/);
    return true;
  });

  const broken = ctxFor({ slots: SLOTS }, { status: 200, data: { errors: [{ message: 'Cannot query field' }] } });
  await assert.rejects(dataFn(broken.ctx), e => {
    assert.equal(e.kind, 'upstream');
    return true;
  });
});

test('a refused key is an auth failure', async () => {
  const { ctx } = ctxFor({ slots: SLOTS }, { status: 401, data: null });
  await assert.rejects(dataFn(ctx), e => {
    assert.equal(e.kind, 'auth');
    return true;
  });
});

test('the connection details are required before anything is sent', async () => {
  for (const config of [{ unraidUrl: '' }, { unraidApiKey: '' }]) {
    const { ctx, sent } = ctxFor({ slots: SLOTS, ...config });
    await assert.rejects(dataFn(ctx), e => {
      assert.equal(e.kind, 'invalid');
      return true;
    });
    assert.equal(sent.length, 0);
  }
});

test('the sensor picker offers the named sensors', async () => {
  const { ctx } = ctxFor({ slots: SLOTS }, undefined, 'sensors');
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, [
    { value: 'CPU Package', label: 'CPU Package' },
    { value: 'Motherboard', label: 'Motherboard' },
  ]);
});

/* Unraid ships temperature reporting off and answers with null rather than an
   error, so an empty picker would read as a broken key. */
test('temperature reporting left off is named rather than shown as no sensors', async () => {
  const { ctx } = ctxFor(
    { slots: SLOTS },
    { status: 200, data: { data: { metrics: { temperature: null } } } },
    'sensors',
  );
  await assert.rejects(dataFn(ctx), e => {
    assert.equal(e.kind, 'invalid');
    assert.match(e.message, /Turn on temperature reporting/);
    return true;
  });
});

test('a temperature slot still renders when reporting is off', async () => {
  const reply = {
    status: 200,
    data: { data: { metrics: { cpu: { percentTotal: 1 }, temperature: null }, info: { os: {} } } },
  };
  const { ctx } = ctxFor({ slots: [{ type: 'temp', sensor: 'CPU Package' }] }, reply);
  const r = await dataFn(ctx);
  assert.deepEqual(r.temps, {});
  assert.equal(r.uptime, null);
});
