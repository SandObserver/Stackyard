const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { dispatchProvider } = require(path.join(__dirname, '..', 'src', 'provider-dispatch.js'));
const { normalizeBase } = require(path.join(__dirname, '..', 'src', 'widget-data.js'));

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'disk-health', 'data.js'));
const { serviceBase, serviceLink } = require('../../ui/js/service-link.js');

const KIND = { INVALID: 'invalid', AUTH: 'auth' };

function makeCtx(endpoint, config, fetchJSON) {
  const ctx = {
    endpoint,
    config,
    fetchJSON,
    normalizeBase,
    serviceBase,
    serviceLink,
    KIND,
    fail: (message, opts) => {
      const e = new Error(message);
      e.kind = opts?.kind;
      throw e;
    },
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return ctx;
}

/* One device, as each Scrutiny build describes it. */
const FORK = { '2f18a4f8-9ae8': { device: { device_id: '2f18a4f8-9ae8', model_name: 'WD Red', wwn: '0x5001' } } };
const ORIGINAL_UUID = { 'a1b2-c3d4': { device: { scrutiny_uuid: 'a1b2-c3d4', model_name: 'WD Red', wwn: '0x5001' } } };
const ORIGINAL_WWN = { '0x5001': { device: { wwn: '0x5001', model_name: 'WD Red' } } };
const NO_ID = { 'key-only': { device: { model_name: 'WD Red' } } };

const summaryFetch = summary => async () => ({ status: 200, data: { data: { summary } } });

for (const [name, summary, expected] of [
  ['the fork, which sends device_id', FORK, '2f18a4f8-9ae8'],
  ['the original from 0.9.0, which sends scrutiny_uuid', ORIGINAL_UUID, 'a1b2-c3d4'],
  ['the original before 0.9.0, which sends wwn', ORIGINAL_WWN, '0x5001'],
  ['a build that sends no identifier field', NO_ID, 'key-only'],
]) {
  test(`the bay picker offers a device from ${name}`, async () => {
    const ctx = makeCtx('devices', { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local' }, summaryFetch(summary));
    const r = await dataFn(ctx);
    assert.deepEqual(r.options, [{ value: expected, label: 'WD Red' }]);
  });

  test(`a configured bay resolves against ${name}`, async () => {
    const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: [expected] };
    const r = await dataFn(makeCtx('', config, summaryFetch(summary)));
    assert.equal(r.bays[0].device_id, expected);
    assert.equal(r.bays[0].error, undefined);
    assert.equal(r.bays[0].model_name, 'WD Red');
  });
}

test('device_id wins when a build sends more than one identifier', async () => {
  const summary = { key: { device: { device_id: 'the-id', scrutiny_uuid: 'the-uuid', wwn: '0x1', model_name: 'D' } } };
  const ctx = makeCtx('devices', { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local' }, summaryFetch(summary));
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, [{ value: 'the-id', label: 'D' }]);
});

test('a bay that no device matches is reported as not found', async () => {
  const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['gone'] };
  const r = await dataFn(makeCtx('', config, summaryFetch(FORK)));
  assert.equal(r.bays[0].error, 'not found');
  assert.equal(r.bays[0].device_status, 0);
});

test('a bay saved as a wwn still resolves once the server sends a scrutiny_uuid', async () => {
  const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['0x5001'] };
  const r = await dataFn(makeCtx('', config, summaryFetch(ORIGINAL_UUID)));
  assert.equal(r.bays[0].error, undefined, 'the disk was not found by its older identifier');
  assert.equal(r.bays[0].model_name, 'WD Red');
});

test('a bay saved as a wwn still resolves against the fork, which prefers device_id', async () => {
  const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['0x5001'] };
  const r = await dataFn(makeCtx('', config, summaryFetch(FORK)));
  assert.equal(r.bays[0].error, undefined);
  assert.equal(r.bays[0].model_name, 'WD Red');
});

test("one disk's alternate identifier never shadows another disk's preferred one", async () => {
  const summary = {
    a: { device: { device_id: 'shared', model_name: 'Disk A' } },
    b: { device: { device_id: 'b-id', wwn: 'shared', model_name: 'Disk B' } },
  };
  const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['shared', 'b-id'] };
  const r = await dataFn(makeCtx('', config, summaryFetch(summary)));
  assert.equal(r.bays[0].model_name, 'Disk A');
  assert.equal(r.bays[1].model_name, 'Disk B');
});

