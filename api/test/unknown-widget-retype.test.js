const path = require('node:path');
const fs = require('node:fs');

const { tmpDir } = require('../test-support/tmp');
const root = tmpDir('retype');
const widgetsDir = path.join(root, 'widgets');
fs.mkdirSync(widgetsDir, { recursive: true });
process.env.WIDGETS_PATH = widgetsDir;
process.env.CONFIG_PATH = path.join(root, 'apps.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const { loadRegistry } = require('../src/widgets');
const log = require('../src/log');

const MANIFEST = {
  name: 'retired',
  label: 'Retired',
  sizes: ['small'],
  fields: [
    { key: 'url', type: 'text', label: 'Address' },
    { key: 'apiKey', type: 'secret', label: 'API key' },
    { key: 'refresh', type: 'number', label: 'Refresh' },
  ],
};
const STORED = { url: 'http://retired.lan:8080', apiKey: 'STORED-KEY', refresh: 30 };
const SERVER = { hostIp: '10.0.0.5', portMap: { 8080: { host: 'retired.lan', port: '8081' } } };

const installManifest = () => {
  fs.mkdirSync(path.join(widgetsDir, 'retired'), { recursive: true });
  fs.writeFileSync(path.join(widgetsDir, 'retired', 'widget.json'), JSON.stringify(MANIFEST));
  loadRegistry();
};
const removeManifest = () => {
  fs.rmSync(path.join(widgetsDir, 'retired'), { recursive: true, force: true });
  loadRegistry();
};
const disk = () => JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, 'utf8'));
const diskItem = () => disk().items.find(i => i.id === 'w1');

let server, base;

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => {
    server.closeAllConnections?.();
    server.close(r);
  });
});

beforeEach(() => {
  removeManifest();
  saveConfig({
    items: [{ id: 'w1', type: 'widget', label: 'Old service', widgetType: 'retired', widgetConfig: STORED }],
    settings: { server: structuredClone(SERVER) },
  });
});

async function call(method, route, body) {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', Origin: base } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(res.status, 200, `${method} ${route}`);
  return res.json();
}

async function saveWithServer(change) {
  const cfg = await call('GET', '/api/config');
  assert.deepEqual(cfg.items.find(i => i.id === 'w1').widgetConfig, {});
  cfg.settings = { ...cfg.settings, server: { ...cfg.settings.server, ...change } };
  return call('POST', '/api/config', cfg);
}

const TRIGGERS = [
  ['the certificate skip', { skipTlsVerify: true }],
  ['Host IP with a port map set', { hostIp: '10.0.0.9' }],
  ['the port map', { portMap: { 8080: { host: 'retired.lan', port: '9090' } } }],
];

for (const [name, change] of TRIGGERS) {
  test(`changing ${name} keeps the config of a widget with no manifest and marks it`, async () => {
    const reply = await saveWithServer(change);
    assert.deepEqual(reply.withheld, [{ id: 'w1', label: 'Old service' }]);
    const item = diskItem();
    assert.deepEqual(item.widgetConfig, STORED);
    assert.equal(item.secretsNeedRetype, true);
  });
}

test('only a change of destination sets the marker, and a later save keeps it', async () => {
  await saveWithServer({});
  assert.equal(Object.hasOwn(diskItem(), 'secretsNeedRetype'), false);
  await saveWithServer({ skipTlsVerify: true });
  const reply = await saveWithServer({});
  assert.equal(reply.withheld, undefined);
  assert.deepEqual(diskItem().widgetConfig, STORED);
  assert.equal(diskItem().secretsNeedRetype, true);
});

test('when the manifest returns, the stored secret is dropped before any read sees it', async t => {
  await saveWithServer({ hostIp: '10.0.0.9' });
  const audits = [];
  t.mock.method(log, 'audit', (msg, data) => audits.push([msg, data]));
  installManifest();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 60_000 });

  const read = await call('GET', '/api/widget-config/w1');
  assert.deepEqual(read.widgetConfig, { url: STORED.url, refresh: 30 });
  const item = diskItem();
  assert.deepEqual(item.widgetConfig, { url: STORED.url, refresh: 30 });
  assert.equal(Object.hasOwn(item, 'secretsNeedRetype'), false);
  assert.deepEqual(audits, [['stored credentials dropped until retyped', { items: ['w1'] }]]);

  const cfg = await call('GET', '/api/config');
  cfg.items.find(i => i.id === 'w1').widgetConfig.apiKey = 'RETYPED-KEY';
  await call('POST', '/api/config', cfg);
  assert.deepEqual(diskItem().widgetConfig, { ...STORED, apiKey: 'RETYPED-KEY' });
  assert.equal(Object.hasOwn(diskItem(), 'secretsNeedRetype'), false);
});

test('a save from the browser cannot set or clear the marker', async () => {
  installManifest();
  const cfg = await call('GET', '/api/config');
  cfg.items.find(i => i.id === 'w1').secretsNeedRetype = true;
  await call('POST', '/api/config', cfg);
  assert.equal(Object.hasOwn(diskItem(), 'secretsNeedRetype'), false);
  assert.equal(diskItem().widgetConfig.apiKey, STORED.apiKey);

  removeManifest();
  await saveWithServer({ skipTlsVerify: true });
  const next = await call('GET', '/api/config');
  next.items.find(i => i.id === 'w1').secretsNeedRetype = false;
  await call('POST', '/api/config', next);
  assert.equal(diskItem().secretsNeedRetype, true);
});

test('export leaves the marker out, and a file carrying one is imported', async () => {
  await saveWithServer({ skipTlsVerify: true });
  const exported = await call('GET', '/api/config/export');
  const item = exported.items.find(i => i.id === 'w1');
  assert.equal(Object.hasOwn(item, 'secretsNeedRetype'), false);
  assert.deepEqual((await call('GET', '/api/config')).items.find(i => i.id === 'w1').secretsNeedRetype, undefined);

  item.secretsNeedRetype = true;
  const reply = await call('POST', '/api/config', exported);
  assert.equal(reply.ok, true);
  assert.deepEqual(diskItem().widgetConfig, STORED);
  assert.equal(diskItem().secretsNeedRetype, true);
});
