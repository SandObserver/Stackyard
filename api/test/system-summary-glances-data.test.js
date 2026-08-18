const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');
const { dispatchProvider } = require('../src/provider-dispatch');
const { errorParts } = require('../test-support/widget-ctx');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'system-summary', 'data.js'));

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

/* Serves the plugin fixtures at whichever API version the caller probes,
   recording every URL so the version fallback can be asserted. */
function ctxFor(config, { serves = [4], endpoint = 'system' } = {}) {
  const urls = [];
  const ctx = {
    endpoint,
    config,
    normalizeBase,
    fetchJSON: async (url, opts) => {
      urls.push(url);
      const m = /\/api\/(\d)\/(\w+)$/.exec(url);
      if (!m) return { status: 404, data: null };
      const [, version, plugin] = m;
      if (!serves.includes(Number(version))) return { status: 404, data: null };
      if (config._unauthorized) return { status: 401, data: null };
      return { status: 200, data: PLUGINS[plugin], opts };
    },
    ...errorParts(),
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return { ctx, urls };
}

const withGlances = (extra = {}) => ({
  statProvider: 'glances',
  glancesUrl: 'http://glances:61208',
  slots: [{ type: 'cpu' }, { type: 'ram' }, { type: 'disk', primary: '/', secondary: '/mnt/data' }],
  ...extra,
});

test('every slot type maps to the shape the widget already renders', async () => {
  const { ctx } = ctxFor(
    withGlances({
      slots: [
        { type: 'disk', primary: '/', secondary: '/mnt/data' },
        { type: 'temp', sensor: 'Package id 0' },
        { type: 'procs' },
      ],
    }),
  );
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
  const { ctx } = ctxFor(withGlances({ slots: [{ type: 'disk', primary: '/nope' }] }));
  const r = await dataFn(ctx);
  assert.deepEqual(r.disks, [{ mount: '/nope', usedPct: 0, totalGb: 0 }]);
});

test('a plugin is only fetched when a slot asks for it', async () => {
  const { ctx, urls } = ctxFor(withGlances({ slots: [{ type: 'cpu' }, { type: 'ram' }] }));
  await dataFn(ctx);
  const plugins = urls.map(u => u.split('/').pop());
  assert.deepEqual([...new Set(plugins)].sort(), ['cpu', 'mem', 'uptime']);
});

test('version 4 is used when it answers, and only probed once per URL', async () => {
  const { ctx, urls } = ctxFor(withGlances({ glancesUrl: 'http://v4-host:61208' }));
  await dataFn(ctx);
  assert.ok(
    urls.every(u => u.includes('/api/4/')),
    'a host answering v4 should never be asked for v3',
  );
  const first = urls.length;
  await dataFn(ctx);
  const second = urls.length - first;
  assert.equal(first, second + 1, 'only the first poll pays for the probe');
});

test('a version 3 host is found by falling back, then remembered', async () => {
  const { ctx, urls } = ctxFor(withGlances({ glancesUrl: 'http://v3-host:61208' }), { serves: [3] });
  const r = await dataFn(ctx);
  assert.equal(r.cpu, 12.5);
  assert.equal(urls.filter(u => u.includes('/api/4/')).length, 1, 'v4 is probed once');
  const after = urls.length;
  await dataFn(ctx);
  assert.equal(
    urls.slice(after).filter(u => u.includes('/api/4/')).length,
    0,
    'the remembered version skips the failed probe',
  );
});

test('basic auth is sent only when a credential is set', async () => {
  let seen = null;
  const { ctx } = ctxFor(withGlances({ glancesUser: 'admin', glancesPass: 'pw' }));
  const inner = ctx.fetchJSON;
  ctx.fetchJSON = async (url, opts) => {
    seen = opts.headers;
    return inner(url, opts);
  };
  await dataFn(ctx);
  assert.equal(seen.Authorization, 'Basic ' + Buffer.from('admin:pw').toString('base64'));

  const plain = ctxFor(withGlances({ glancesUrl: 'http://noauth:61208' }));
  let headers = null;
  const innerPlain = plain.ctx.fetchJSON;
  plain.ctx.fetchJSON = async (url, opts) => {
    headers = opts.headers;
    return innerPlain(url, opts);
  };
  await dataFn(plain.ctx);
  assert.deepEqual(headers, {});
});

test('a rejected credential is reported as an auth failure, not a bad host', async () => {
  const { ctx } = ctxFor(withGlances({ glancesUrl: 'http://locked:61208', _unauthorized: true }));
  await assert.rejects(dataFn(ctx), e => {
    assert.match(e.message, /401/);
    assert.equal(e.kind, 'auth');
    return true;
  });
});

test('a host answering neither version reports the upstream status', async () => {
  const { ctx } = ctxFor(withGlances({ glancesUrl: 'http://dead:61208' }), { serves: [] });
  await assert.rejects(dataFn(ctx), /Glances HTTP 404/);
});

test('a missing URL is reported as a configuration problem', async () => {
  const { ctx } = ctxFor({ statProvider: 'glances', slots: [] });
  await assert.rejects(dataFn(ctx), e => {
    assert.equal(e.kind, 'invalid');
    return true;
  });
});

test('the sensor picker offers the temperature sensors and nothing else', async () => {
  const { ctx } = ctxFor(withGlances({ glancesUrl: 'http://sensors:61208' }), { endpoint: 'sensors' });
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, [{ value: 'Package id 0', label: 'Package id 0' }]);
});

test('the uptime string is read in both forms Glances returns', async () => {
  const { ctx } = ctxFor(withGlances({ glancesUrl: 'http://up:61208' }));
  const cases = { '1:27:01': 5221, '7 days, 20:30:06': 678606, '1 day, 0:00:00': 86400, nonsense: null };
  for (const [text, want] of Object.entries(cases)) {
    PLUGINS.uptime = text;
    const r = await dataFn(ctx);
    assert.equal(r.uptime, want, text);
  }
  PLUGINS.uptime = '7 days, 20:30:06';
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
    ...errorParts(),
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  const r = await dataFn(ctx);
  assert.equal(r.cpu, 5);
  assert.equal(r.procs, 200);
});
