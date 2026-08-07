const path = require('node:path');
const { tmpDir, tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('wd'), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBase, dataFnContext, resolveRow } = require('../src/widget-data');
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
  assert.deepEqual(dataFnContext(wc, 'jobs', new URLSearchParams(), async () => {}, { key: 'slots', index: 0 }).row, { url: 'a' });
  assert.equal(dataFnContext(wc, '', new URLSearchParams(), async () => {}).row, null);
});

/* P5-3, P5-4: what a data function is actually handed. widget-settings.test.js
   covers the filter itself; this pins the wiring, since the leak was in how ctx
   was built and not in any rule. */
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
