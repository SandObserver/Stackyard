const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');
const { dispatchProvider } = require('../src/provider-dispatch');
const { errorParts } = require('../test-support/widget-ctx');
const { fakeJsonRpc, denied, refusedUpgrade } = require('../test-support/fake-json-rpc');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'system-summary', 'data.js'));
const { serviceBase, serviceLink } = require('../../ui/js/service-link.js');

const GB = 1024 ** 3;
const KEY = '1-Qm9vdGVkVGhlS2V5';

const REALTIME = {
  collection: 'reporting.realtime',
  fields: {
    cpu: { cpu: { usage: 12.5, temp: null }, cpu0: { usage: 10, temp: 41 }, cpu1: { usage: 15, temp: 47 } },
    memory: { physical_memory_total: 32 * GB, physical_memory_available: 12 * GB, arc_size: 12 * GB },
  },
};

const METHODS = {
  'auth.login_with_api_key': ([key]) => key === KEY,
  'pool.query': [{ name: 'tank' }, { name: 'backup' }],
  'pool.dataset.query': ([[[, , names]]]) =>
    [
      { id: 'tank', used: { parsed: 3 * 1024 * GB }, available: { parsed: 1024 * GB } },
      { id: 'backup', used: { parsed: 100 * GB }, available: { parsed: 900 * GB } },
    ].filter(d => names.includes(d.id)),
  'system.info': { uptime_seconds: 90061.34, uptime: '1 day, 1:01:01.340005' },
};

function ctxFor(config = {}, methods = METHODS, events = { 'reporting.realtime': REALTIME }) {
  const rpc = fakeJsonRpc(methods, events);
  const ctx = {
    endpoint: 'system',
    config: {
      statProvider: 'truenas',
      truenasUrl: 'truenas.local',
      truenasKey: KEY,
      slots: [{ type: 'cpu' }, { type: 'ram' }, { type: 'disk', primary: 'tank', secondary: 'backup' }],
      ...config,
    },
    normalizeBase,
    serviceBase,
    serviceLink,
    jsonRpc: typeof methods === 'function' ? methods : rpc.jsonRpc,
    fetchJSON: async () => assert.fail('TrueNAS stats never use REST'),
    ...errorParts(),
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return { ctx, ...rpc };
}

test('a bare address gets https and the WebSocket API path', async () => {
  const { ctx, opened } = ctxFor({ truenasSkipTls: true });
  await dataFn(ctx);
  assert.equal(opened[0].url, 'https://truenas.local/api/current');
  assert.equal(opened[0].opts.skipTls, true);
});

test('an http address is refused before the key is sent', async () => {
  const { ctx, opened } = ctxFor({ truenasUrl: 'http://truenas.local' });
  await assert.rejects(
    () => dataFn(ctx),
    e => e.kind === 'invalid' && /https/.test(e.message),
  );
  assert.equal(opened.length, 0);
});

test('CPU, memory without the ZFS cache, and temperature come from the realtime event', async () => {
  const { ctx } = ctxFor({ slots: [{ type: 'cpu' }, { type: 'ram' }, { type: 'temp' }] });
  const r = await dataFn(ctx);
  assert.equal(r.cpu, 12.5);
  assert.equal(r.ram, 25);
  assert.equal(r.temp, 47);
  assert.deepEqual(r.temps, { 0: 47 });
  assert.equal(r.iowait, null);
  assert.equal(r.procs, null);
});

test('the package temperature wins over the hottest core when TrueNAS sends one', async () => {
  const event = structuredClone(REALTIME);
  event.fields.cpu.cpu.temp = 44;
  const { ctx } = ctxFor({}, METHODS, { 'reporting.realtime': event });
  assert.equal((await dataFn(ctx)).temp, 44);
});

test('a pool slot reads its top dataset, used against used plus available', async () => {
  const { ctx } = ctxFor();
  const r = await dataFn(ctx);
  assert.deepEqual(r.disks, [
    { mount: 'tank', usedPct: 75, totalGb: 4096 },
    { mount: 'backup', usedPct: 10, totalGb: 1000 },
  ]);
});

test('an empty pool slot reports as / and reads the first pool', async () => {
  const { ctx, calls } = ctxFor({ slots: [{ type: 'cpu' }, { type: 'ram' }, { type: 'disk', primary: '' }] });
  const r = await dataFn(ctx);
  assert.deepEqual(r.disks, [{ mount: '/', usedPct: 75, totalGb: 4096 }]);
  assert.ok(calls.some(c => c.method === 'pool.query'));
});

test('a pool that does not exist reads as empty, like the other sources', async () => {
  const { ctx } = ctxFor({ slots: [{ type: 'disk', primary: 'nope' }, { type: 'cpu' }, { type: 'ram' }] });
  assert.deepEqual((await dataFn(ctx)).disks, [{ mount: 'nope', usedPct: 0, totalGb: 0 }]);
});

test('no disk slot asks for no pool data', async () => {
  const { ctx, calls } = ctxFor({ slots: [{ type: 'cpu' }, { type: 'ram' }, { type: 'temp' }] });
  await dataFn(ctx);
  assert.ok(!calls.some(c => c.method.startsWith('pool.')));
});

test('uptime is read only when the network row shows it', async () => {
  const off = ctxFor();
  assert.equal((await dataFn(off.ctx)).uptime, null);
  assert.ok(!off.calls.some(c => c.method === 'system.info'));

  const on = ctxFor({ network: { enabled: true, mode: 'uptime' } });
  assert.equal((await dataFn(on.ctx)).uptime, 90061);
});

test('uptime stays empty when the key lacks the read-only admin role', async () => {
  const methods = {
    ...METHODS,
    'system.info': () => {
      throw denied();
    },
  };
  const { ctx } = ctxFor({ network: { enabled: true, mode: 'uptime' } }, methods);
  const r = await dataFn(ctx);
  assert.equal(r.uptime, null);
  assert.equal(r.cpu, 12.5);
});

test('a refused key is an auth error', async () => {
  const { ctx, calls } = ctxFor({ truenasKey: '1-wrong' });
  await assert.rejects(
    () => dataFn(ctx),
    e => e.kind === 'auth' && /refused the API key/.test(e.message),
  );
  assert.deepEqual(
    calls.map(c => c.method),
    ['auth.login_with_api_key'],
  );
});

test('a key without the reporting role names the roles it needs', async () => {
  const methods = {
    ...METHODS,
    'core.subscribe': () => {
      throw denied();
    },
  };
  const { ctx } = ctxFor({}, methods, {});
  await assert.rejects(
    () => dataFn(ctx),
    e => e.kind === 'auth' && /REPORTING_READ, POOL_READ and DATASET_READ roles/.test(e.message),
  );
});

test('a server with no WebSocket API is named as too old or not TrueNAS', async () => {
  const { ctx } = ctxFor({}, async () => {
    throw refusedUpgrade(404);
  });
  await assert.rejects(
    () => dataFn(ctx),
    e => /not TrueNAS 25\.04 or later/.test(e.message),
  );
});

test('the tile links to the TrueNAS address', async () => {
  const { ctx } = ctxFor();
  assert.equal((await dataFn(ctx)).link, 'https://truenas.local');
});
