const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.CONFIG_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sy-wd-')), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBase } = require('../src/widget-data');

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
