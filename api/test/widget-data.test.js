const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('wd'), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBase, dataFnContext, resolveRow, widgetParams } = require('../src/widget-data');
const { saveConfig } = require('../src/config');

test('normalizeBase adds a scheme, trims, and strips trailing slashes', () => {
  assert.equal(normalizeBase('host:8080'), 'http://host:8080');
  assert.equal(normalizeBase('https://host/'), 'https://host');
  assert.equal(normalizeBase('http://host///'), 'http://host');
  assert.equal(normalizeBase('  host  '), 'http://host');
  assert.equal(normalizeBase(''), '');
});

test('a widget with no data.js reports no data source', async () => {
  const { getWidgetData } = require('../src/widget-data');
  const entry = { hasDataFn: false, manifest: { name: 'clock' } };
  const out = await getWidgetData({ widgetType: 'clock' }, entry, '', new URLSearchParams(), null);
  assert.equal(out.status, 503);
  assert.match(out.body.error, /no data source/);
});

test('widgetParams keeps the endpoint and declared params and drops everything else', () => {
  const q = new URLSearchParams('endpoint=system&seed=1&_=123&x=y');
  assert.equal(widgetParams(q, { params: ['seed'] }).toString(), 'endpoint=system&seed=1');
  assert.equal(widgetParams(q, {}).toString(), 'endpoint=system');
  assert.equal(widgetParams(new URLSearchParams('_=1'), {}).toString(), '');
});

test('every query value a widget reads is declared in its manifest', () => {
  const fs = require('node:fs');
  const widgets = path.join(__dirname, '..', '..', 'ui', 'widgets');
  for (const name of fs.readdirSync(widgets)) {
    const file = path.join(widgets, name, 'data.js');
    if (!fs.existsSync(file)) continue;
    const manifest = JSON.parse(fs.readFileSync(path.join(widgets, name, 'widget.json'), 'utf8'));
    const src = fs.readFileSync(file, 'utf8');
    for (const [, key] of src.matchAll(/params\??\.get\(\s*['"]([^'"]+)['"]/g)) {
      assert.equal(
        widgetParams(new URLSearchParams({ [key]: 'v' }), manifest).get(key),
        'v',
        `${name}/data.js reads "${key}" but widget.json does not list it in "params"`,
      );
    }
  }
});

/* ── Group-row resolution for an options fetch ──────────────────────────── */

test('resolveRow returns the addressed row', () => {
  const wc = { slots: [{ url: 'a' }, { url: 'b' }] };
  assert.deepEqual(resolveRow(wc, { key: 'slots', index: 1 }), { url: 'b' });
});

test('resolveRow returns null for a row that is not there', () => {
  const wc = { slots: [{ url: 'a' }] };
  assert.equal(resolveRow(wc, { key: 'slots', index: 4 }), null);
  assert.equal(resolveRow(wc, { key: 'nope', index: 0 }), null);
  assert.equal(resolveRow({}, { key: 'slots', index: 0 }), null);
});

test('resolveRow rejects a malformed row reference', () => {
  const wc = { slots: [{ url: 'a' }] };
  assert.equal(resolveRow(wc, null), null);
  assert.equal(resolveRow(wc, undefined), null);
  assert.equal(resolveRow(wc, { key: 'slots' }), null);
  assert.equal(resolveRow(wc, { key: 'slots', index: -1 }), null);
  assert.equal(resolveRow(wc, { key: 'slots', index: 1.5 }), null);
  assert.equal(resolveRow(wc, { key: 'slots', index: '0' }), null);
  assert.equal(resolveRow(wc, { key: 0, index: 0 }), null);
});

test('resolveRow does not reach through the prototype chain', () => {
  assert.equal(resolveRow({ slots: [] }, { key: '__proto__', index: 0 }), null);
  assert.equal(resolveRow({ slots: [] }, { key: 'constructor', index: 0 }), null);
});

test('resolveRow ignores a row entry that is not a plain object', () => {
  assert.equal(resolveRow({ slots: ['a'] }, { key: 'slots', index: 0 }), null);
  assert.equal(resolveRow({ slots: [[1]] }, { key: 'slots', index: 0 }), null);
  assert.equal(resolveRow({ slots: [null] }, { key: 'slots', index: 0 }), null);
});

test('dataFnContext exposes the resolved row and null without one', () => {
  const wc = { slots: [{ url: 'a' }, { url: 'b' }] };
  assert.deepEqual(dataFnContext(wc, 'jobs', new URLSearchParams(), async () => {}, { key: 'slots', index: 0 }).row, {
    url: 'a',
  });
  assert.equal(dataFnContext(wc, '', new URLSearchParams(), async () => {}).row, null);
});

test('the ctx a data function receives carries no secret settings', () => {
  saveConfig({
    items: [],
    settings: {
      auth: { enabled: true, secret: 'SIGNING-KEY', passwordHash: 'HASHED' },
      server: { hostIp: '192.168.1.10', socketProxyUrl: 'http://socket:2375' },
      stats: { diskMount: '/mnt/media' },
    },
  });
  const ctx = dataFnContext({}, '', new URLSearchParams(), async () => {});
  assert.equal(ctx.settings.stats.diskMount, '/mnt/media', 'the shared key must still arrive');
  assert.equal(ctx.settings.auth, undefined);
  assert.equal(ctx.settings.server, undefined);
  assert.ok(!JSON.stringify(ctx.settings).includes('SIGNING-KEY'));
  assert.ok(!JSON.stringify(ctx.settings).includes('HASHED'));
});

test('a data function sends at most six requests at once to one service', async () => {
  let active = 0;
  let peak = 0;
  const fetch = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 5));
    active--;
    return { status: 200, data: {} };
  };
  const ctx = dataFnContext({}, '', new URLSearchParams(), fetch);
  await Promise.all([
    ...Array.from({ length: 30 }, (_, k) => ctx.fetchJSON(`http://pbs:8007/${k}`)),
    ctx.fetchJSON('http://other:80/'),
  ]);
  assert.equal(peak, 7);
});

