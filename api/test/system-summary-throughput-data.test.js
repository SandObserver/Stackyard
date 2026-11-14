const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('throughput'), 'apps.json');

const { test, before, after: afterAll } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBase } = require('../src/widget-data');
const { dispatchProvider } = require('../src/provider-dispatch');
const { errorParts, runtimeCtx } = require('../test-support/widget-ctx');
const { glancesStub } = require('../test-support/glances-stub');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'system-summary', 'data.js'));

function ctxFor(config, reply, endpoint = 'throughput') {
  const ctx = {
    endpoint,
    config,
    normalizeBase,
    fetchJSON: async (url, opts) => reply(url, opts),
    ...errorParts(),
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return ctx;
}

/* ── Glances ────────────────────────────────────────────────────────────── */

/* Glances 4 shape from its docs/api.rst: bytes per second in `*_rate_per_sec`. */
const V4_NET = [
  {
    alias: null,
    bytes_all: 0,
    bytes_all_gauge: 1457304,
    bytes_all_rate_per_sec: 0,
    bytes_recv: 0,
    bytes_recv_gauge: 208619,
    bytes_recv_rate_per_sec: 0,
    bytes_sent: 0,
    bytes_sent_gauge: 1248685,
    bytes_sent_rate_per_sec: 0,
    interface_name: 'lo',
    key: 'interface_name',
    speed: 0,
    time_since_update: 0.3015410900115967,
  },
  {
    alias: null,
    bytes_all: 631,
    bytes_all_gauge: 6598193846,
    bytes_all_rate_per_sec: 2104,
    bytes_recv: 614,
    bytes_recv_gauge: 5387203181,
    bytes_recv_rate_per_sec: 2048,
    bytes_sent: 17,
    bytes_sent_gauge: 1210990665,
    bytes_sent_rate_per_sec: 56,
    interface_name: 'eth0',
    key: 'interface_name',
    speed: 0,
    time_since_update: 0.3015410900115967,
  },
];

/* Glances 3 shape from glances_network.py at v3.4.0.5: `rx` and `tx` are the
   bytes moved in the last `time_since_update` seconds. */
const V3_NET = [
  {
    alias: null,
    cumulative_cx: 5867501002,
    cumulative_rx: 5510140836,
    cumulative_tx: 357360166,
    cx: 70898,
    interface_name: 'eth0',
    is_up: true,
    key: 'interface_name',
    rx: 54916,
    speed: 0,
    time_since_update: 2,
    tx: 15982,
  },
];

let v4;
let v3;
before(async () => {
  v4 = await glancesStub({ network: V4_NET, uptime: '19 days, 5:41:56' });
  v3 = await glancesStub({ network: V3_NET, uptime: '19 days, 5:41:56' });
});
afterAll(() => Promise.all([v4.close(), v3.close()]));

const glancesConfig = (glancesUrl, network = { interface: 'eth0' }) => ({
  statProvider: 'glances',
  glancesUrl,
  network,
});

test('a Glances 4 rate is taken as given', async () => {
  const ctx = runtimeCtx(glancesConfig(v4.url('rate')), 'throughput');
  assert.deepEqual(await dataFn(ctx), { rx: 2048, tx: 56 });
});

test('a Glances 3 window is divided by its own length', async () => {
  const ctx = runtimeCtx(glancesConfig(v3.url('old', { serves: [3] })), 'throughput');
  assert.deepEqual(await dataFn(ctx), { rx: 27458, tx: 7991 });
});

test('the Glances interface list is offered by name', async () => {
  const ctx = runtimeCtx(glancesConfig(v4.url('list'), {}), 'interfaces');
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, [
    { value: 'lo', label: 'lo' },
    { value: 'eth0', label: 'eth0' },
  ]);
});

/* ── Beszel: a rate for the host, totals per interface ───────────────────── */

/* Beszel records older than five minutes are refused as stale. */
const RECENT = Date.now() - 2 * 60 * 1000;
const beszelReply =
  (stats, created = new Date(RECENT).toISOString()) =>
  (url, opts) => {
    if (url.includes('auth-with-password')) return { status: 200, data: { token: 'tok' } };
    if (url.includes('/systems/records')) return { status: 200, data: { items: [{ id: 'sys1', name: 'host' }] } };
    return { status: 200, data: { items: [{ stats, created }] } };
  };
const beszelConfig = extra => ({
  statProvider: 'beszel',
  beszelUrl: 'http://b:8090',
  beszelUser: 'u',
  beszelPass: 'p',
  beszelSystem: 'sys1',
  ...extra,
});

test('the whole host uses the rate Beszel already computed', async () => {
  const ctx = ctxFor(
    beszelConfig({ network: { interface: '*' } }),
    beszelReply({ b: [500, 9000], ni: { eth0: [1, 2, 3, 4] } }),
  );
  assert.deepEqual(await dataFn(ctx), { rx: 9000, tx: 500 }, 'b is [sent, recv]');
});

