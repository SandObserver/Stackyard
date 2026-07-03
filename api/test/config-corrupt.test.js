const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TMP = path.join(os.tmpdir(), `stackyard-config-corrupt-test-${process.pid}.json`);
process.env.CONFIG_PATH = TMP;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

after(() => {
  try { fs.unlinkSync(TMP); } catch {}
  try { fs.unlinkSync(TMP + '.corrupt'); } catch {}
});

test('loadConfig backs up an unparseable file and returns a blank config', () => {
  fs.writeFileSync(TMP, '{ not valid json');
  const loaded = loadConfig();
  assert.deepEqual(loaded.items, []);
  const backup = fs.readFileSync(TMP + '.corrupt', 'utf8');
  assert.equal(backup, '{ not valid json');
});

test('loadConfig returns a blank config when the file does not exist, without creating a backup', () => {
  try { fs.unlinkSync(TMP); } catch {}
  try { fs.unlinkSync(TMP + '.corrupt'); } catch {}
  const loaded = loadConfig();
  assert.deepEqual(loaded.items, []);
  assert.equal(fs.existsSync(TMP + '.corrupt'), false);
});
