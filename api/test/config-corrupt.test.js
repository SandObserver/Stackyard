const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-config-corrupt-'));
const CFG = path.join(DIR, 'apps.json');
process.env.CONFIG_PATH = CFG;

const { test } = require('node:test');
const assert = require('node:assert/strict');

/* Fresh module per scenario so the config cache and the last-backed-up marker
   start clean; CONFIG_PATH is fixed above and re-read on each require. */
function fresh() {
  delete require.cache[require.resolve('../src/config')];
  return require('../src/config');
}

function reset() {
  for (const f of fs.readdirSync(DIR)) fs.unlinkSync(path.join(DIR, f));
}

function backups() {
  return fs.readdirSync(DIR).filter(f => f.startsWith('apps.json.corrupt'));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('an unparseable file is backed up (timestamped) and load returns blank', () => {
  reset();
  fs.writeFileSync(CFG, '{ not valid json');
  const loaded = fresh().loadConfig();
  assert.deepEqual(loaded.items, []);
  const b = backups();
  assert.equal(b.length, 1);
  assert.equal(fs.readFileSync(path.join(DIR, b[0]), 'utf8'), '{ not valid json');
});

test('a missing file returns blank without creating a backup', () => {
  reset();
  const loaded = fresh().loadConfig();
  assert.deepEqual(loaded.items, []);
  assert.equal(backups().length, 0);
});

test('valid JSON missing items is repaired to empty, not backed up', () => {
  reset();
  fs.writeFileSync(CFG, JSON.stringify({ settings: { theme: 'dark' } }));
  const loaded = fresh().loadConfig();
  assert.deepEqual(loaded.items, []);
  assert.equal(loaded.settings.theme, 'dark');
  assert.equal(backups().length, 0);
});

test('valid JSON with a wrong-typed items is treated as corrupt', () => {
  reset();
  fs.writeFileSync(CFG, JSON.stringify({ items: 5 }));
  const loaded = fresh().loadConfig();
  assert.deepEqual(loaded.items, []);
  assert.equal(backups().length, 1);
});

test('a top-level JSON array is treated as corrupt', () => {
  reset();
  fs.writeFileSync(CFG, '[]');
  const loaded = fresh().loadConfig();
  assert.deepEqual(loaded.items, []);
  assert.equal(backups().length, 1);
});

test('a well-shaped config loads intact', () => {
  reset();
  fs.writeFileSync(CFG, JSON.stringify({ items: [{ id: 'a', type: 'app' }], settings: { greeting: 'hi' } }));
  const loaded = fresh().loadConfig();
  assert.equal(loaded.items[0].id, 'a');
  assert.equal(loaded.settings.greeting, 'hi');
  assert.equal(backups().length, 0);
});

test('the same broken content is backed up only once across repeated reads', () => {
  reset();
  const cfg = fresh();
  fs.writeFileSync(CFG, '{ broken');
  cfg.loadConfig();
  cfg.loadConfig();
  cfg.loadConfig();
  assert.equal(backups().length, 1);
});

test('a second, different corruption is preserved alongside the first', async () => {
  reset();
  const cfg = fresh();
  fs.writeFileSync(CFG, '{ broken one');
  cfg.loadConfig();
  await sleep(5); /* guarantee a distinct timestamp in the backup name */
  fs.writeFileSync(CFG, '{ broken two');
  cfg.loadConfig();
  const b = backups().sort();
  assert.equal(b.length, 2);
  const contents = b.map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).sort();
  assert.deepEqual(contents, ['{ broken one', '{ broken two']);
});
