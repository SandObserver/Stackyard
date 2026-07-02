const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/* Use a real temp file so loadConfig/saveConfig persistence can be exercised. */
const TMP = path.join(os.tmpdir(), `stackyard-config-test-${process.pid}.json`);
process.env.CONFIG_PATH = TMP;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { migrate, saveConfig, loadConfig, SCHEMA_VERSION } = require('../src/config');

after(() => { try { fs.unlinkSync(TMP); } catch {} });

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
