const fs = require('node:fs');

const { tmpPath } = require('../test-support/tmp');
const TMP = tmpPath('apps.json', 'config-ownership');
process.env.CONFIG_PATH = TMP;

const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, loadConfigForUpdate, saveConfig } = require('../src/config');

after(() => {
  try {
    fs.unlinkSync(TMP);
  } catch {}
});

beforeEach(() => {
  saveConfig({ items: [{ id: 'a', type: 'app', label: 'before' }], settings: { theme: 'dark' } });
});

test('loadConfigForUpdate hands back a copy, not the cached object', () => {
  const draft = loadConfigForUpdate();
  assert.notEqual(draft, loadConfig());
  draft.items[0].label = 'after';
  assert.equal(loadConfig().items[0].label, 'before');
});

test('a failed save leaves the cache on the value that is on disk', () => {
  const draft = loadConfigForUpdate();
  draft.settings.theme = 'light';
  const real = fs.renameSync;
  fs.renameSync = () => {
    throw new Error('disk full');
  };
  try {
    assert.throws(() => saveConfig(draft), /disk full/);
  } finally {
    fs.renameSync = real;
  }
  assert.equal(loadConfig().settings.theme, 'dark');
  assert.equal(JSON.parse(fs.readFileSync(TMP, 'utf8')).settings.theme, 'dark');
});

test('the caller cannot reach the cache through the object it saved', () => {
  const draft = loadConfigForUpdate();
  draft.settings.theme = 'light';
  saveConfig(draft);
  draft.settings.theme = 'not saved';
  assert.equal(loadConfig().settings.theme, 'light');
});

test('a successful save is what moves the cache', () => {
  const draft = loadConfigForUpdate();
  draft.items.push({ id: 'b', type: 'app' });
  saveConfig(draft);
  assert.equal(loadConfig().items.length, 2);
});
