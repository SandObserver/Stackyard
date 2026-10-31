const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { tmpDir } = require('../test-support/tmp');

const mode = p => fs.statSync(p).mode & 0o777;

/* The once-per-process check needs a new module for each case. */
function fresh(label, files = {}) {
  const dir = tmpDir(`config-mode-${label}`);
  const cfg = path.join(dir, 'apps.json');
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body, { mode: 0o644 });
  process.env.CONFIG_PATH = cfg;
  delete require.cache[require.resolve('../src/config')];
  return { dir, cfg, ...require('../src/config') };
}

const current = schema => JSON.stringify({ _schemaVersion: schema, items: [], settings: {} });
const { SCHEMA_VERSION } = fresh('schema');

/* The file holds stored secrets. */
test('a current file from an earlier version is made owner-only on first read', () => {
  const { cfg, loadConfig } = fresh('current', { 'apps.json': current(SCHEMA_VERSION) });
  loadConfig();
  assert.equal(mode(cfg), 0o600);
});

test('a file that needs a migration is owner-only after the first read', () => {
  const { cfg, loadConfig } = fresh('migrated', { 'apps.json': JSON.stringify({ items: [], settings: {} }) });
  loadConfig();
  assert.equal(mode(cfg), 0o600);
});

test('corrupt-file backups from an earlier version are made owner-only on first read', () => {
  const { dir, loadConfig } = fresh('old-backups', {
    'apps.json': current(SCHEMA_VERSION),
    'apps.json.corrupt-2026-01-01T00-00-00-000Z': '{not json',
    'apps.json.corrupt': '{not json',
    'other.json': '{}',
  });
  loadConfig();
  assert.equal(mode(path.join(dir, 'apps.json.corrupt-2026-01-01T00-00-00-000Z')), 0o600);
  assert.equal(mode(path.join(dir, 'apps.json.corrupt')), 0o600);
  assert.equal(mode(path.join(dir, 'other.json')), 0o644);
});

test('a temp file left by a crash is made owner-only on first read', () => {
  const { dir, loadConfig } = fresh('old-tmp', {
    'apps.json': current(SCHEMA_VERSION),
    'apps.json.tmp': '{"items":[',
  });
  loadConfig();
  assert.equal(mode(path.join(dir, 'apps.json.tmp')), 0o600);
});

test('a save writes the temp file and the config owner-only', () => {
  const { cfg, loadConfig, saveConfig } = fresh('save', { 'apps.json': current(SCHEMA_VERSION) });
  loadConfig();
  fs.chmodSync(cfg, 0o644);
  let tmpMode;
  const real = fs.renameSync;
  fs.renameSync = (from, to) => {
    tmpMode = mode(from);
    return real(from, to);
  };
  try {
    saveConfig({ items: [], settings: { theme: 'dark' } });
  } finally {
    fs.renameSync = real;
  }
  assert.equal(tmpMode, 0o600);
  assert.equal(mode(cfg), 0o600);
});

test('a world-readable temp file left by a crash does not make the config world-readable', () => {
  const { cfg, loadConfig, saveConfig } = fresh('stale-tmp', {
    'apps.json': current(SCHEMA_VERSION),
    'apps.json.tmp': '{"items":[',
  });
  loadConfig();
  saveConfig({ items: [], settings: { theme: 'dark' } });
  assert.equal(mode(cfg), 0o600);
  assert.equal(JSON.parse(fs.readFileSync(cfg, 'utf8')).settings.theme, 'dark');
});

test('a corrupt-file backup is owner-only', () => {
  const { dir, saveConfig } = fresh('backup', { 'apps.json': '{not json' });
  assert.throws(() => saveConfig({ items: [], settings: {} }), /cannot be used/);
  const backup = fs.readdirSync(dir).find(f => f.startsWith('apps.json.corrupt-'));
  assert.ok(backup, 'no backup was written');
  assert.equal(mode(path.join(dir, backup)), 0o600);
});
