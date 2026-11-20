const fs = require('node:fs');
const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
const CONFIG = path.join(tmpDir('old-releases'), 'apps.json');
process.env.CONFIG_PATH = CONFIG;

const { test } = require('node:test');
const { loadConfigForUpdate, SCHEMA_VERSION } = require('../src/config');

/* Each file is the demo config as that release saved it, written by that
   release's own loadConfig. Never edit one: add a file for a newer release. */
const FIXTURES = path.join(__dirname, 'fixtures', 'old-releases');
const files = fs.readdirSync(FIXTURES).filter(n => n.endsWith('.json'));

test('the fixtures cover at least three schema versions', t => {
  const versions = new Set(files.map(n => JSON.parse(fs.readFileSync(path.join(FIXTURES, n), 'utf8'))._schemaVersion));
  t.assert.ok(versions.size >= 3, [...versions].join(', '));
});

for (const name of files) {
  const tag = path.basename(name, '.json');
  test(`a config saved by ${tag} loads through every migration`, t => {
    fs.writeFileSync(CONFIG, fs.readFileSync(path.join(FIXTURES, name)));
    const loaded = loadConfigForUpdate();
    t.assert.equal(loaded._schemaVersion, SCHEMA_VERSION);
    t.assert.snapshot(loaded);

    const written = fs.readFileSync(CONFIG, 'utf8');
    t.assert.deepEqual(loadConfigForUpdate(), loaded, 'a second load changes nothing');
    t.assert.equal(fs.readFileSync(CONFIG, 'utf8'), written, 'a second load writes nothing');
  });
}
