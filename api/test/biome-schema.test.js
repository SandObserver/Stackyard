/* P17-4: biome.json pinned a schema version that nothing kept in step.

   It said 2.5.3 while package.json pinned 2.5.6, and every lint run printed a
   "configuration schema version does not match the CLI version" notice.
   Dependabot bumps package.json weekly and never touches biome.json, so the
   gap reopened on its own after every upgrade and could only be closed by
   remembering to edit a second file by hand.

   The fix is to stop naming a version. Biome ships configuration_schema.json
   inside the package, so pointing at that path means the schema is always
   whatever is installed. There is no number to drift.

   These tests keep it that way: a versioned URL is how the problem comes back. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const biome = JSON.parse(fs.readFileSync(path.join(root, 'biome.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const SCHEMA_PATH = './node_modules/@biomejs/biome/configuration_schema.json';

test('the schema is resolved from the installed package', () => {
  assert.equal(biome.$schema, SCHEMA_PATH,
    'point $schema at the installed package so a version bump cannot leave it behind');
});

/* The specific regression: a URL carries a version, and a version drifts. */
test('the schema is not a versioned URL', () => {
  assert.ok(!/^https?:/.test(biome.$schema), '$schema must not be a remote URL');
  assert.ok(!/\d+\.\d+\.\d+/.test(biome.$schema),
    `$schema names a version (${biome.$schema}); Dependabot will not update it`);
});

/* If the package ever stops shipping the schema, or moves it, the path becomes
   a dead reference that only an editor would notice. Biome itself does not read
   it, so nothing else would fail. */
test('the file the schema points at exists', () => {
  const full = path.join(root, biome.$schema);
  assert.ok(fs.existsSync(full), `${biome.$schema} is missing; has the package layout changed?`);
});

test('it is a real JSON Schema for the Biome configuration', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, biome.$schema), 'utf8'));
  assert.match(schema.$schema, /json-schema\.org/);
  assert.equal(schema.title, 'Configuration');
  for (const key of Object.keys(biome)) {
    if (key === '$schema') continue;
    assert.ok(key in schema.properties, `biome.json sets "${key}", which the schema does not define`);
  }
});

/* Biome is the only thing this arrangement depends on being present. */
test('biome is a pinned dev dependency', () => {
  const v = pkg.devDependencies?.['@biomejs/biome'];
  assert.ok(v, '@biomejs/biome must be a devDependency');
  assert.match(v, /^\d+\.\d+\.\d+$/, `pin an exact version, got "${v}"`);
});
