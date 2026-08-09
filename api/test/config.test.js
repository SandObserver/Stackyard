const fs = require('node:fs');

/* Use a real temp file so loadConfig/saveConfig persistence can be exercised.
   The pid used to keep concurrent runs apart, but the file still outlived the
   process; tmpPath gives a fresh one that is removed on exit. */
const { tmpPath } = require('../test-support/tmp');
const TMP = tmpPath('apps.json', 'config');
process.env.CONFIG_PATH = TMP;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { migrate, saveConfig, loadConfig, SCHEMA_VERSION } = require('../src/config');

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
  /* Someone who deliberately re-enters a tcp URL after upgrading keeps it, so
     the step cannot fight the user on every read. */
  const cfg = {
    _schemaVersion: SCHEMA_VERSION,
    items: [],
    settings: { server: { socketProxyUrl: 'tcp://socket-proxy:2375' } },
  };
  migrate(cfg);
  assert.equal(cfg.settings.server.socketProxyUrl, 'tcp://socket-proxy:2375');
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
