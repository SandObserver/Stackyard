const fs = require('node:fs');

const { tmpPath } = require('../test-support/tmp');
const TMP = tmpPath('apps.json', 'config');
process.env.CONFIG_PATH = TMP;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { migrate, saveConfig, loadConfig, SCHEMA_VERSION, missingPathDirs } = require('../src/config');

after(() => {
  try {
    fs.unlinkSync(TMP);
  } catch {}
});

test('migrate stamps an unversioned config to the current version', () => {
  const cfg = migrate({ items: [], settings: {} });
  assert.equal(cfg._schemaVersion, SCHEMA_VERSION);
});

test('migrate is idempotent on an already-current config', () => {
  const cfg = { _schemaVersion: SCHEMA_VERSION, items: [{ id: 'a', type: 'app' }], settings: { theme: 'dark' } };
  const before = JSON.stringify(cfg);
  migrate(cfg);
  assert.equal(JSON.stringify(cfg), before);
});

test('migrate rewrites a tcp Docker socket URL to http', () => {
  const cfg = migrate({ items: [], settings: { server: { socketProxyUrl: 'tcp://socket-proxy:2375' } } });
  assert.equal(cfg.settings.server.socketProxyUrl, 'http://socket-proxy:2375');
});

test('migrate rewrites the scheme whatever its case, and keeps the rest of the URL', () => {
  const cfg = migrate({ items: [], settings: { server: { socketProxyUrl: 'TCP://Socket-Proxy:2375/v1.41' } } });
  assert.equal(cfg.settings.server.socketProxyUrl, 'http://Socket-Proxy:2375/v1.41');
});

test('migrate leaves a Docker socket URL that is already http or https alone', () => {
  for (const url of ['http://socket-proxy:2375', 'https://socket-proxy:2376']) {
    const cfg = migrate({ items: [], settings: { server: { socketProxyUrl: url } } });
    assert.equal(cfg.settings.server.socketProxyUrl, url);
  }
});

test('migrate tolerates a config with no server settings or a non-string URL', () => {
  assert.doesNotThrow(() => migrate({ items: [], settings: {} }));
  assert.doesNotThrow(() => migrate({ items: [], settings: { server: {} } }));
  const cfg = migrate({ items: [], settings: { server: { socketProxyUrl: 42 } } });
  assert.equal(cfg.settings.server.socketProxyUrl, 42);
});

test('a config already at the current version is not rewritten again', () => {
  const cfg = {
    _schemaVersion: SCHEMA_VERSION,
    items: [],
    settings: { server: { socketProxyUrl: 'tcp://socket-proxy:2375' } },
  };
  migrate(cfg);
  assert.equal(cfg.settings.server.socketProxyUrl, 'tcp://socket-proxy:2375');
});

test('migrate turns each stats view into its own widget type', () => {
  const cfg = migrate({
    items: [
      { id: 'a', type: 'widget', widgetType: 'stats', widgetConfig: { widgetSubType: 'disk-health', bays: ['sda'] } },
      { id: 'b', type: 'widget', widgetType: 'stats', widgetConfig: { widgetSubType: 'system-summary' } },
    ],
    settings: {},
  });
  assert.equal(cfg.items[0].widgetType, 'disk-health');
  assert.deepEqual(cfg.items[0].widgetConfig, { bays: ['sda'] });
  assert.equal(cfg.items[1].widgetType, 'system-summary');
  assert.deepEqual(cfg.items[1].widgetConfig, {});
});

test('migrate treats a stats widget with no view as the system summary', () => {
  const cfg = migrate({
    items: [
      { id: 'a', type: 'widget', widgetType: 'stats', widgetConfig: { slots: [{ type: 'cpu' }] } },
      { id: 'b', type: 'widget', widgetType: 'stats' },
    ],
    settings: {},
  });
  assert.equal(cfg.items[0].widgetType, 'system-summary');
  assert.deepEqual(cfg.items[0].widgetConfig.slots, [{ type: 'cpu' }]);
  assert.equal(cfg.items[1].widgetType, 'system-summary');
});

test('migrate leaves an already-split widget and every other type alone', () => {
  const items = [
    { id: 'a', type: 'widget', widgetType: 'disk-health', widgetConfig: { bays: ['sda'] } },
    { id: 'b', type: 'widget', widgetType: 'weather', widgetConfig: { units: 'c' } },
    { id: 'c', type: 'app', label: 'Radarr' },
  ];
  const cfg = migrate({ items: JSON.parse(JSON.stringify(items)), settings: {} });
  assert.deepEqual(cfg.items, items);
});

test('migrating a stats widget twice changes nothing the second time', () => {
  const cfg = migrate({
    items: [{ id: 'a', type: 'widget', widgetType: 'stats', widgetConfig: { widgetSubType: 'disk-health' } }],
    settings: {},
  });
  const once = JSON.parse(JSON.stringify(cfg));
  migrate(cfg);
  assert.deepEqual(cfg, once);
});

test('loadConfig upgrades an unversioned file on disk and keeps data intact', () => {
  fs.writeFileSync(TMP, JSON.stringify({ items: [{ id: 'x', type: 'app' }], settings: { greeting: 'hi' } }));
  const loaded = loadConfig();
  assert.equal(loaded._schemaVersion, SCHEMA_VERSION);
  const onDisk = JSON.parse(fs.readFileSync(TMP, 'utf8'));
  assert.equal(onDisk._schemaVersion, SCHEMA_VERSION, 'upgrade should be persisted to disk');
  assert.deepEqual(onDisk.items, [{ id: 'x', type: 'app' }]);
  assert.equal(onDisk.settings.greeting, 'hi');
});

test('saveConfig always writes the current schema version', () => {
  saveConfig({ items: [], settings: {} });
  const onDisk = JSON.parse(fs.readFileSync(TMP, 'utf8'));
  assert.equal(onDisk._schemaVersion, SCHEMA_VERSION);
});

test('saveConfig bumps _rev on every write', () => {
  const cfg = { items: [], settings: {} };
  saveConfig(cfg);
  assert.equal(cfg._rev, 1);
  saveConfig(cfg);
  assert.equal(cfg._rev, 2);
  assert.equal(loadConfig()._rev, 2);
});

test('saveConfig treats a missing or junk _rev as zero', () => {
  for (const bad of [undefined, null, 'abc', {}]) {
    const cfg = { items: [], settings: {}, _rev: bad };
    saveConfig(cfg);
    assert.equal(cfg._rev, 1);
  }
});

test('missingPathDirs reports a config path whose directory is absent', () => {
  const found = missingPathDirs({ CONFIG_PATH: '/nowhere/apps.json' }, () => false);
  assert.deepEqual(found, [{ name: 'CONFIG_PATH', dir: '/nowhere' }]);
});

test('missingPathDirs reports an absent icons directory', () => {
  const found = missingPathDirs({ ICONS_PATH: '/nowhere/icons' }, () => false);
  assert.deepEqual(found, [{ name: 'ICONS_PATH', dir: '/nowhere/icons' }]);
});

test('missingPathDirs says nothing when the paths exist', () => {
  assert.deepEqual(
    missingPathDirs({ CONFIG_PATH: '/data/apps.json', ICONS_PATH: '/icons' }, () => true),
    [],
  );
});

test('missingPathDirs says nothing when neither variable is set', () => {
  assert.deepEqual(
    missingPathDirs({}, () => false),
    [],
  );
});