test('a queued request gets its timeout when it is sent', async () => {
  const timeouts = [];
  const fetch = async (url, opts) => {
    timeouts.push(opts.timeout);
    await new Promise(r => setTimeout(r, 300));
    return { status: 200, data: {} };
  };
  const ctx = dataFnContext({}, '', new URLSearchParams(), fetch);
  await Promise.all(Array.from({ length: 7 }, () => ctx.fetchJSON('http://svc/', { timeout: 60000 })));
  assert.equal(timeouts.length, 7);
  assert.ok(timeouts[6] <= timeouts[0] - 250, `queued ${timeouts[6]} ms, first ${timeouts[0]} ms`);
});

test('a data function cannot read a reply that is not JSON as data', async () => {
  const fetchFor = data => async () => ({ status: 200, data });
  const ctx = dataFnContext({}, '', new URLSearchParams(), fetchFor('{"num_dns_queries": 12'));
  await assert.rejects(ctx.fetchJSON('http://svc'), { name: 'WidgetError', kind: 'upstream' });
});

test('raw text, empty bodies, error replies and parsed replies still reach the data function', async () => {
  const cases = [
    [{ status: 200, data: 'line one' }, { raw: true }],
    [{ status: 204, data: '' }, {}],
    [{ status: 401, data: 'Unauthorized' }, {}],
    [{ status: 200, data: { ok: true } }, {}],
  ];
  for (const [reply, opts] of cases) {
    const ctx = dataFnContext({}, '', new URLSearchParams(), async () => reply);
    assert.deepEqual(await ctx.fetchJSON('http://svc', opts), reply);
  }
});

test('every upstream call of one request shares the widget time budget', async t => {
  const { FETCH_MS, WIDGET_BUDGET_MS } = require('../src/timeouts');
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const seen = [];
  const ctx = dataFnContext({}, '', new URLSearchParams(), async (url, opts) => {
    seen.push(opts.timeout);
    return { status: 200, data: {} };
  });

  await ctx.fetchJSON('http://svc/a');
  t.mock.timers.tick(WIDGET_BUDGET_MS - 3000);
  await ctx.fetchJSON('http://svc/b', { timeout: 10000 });
  t.mock.timers.tick(3000);
  await assert.rejects(ctx.fetchJSON('http://svc/c'), /Timed out/);

  assert.deepEqual(seen, [FETCH_MS, 3000]);
});

test('the widget time budget ends before nginx gives up on the request', () => {
  const fs = require('node:fs');
  const { WIDGET_BUDGET_MS } = require('../src/timeouts');
  const conf = fs.readFileSync(path.join(__dirname, '..', '..', 'nginx', 'dashboard.conf'), 'utf8');
  const api = conf.slice(conf.indexOf('location /api/'));
  const seconds = Number(/proxy_read_timeout\s+(\d+)s/.exec(api)[1]);
  assert.ok(WIDGET_BUDGET_MS + 2000 <= seconds * 1000, `${WIDGET_BUDGET_MS} ms against ${seconds} s`);
});
