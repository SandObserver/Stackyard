const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('glances'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBase } = require('../src/widget-data');
const { dispatchProvider } = require('../src/provider-dispatch');
const { errorParts, runtimeCtx } = require('../test-support/widget-ctx');
const { glancesStub } = require('../test-support/glances-stub');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'system-summary', 'data.js'));
const { serviceBase, serviceLink } = require('../../ui/js/service-link.js');

/* Field names from the Glances 4 API documentation (docs/api.rst). */
const PLUGINS = {
  cpu: { total: 12.5, iowait: 3.5, idle: 84 },
  mem: { percent: 61.5, total: 16000000000 },
  fs: [
    { mnt_point: '/', percent: 30, size: 512 * 1024 ** 3 },
    { mnt_point: '/mnt/data', percent: 80, size: 2048 * 1024 ** 3 },
  ],
  sensors: [
    { label: 'Package id 0', value: 47, unit: 'C', type: 'temperature_core' },
    { label: 'Fan 1', value: 1200, unit: 'R', type: 'fan_speed' },
  ],
  processcount: { total: 412, running: 2 },
  uptime: '7 days, 20:30:06',
};

let stub;
before(async () => {
  stub = await glancesStub(PLUGINS);
});
after(() => stub.close());

/* Each test names its own host, so the remembered API version of one does not
   leak into another. */
function ctxFor(host, extra = {}, { serves = [4], unauthorized = false, endpoint = 'system' } = {}) {
  const config = withGlances({ glancesUrl: stub.url(host, { serves, unauthorized }), ...extra });
  const from = stub.urls.length;
  return { ctx: runtimeCtx(config, endpoint), urls: () => stub.urls.slice(from) };
}

const withGlances = (extra = {}) => ({
  statProvider: 'glances',
  slots: [{ type: 'cpu' }, { type: 'ram' }, { type: 'disk', primary: '/', secondary: '/mnt/data' }],
  ...extra,
});

const plugin = u => u.split('/').pop();

test('every slot type maps to the shape the widget already renders', async () => {
  const { ctx } = ctxFor('slots', {
    slots: [
      { type: 'disk', primary: '/', secondary: '/mnt/data' },
      { type: 'temp', sensor: 'Package id 0' },
      { type: 'procs' },
    ],
  });
  const r = await dataFn(ctx);
  assert.equal(r.cpu, 12.5);
  assert.equal(r.ram, 61.5);
  assert.equal(r.iowait, 3.5);
  assert.equal(r.procs, 412);
  assert.equal(r.uptime, 7 * 86400 + 20 * 3600 + 30 * 60 + 6);
  assert.deepEqual(r.temps, { 'Package id 0': 47 });
  assert.deepEqual(r.disks, [
    { mount: '/', usedPct: 30, totalGb: 512 },
    { mount: '/mnt/data', usedPct: 80, totalGb: 2048 },
  ]);
});

test('a mount the host does not report reads as empty rather than missing', async () => {
  const { ctx } = ctxFor('mount', { slots: [{ type: 'disk', primary: '/nope' }] });
  const r = await dataFn(ctx);
  assert.deepEqual(r.disks, [{ mount: '/nope', usedPct: 0, totalGb: 0 }]);
});

test('a plugin is only fetched when a slot asks for it', async () => {
  const { ctx, urls } = ctxFor('only', { slots: [{ type: 'cpu' }, { type: 'ram' }] });
  await dataFn(ctx);
  assert.deepEqual([...new Set(urls().map(plugin))].sort(), ['cpu', 'mem', 'uptime']);
});

test('version 4 is used when it answers, and only probed once per URL', async () => {
  const { ctx, urls } = ctxFor('v4-host');
  await dataFn(ctx);
  const first = urls();
  assert.ok(
    first.every(u => u.includes('/api/4/')),
    'a host answering v4 should never be asked for v3',
  );
  await dataFn(ctx);
  const second = urls().length - first.length;
  assert.equal(first.length, second + 1, 'only the first poll pays for the probe');
});

test('a version 3 host is found by falling back, then remembered', async () => {
  const { ctx, urls } = ctxFor('v3-host', {}, { serves: [3] });
  const r = await dataFn(ctx);
  assert.equal(r.cpu, 12.5);
  assert.equal(urls().filter(u => u.includes('/api/4/')).length, 1, 'v4 is probed once');
  const seen = urls().length;
  await dataFn(ctx);
  assert.equal(
    urls()
      .slice(seen)
      .filter(u => u.includes('/api/4/')).length,
    0,
    'the remembered version skips the failed probe',
  );
});

test('basic auth is sent only when a credential is set', async () => {
  const from = stub.headers.length;
  await dataFn(ctxFor('auth', { glancesUser: 'admin', glancesPass: 'pw' }).ctx);
  const sent = stub.headers.slice(from);
  assert.ok(sent.length > 0);
  for (const h of sent) assert.equal(h.authorization, 'Basic ' + Buffer.from('admin:pw').toString('base64'));

  const plainFrom = stub.headers.length;
  await dataFn(ctxFor('noauth').ctx);
  for (const h of stub.headers.slice(plainFrom)) assert.equal(h.authorization, undefined);
});

test('a rejected credential is reported as an auth failure, not a bad host', async () => {
  const { ctx } = ctxFor('locked', {}, { unauthorized: true });
  await assert.rejects(dataFn(ctx), e => {
    assert.match(e.message, /401/);
    assert.equal(e.kind, 'auth');
    return true;
  });
});

test('a host answering neither version reports the upstream status', async () => {
  const { ctx } = ctxFor('dead', {}, { serves: [] });
  await assert.rejects(dataFn(ctx), /Glances HTTP 404/);
});

test('a missing URL is reported as a configuration problem', async () => {
  const ctx = runtimeCtx({ statProvider: 'glances', slots: [] }, 'system');
  await assert.rejects(dataFn(ctx), e => {
    assert.equal(e.kind, 'invalid');
    return true;
  });
});

test('the sensor picker offers the temperature sensors and nothing else', async () => {
  const { ctx } = ctxFor('sensors', {}, { endpoint: 'sensors' });
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, [{ value: 'Package id 0', label: 'Package id 0' }]);
});

test('the uptime string is read in both forms Glances returns', async () => {
  const { ctx } = ctxFor('up');
  const cases = { '1:27:01': 5221, '7 days, 20:30:06': 678606, '1 day, 0:00:00': 86400, nonsense: null };
  try {
    for (const [text, want] of Object.entries(cases)) {
      PLUGINS.uptime = text;
      const r = await dataFn(ctx);
      assert.equal(r.uptime, want, text);
    }
  } finally {
    PLUGINS.uptime = '7 days, 20:30:06';
  }
});

test('the local source is still the default when no provider is saved', async () => {
  const metrics = {
    cpuSample: async () => ({ cpu: 5, iowait: 1 }),
    ramPercent: () => 50,
    cpuTemp: () => 40,
    diskStats: () => ({ usedPct: 10, totalGb: 100 }),
    procCount: () => 200,
    uptimeSeconds: () => 60,
  };
  const ctx = {
    endpoint: 'system',
    config: { slots: [{ type: 'cpu' }] },
    settings: {},
    metrics,
    normalizeBase,
    serviceBase,
    serviceLink,
    ...errorParts(),
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  const r = await dataFn(ctx);
  assert.equal(r.cpu, 5);
  assert.equal(r.procs, 200);
});
