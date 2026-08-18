const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');
const { dispatchProvider } = require('../src/provider-dispatch');
const { errorParts } = require('../test-support/widget-ctx');

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

/* ── Glances: the source reports a rate ──────────────────────────────────── */

const GLANCES_NET = [
  { interface_name: 'lo', bytes_recv_rate_per_sec: 0, bytes_sent_rate_per_sec: 0 },
  { interface_name: 'eth0', bytes_recv_rate_per_sec: 2048, bytes_sent_rate_per_sec: 56 },
];
const glancesReply = url => ({ status: 200, data: url.endsWith('/network') ? GLANCES_NET : '1:00:00' });

test('a Glances rate is taken as given', async () => {
  const ctx = ctxFor(
    { statProvider: 'glances', glancesUrl: 'http://g:61208', network: { interface: 'eth0' } },
    glancesReply,
  );
  assert.deepEqual(await dataFn(ctx), { rx: 2048, tx: 56 });
});

/* Version 3 has no rate field, only the window and how long it covered. */
test('an older Glances is divided by its own window', async () => {
  const v3 = [{ interface_name: 'eth0', bytes_recv: 6000, bytes_sent: 3000, time_since_update: 3 }];
  const ctx = ctxFor(
    { statProvider: 'glances', glancesUrl: 'http://old:61208', network: { interface: 'eth0' } },
    url => ({ status: 200, data: url.endsWith('/network') ? v3 : '1:00:00' }),
  );
  assert.deepEqual(await dataFn(ctx), { rx: 2000, tx: 1000 });
});

test('the Glances interface list is offered by name', async () => {
  const ctx = ctxFor(
    { statProvider: 'glances', glancesUrl: 'http://g2:61208', network: {} },
    glancesReply,
    'interfaces',
  );
  const r = await dataFn(ctx);
  assert.deepEqual(r.options, [
    { value: 'lo', label: 'lo' },
    { value: 'eth0', label: 'eth0' },
  ]);
});

/* ── Beszel: a rate for the host, totals per interface ───────────────────── */

const beszelReply =
  (stats, created = '2026-08-18T12:00:00.000Z') =>
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
  const at = t => new Date(Date.parse('2026-08-18T12:00:00.000Z') + t * 1000).toISOString();

  const first = ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 1000, 2000] } }, at(0)));
  assert.equal(await dataFn(first), null, 'one record is not a rate');

  const second = ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 7000, 14000] } }, at(60)));
  assert.deepEqual(await dataFn(second), { rx: 200, tx: 100 }, 'divided by the minute between records');
});

/* Beszel writes a record once a minute. Polling more often than that must not
   read the same record as a minute of no traffic. */
test('polling between records repeats the rate rather than reporting nothing', async () => {
  const config = beszelConfig({ beszelUrl: 'http://repeat:8090', network: { interface: 'eth0' } });
  const at = t => new Date(Date.parse('2026-08-18T13:00:00.000Z') + t * 1000).toISOString();
  await dataFn(ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 0, 0] } }, at(0))));
  const moved = await dataFn(ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 600, 1200] } }, at(60))));
  assert.deepEqual(moved, { rx: 20, tx: 10 });

  const again = await dataFn(ctxFor(config, beszelReply({ ni: { eth0: [0, 0, 600, 1200] } }, at(60))));
  assert.deepEqual(again, moved, 'the same record gives the same answer, not zero');
});

test('a counter that went backwards is skipped rather than reported negative', async () => {
  const config = beszelConfig({ beszelUrl: 'http://reset:8090', network: { interface: 'eth0' } });
  const at = t => new Date(Date.parse('2026-08-18T14:00:00.000Z') + t * 1000).toISOString();
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
  const ctx = ctxFor(
    { statProvider: 'glances', glancesUrl: 'http://g3:61208', network: { interface: 'ghost' } },
    glancesReply,
  );
  await assert.rejects(dataFn(ctx), e => {
    assert.equal(e.kind, 'invalid');
    assert.match(e.message, /ghost/);
    return true;
  });
});

test('no interface chosen is a configuration problem, not an empty reading', async () => {
  for (const config of [
    { statProvider: 'glances', glancesUrl: 'http://g4:61208', network: {} },
    { statProvider: 'unraid', unraidUrl: 'u2', unraidApiKey: 'K', network: {} },
  ]) {
    await assert.rejects(dataFn(ctxFor(config, glancesReply)), e => {
      assert.equal(e.kind, 'invalid');
      return true;
    });
  }
});

test('this machine has no throughput handler, since it never reaches the data function', async () => {
  const ctx = ctxFor({ statProvider: 'system', network: { interface: 'eth0' } }, glancesReply);
  await assert.rejects(dataFn(ctx), /Unknown statProvider/);
});
