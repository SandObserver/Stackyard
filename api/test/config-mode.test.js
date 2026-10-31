const fs = require('node:fs');
const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
const dir = tmpDir('config-mode');
const CFG = path.join(dir, 'apps.json');
process.env.CONFIG_PATH = CFG;
fs.writeFileSync(CFG, JSON.stringify({ items: [], settings: {} }), { mode: 0o644 });

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, saveConfig } = require('../src/config');

const mode = p => fs.statSync(p).mode & 0o777;

/* The file holds stored secrets. */
test('a world-readable file from an earlier version is made owner-only on first read', () => {
  assert.equal(mode(CFG), 0o644);
  loadConfig();
  assert.equal(mode(CFG), 0o600);
});

test('a save writes the temp file and the config owner-only', () => {
  fs.chmodSync(CFG, 0o644);
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
  assert.equal(mode(CFG), 0o600);
});

test('a corrupt-file backup is owner-only', () => {
  fs.writeFileSync(CFG, '{not json', { mode: 0o644 });
  assert.throws(() => saveConfig({ items: [], settings: {} }), /cannot be used/);
  const backup = fs.readdirSync(dir).find(f => f.startsWith('apps.json.corrupt-'));
  assert.ok(backup, 'no backup was written');
  assert.equal(mode(path.join(dir, backup)), 0o600);
});