for (const [status, kind, match] of [
  [401, 'auth', /auth failed/],
  [403, 'auth', /auth failed/],
  [500, undefined, /Scrutiny HTTP 500/],
]) {
  test(`the bay list reports HTTP ${status} instead of an empty summary`, async () => {
    const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['x'] };
    await assert.rejects(
      () => dataFn(makeCtx('', config, async () => ({ status, data: {} }))),
      e => match.test(e.message) && e.kind === kind,
    );
  });

  test(`the bay picker reports HTTP ${status}`, async () => {
    const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local' };
    await assert.rejects(
      () => dataFn(makeCtx('devices', config, async () => ({ status, data: {} }))),
      e => match.test(e.message) && e.kind === kind,
    );
  });
}

test('an entry carrying no device object is skipped', async () => {
  const summary = { a: {}, b: { device: { device_id: 'b1', model_name: 'D' } } };
  const ctx = makeCtx('devices', { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local' }, summaryFetch(summary));
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, [{ value: 'b1', label: 'D' }]);
});

for (const [status, failed] of [
  [0, false],
  [1, true],
  [2, true],
  [3, true],
]) {
  test(`Scrutiny status ${status} is ${failed ? 'a failed' : 'a healthy'} drive`, async () => {
    const summary = { d: { device: { device_id: 'd', device_status: status }, smart: { temp: 30 } } };
    const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['d'] };
    const [bay] = (await dataFn(makeCtx('', config, summaryFetch(summary)))).bays;
    assert.equal(bay.hasSmart, true);
    assert.equal(bay.device_status, failed ? 2 : 0);
  });
}

for (const status of ['2', 4.5, -1, null, undefined]) {
  test(`Scrutiny status ${JSON.stringify(status)} is not read as healthy`, async () => {
    const summary = { d: { device: { device_id: 'd', device_status: status }, smart: { temp: 30 } } };
    const config = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: ['d'] };
    const [bay] = (await dataFn(makeCtx('', config, summaryFetch(summary)))).bays;
    assert.equal(bay.hasSmart, false);
  });
}

test('with no link set the widget opens the Scrutiny address the browser can reach', async () => {
  const run = (scrutinyUrl, extra = {}) =>
    dataFn(makeCtx(undefined, { diskProvider: 'scrutiny', scrutinyUrl, bays: [], ...extra }, summaryFetch(FORK)));
  assert.equal((await run('http://10.0.0.5:8080')).href, 'http://10.0.0.5:8080');
  assert.equal((await run('http://scrutiny:8080')).href, '');
  assert.equal(
    (await run('http://10.0.0.5:8080', { scrutinyHref: 'https://disks.example.com' })).href,
    'https://disks.example.com',
  );
});

for (const endpoint of ['', 'devices']) {
  test(`${endpoint || 'the bay list'} sends the Scrutiny token as a Bearer header only when one is set`, async () => {
    const seen = [];
    const fetchJSON = async (url, opts) => {
      seen.push(opts.headers);
      return { status: 200, data: { data: { summary: FORK } } };
    };
    const base = { diskProvider: 'scrutiny', scrutinyUrl: 'http://s.local', bays: [] };
    await dataFn(makeCtx(endpoint, { ...base, scrutinyToken: 'tok' }, fetchJSON));
    await dataFn(makeCtx(endpoint, base, fetchJSON));
    assert.deepEqual(seen, [{ Authorization: 'Bearer tok' }, {}]);
  });
}

const UNRAID = { diskProvider: 'unraid', unraidUrl: 'http://tower.local', unraidApiKey: 'key' };

const unraidSlot = (name, status, extra = {}) => ({
  name,
  device: 'sd' + name.at(-1),
  size: 1000,
  status,
  temp: 30,
  ...extra,
});

function unraidFetch(array, seen = []) {
  return async (url, opts) => {
    seen.push({ url, opts });
    return { status: 200, data: { data: { array } } };
  };
}