test('one interface is derived from its totals between two records', async () => {
  const config = beszelConfig({ beszelUrl: 'http://rate:8090', network: { interface: 'eth0' } });
  const at = t => new Date(RECENT + t * 1000).toISOString();

  const first = ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 1000, 2000] } }, at(0)));
  assert.equal(await dataFn(first), null, 'one record is not a rate');

  const second = ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 7000, 14000] } }, at(60)));
  assert.deepEqual(await dataFn(second), { rx: 200, tx: 100 }, 'divided by the minute between records');
});

/* Beszel writes a record once a minute. Polling more often than that must not
   read the same record as a minute of no traffic. */
test('polling between records repeats the rate rather than reporting nothing', async () => {
  const config = beszelConfig({ beszelUrl: 'http://repeat:8090', network: { interface: 'eth0' } });
  const at = t => new Date(RECENT + t * 1000).toISOString();
  await dataFn(ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 0, 0] } }, at(0))));
  const moved = await dataFn(ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 600, 1200] } }, at(60))));
  assert.deepEqual(moved, { rx: 20, tx: 10 });

  const again = await dataFn(ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 600, 1200] } }, at(60))));
  assert.deepEqual(again, moved, 'the same record gives the same answer, not zero');
});

test('a counter that went backwards is skipped rather than reported negative', async () => {
  const config = beszelConfig({ beszelUrl: 'http://reset:8090', network: { interface: 'eth0' } });
  const at = t => new Date(RECENT + t * 1000).toISOString();
  await dataFn(ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 9000, 9000] } }, at(0))));
  const after = await dataFn(ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 5, 5] } }, at(60))));
  assert.equal(after, null);
});

test('the Beszel list offers the whole host alongside each interface', async () => {
  const ctx = ctxFor(
    beszelConfig({ beszelUrl: 'http://list:8090', network: {} }),
    beszelReply({ ni: { eth0: [0, 0, 0, 0], wlan0: [0, 0, 0, 0] } }),
    'interfaces',
  );
  const r = await dataFn(ctx);
  assert.deepEqual(
    r.options.map(o => o.value),
    ['*', 'eth0', 'wlan0'],
  );
});

/* ── Unraid: totals only ─────────────────────────────────────────────────── */

const unraidReply = network => () => ({ status: 200, data: { data: { metrics: { network } } } });
const unraidConfig = extra => ({ statProvider: 'unraid', unraidUrl: 'tower', unraidApiKey: 'K', ...extra });

test('Unraid counters become a rate across two reads', async () => {
  const config = unraidConfig({ unraidUrl: 'u1', network: { interface: 'eth0' } });
  const first = await dataFn(ctxFor(config, unraidReply([{ name: 'eth0', bytesReceived: '100', bytesSent: '50' }])));
  assert.equal(first, null);

  await new Promise(r => setTimeout(r, 20));
  const second = await dataFn(ctxFor(config, unraidReply([{ name: 'eth0', bytesReceived: '1100', bytesSent: '550' }])));
  assert.ok(second.rx > 0 && second.tx > 0);
  assert.ok(second.rx > second.tx);
});

test('the Unraid interface list is offered by name', async () => {
  const ctx = ctxFor(unraidConfig({ network: {} }), unraidReply([{ name: 'br0' }, { name: 'eth0' }]), 'interfaces');
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, [
    { value: 'br0', label: 'br0' },
    { value: 'eth0', label: 'eth0' },
  ]);
});

/* ── shared ──────────────────────────────────────────────────────────────── */

test('an interface the source does not report is named, not left blank', async () => {
  const ctx = runtimeCtx(glancesConfig(v4.url('ghost'), { interface: 'ghost' }), 'throughput');
  await assert.rejects(dataFn(ctx), e => {
    assert.equal(e.kind, 'invalid');
    assert.match(e.message, /ghost/);
    return true;
  });
});

test('no interface chosen is a configuration problem, not an empty reading', async () => {
  for (const ctx of [
    runtimeCtx(glancesConfig(v4.url('none'), {}), 'throughput'),
    ctxFor({ statProvider: 'unraid', unraidUrl: 'u2', unraidApiKey: 'K', network: {} }, unraidReply([])),
  ]) {
    await assert.rejects(dataFn(ctx), e => {
      assert.equal(e.kind, 'invalid');
      return true;
    });
  }
});

test('this machine has no throughput handler, since it never reaches the data function', async () => {
  const ctx = runtimeCtx({ statProvider: 'system', network: { interface: 'eth0' } }, 'throughput');
  await assert.rejects(dataFn(ctx), /Unknown statProvider/);
});