test('the Unraid bay picker lists parity, data and cache drives and skips unassigned slots', async () => {
  const array = {
    parities: [unraidSlot('parity', 'DISK_OK')],
    disks: [unraidSlot('disk1', 'DISK_OK'), { name: 'disk2', device: '', status: 'DISK_NP' }],
    caches: [unraidSlot('cache', 'DISK_OK', { device: 'nvme0n1' })],
  };
  const r = await dataFn(makeCtx('devices', UNRAID, unraidFetch(array)));
  assert.deepEqual(r.options, [
    { value: 'parity', label: 'parity (sdy)' },
    { value: 'disk1', label: 'disk1 (sd1)' },
    { value: 'cache', label: 'cache (nvme0n1)' },
  ]);
});

for (const endpoint of ['', 'devices']) {
  test(`${endpoint || 'the bay list'} posts the array query to Unraid with the key`, async () => {
    const seen = [];
    await dataFn(makeCtx(endpoint, { ...UNRAID, bays: [] }, unraidFetch({}, seen)));
    assert.equal(seen[0].url, 'http://tower.local/graphql');
    assert.equal(seen[0].opts.method, 'POST');
    assert.equal(seen[0].opts.headers['x-api-key'], 'key');
    assert.match(JSON.parse(seen[0].opts.body).query, /array \{ parities/);
  });
}

for (const [status, health] of [
  ['DISK_OK', 'healthy'],
  ['DISK_NEW', 'healthy'],
  ['DISK_INVALID', 'failed'],
  ['DISK_WRONG', 'failed'],
  ['DISK_DSBL', 'failed'],
  ['DISK_DSBL_NEW', 'failed'],
  ['SOMETHING_NEW', 'unknown'],
  [null, 'unknown'],
]) {
  test(`Unraid state ${status} is a ${health} drive`, async () => {
    const array = { disks: [unraidSlot('disk1', status)] };
    const [bay] = (await dataFn(makeCtx('', { ...UNRAID, bays: ['disk1'] }, unraidFetch(array)))).bays;
    assert.equal(bay.hasSmart, health !== 'unknown');
    if (health !== 'unknown') assert.equal(bay.device_status, health === 'failed' ? 2 : 0);
  });
}

test('an Unraid drive reports its size in bytes and no temperature while spun down', async () => {
  const array = { disks: [unraidSlot('disk1', 'DISK_OK', { size: 1953514552, temp: null })] };
  const [bay] = (await dataFn(makeCtx('', { ...UNRAID, bays: ['disk1'] }, unraidFetch(array)))).bays;
  assert.equal(bay.capacity, 1953514552 * 1024);
  assert.equal(bay.temp, null);
  assert.equal(bay.device_name, 'disk1');
});

test('an Unraid bay left out of the reply is a failed drive, as Unraid omits a missing drive', async () => {
  const array = { disks: [unraidSlot('disk1', 'DISK_OK')] };
  const [, bay] = (await dataFn(makeCtx('', { ...UNRAID, bays: ['disk1', 'disk2'] }, unraidFetch(array)))).bays;
  assert.equal(bay.error, undefined);
  assert.equal(bay.hasSmart, true);
  assert.equal(bay.device_status, 2);
  assert.equal(bay.device_name, 'disk2');
});

test('a key without array access is reported as an auth failure', async () => {
  const fetchJSON = async () => ({
    status: 200,
    data: { errors: [{ message: 'Forbidden resource', extensions: { code: 'FORBIDDEN' } }], data: null },
  });
  await assert.rejects(dataFn(makeCtx('', { ...UNRAID, bays: ['disk1'] }, fetchJSON)), { kind: 'auth' });
});

test('the Unraid picker asks for the key before calling the server', async () => {
  let called = false;
  const fetchJSON = async () => {
    called = true;
  };
  await assert.rejects(dataFn(makeCtx('devices', { ...UNRAID, unraidApiKey: '' }, fetchJSON)), {
    kind: 'invalid',
    message: 'Enter the Unraid API key first.',
  });
  assert.equal(called, false);
});

test('with no link set the widget opens the Unraid address the browser can reach', async () => {
  const r = await dataFn(makeCtx('', { ...UNRAID, unraidUrl: 'http://10.0.0.9', bays: [] }, unraidFetch({})));
  assert.equal(r.href, 'http://10.0.0.9');
  assert.equal(r.provider, 'unraid');
});

const { fakeJsonRpc, refusedUpgrade } = require('../test-support/fake-json-rpc');

const TRUENAS_KEY = '1-Qm9vdGVkVGhlS2V5';
const POOLS = [
  { name: 'tank', healthy: true, size: 4000 },
  { name: 'backup', healthy: false, size: 1000 },
];

function truenasCtx(endpoint, config, { methods, jsonRpc, rest } = {}) {
  const rpc = fakeJsonRpc(
    methods || { 'auth.login_with_api_key': ([key]) => key === TRUENAS_KEY, 'pool.query': POOLS },
  );
  const fetched = [];
  const ctx = makeCtx(
    endpoint,
    { diskProvider: 'truenas', truenasUrl: 'nas.local', truenasKey: TRUENAS_KEY, ...config },
    async (url, opts) => {
      fetched.push({ url, opts });
      return rest ? rest(url) : { status: 404, data: null };
    },
  );
  ctx.jsonRpc = jsonRpc || rpc.jsonRpc;
  return { ctx, fetched, ...rpc };
}

test('TrueNAS pools are read over the WebSocket API at an https address', async () => {
  const { ctx, opened, fetched } = truenasCtx('', { bays: ['tank', 'backup'], truenasSkipTls: true });
  const r = await dataFn(ctx);
  assert.equal(opened[0].url, 'https://nas.local/api/current');
  assert.equal(opened[0].opts.skipTls, true);
  assert.equal(fetched.length, 0);
  assert.deepEqual(
    r.bays.map(b => [b.device_id, b.device_status]),
    [
      ['tank', 0],
      ['backup', 2],
    ],
  );
  assert.equal(r.href, 'https://nas.local');
});

test('the TrueNAS bay picker lists pools from the WebSocket API', async () => {
  const { ctx } = truenasCtx('devices', {});
  assert.deepEqual((await dataFn(ctx)).options, [
    { value: 'tank', label: 'tank' },
    { value: 'backup', label: 'backup' },
  ]);
});

test('an http TrueNAS address is refused before the key is sent', async () => {
  const { ctx, opened, fetched } = truenasCtx('', { truenasUrl: 'http://nas.local', bays: ['tank'] });
  await assert.rejects(
    () => dataFn(ctx),
    e => e.kind === 'invalid' && /https/.test(e.message),
  );
  assert.equal(opened.length + fetched.length, 0);
});

test('a refused TrueNAS key is an auth error and REST is not tried', async () => {
  const { ctx, fetched } = truenasCtx('', { truenasKey: '1-wrong', bays: ['tank'] });
  await assert.rejects(
    () => dataFn(ctx),
    e => e.kind === 'auth',
  );
  assert.equal(fetched.length, 0);
});

test('TrueNAS before 25.04 falls back to REST with the same key', async () => {
  const { ctx, fetched } = truenasCtx(
    '',
    { bays: ['tank'] },
    {
      jsonRpc: async () => {
        throw refusedUpgrade(404);
      },
      rest: () => ({ status: 200, data: POOLS }),
    },
  );
  const r = await dataFn(ctx);
  assert.equal(fetched[0].url, 'https://nas.local/api/v2.0/pool');
  assert.equal(fetched[0].opts.headers.Authorization, 'Bearer ' + TRUENAS_KEY);
  assert.equal(r.bays[0].device_status, 0);
});

test('a network failure on the WebSocket API does not fall back to REST', async () => {
  const { ctx, fetched } = truenasCtx(
    '',
    { bays: ['tank'] },
    {
      jsonRpc: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      },
    },
  );
  await assert.rejects(
    () => dataFn(ctx),
    e => e.code === 'ECONNREFUSED',
  );
  assert.equal(fetched.length, 0);
});

test('an address with neither TrueNAS API is named as not TrueNAS', async () => {
  const { ctx } = truenasCtx(
    '',
    { bays: ['tank'] },
    {
      jsonRpc: async () => {
        throw refusedUpgrade(404);
      },
    },
  );
  await assert.rejects(
    () => dataFn(ctx),
    e => /not TrueNAS/.test(e.message),
  );
});

test('a TrueNAS pool that is gone reads as not found', async () => {
  const { ctx } = truenasCtx('', { bays: ['gone'] });
  assert.equal((await dataFn(ctx)).bays[0].error, 'not found');
});
