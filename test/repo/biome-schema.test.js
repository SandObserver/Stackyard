const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const biome = JSON.parse(fs.readFileSync(path.join(root, 'biome.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const SCHEMA_PATH = './node_modules/@biomejs/biome/configuration_schema.json';

test('the schema is resolved from the installed package', () => {
  assert.equal(
    biome.$schema,
    SCHEMA_PATH,
    'point $schema at the installed package so a version bump cannot leave it behind',
  );
});

test('the schema is not a versioned URL', () => {
  assert.ok(!/^https?:/.test(biome.$schema), '$schema must not be a remote URL');
  assert.ok(
    !/\d+\.\d+\.\d+/.test(biome.$schema),
    `$schema names a version (${biome.$schema}); Dependabot will not update it`,
  );
});

/* These two need the package on disk. An absent node_modules is a normal state,
   and Biome does not read $schema, so skipping costs an editor hint only. */
const installed = fs.existsSync(path.join(root, biome.$schema));
const needsPackage = { skip: installed ? false : 'node_modules is not installed' };

test('the file the schema points at exists', needsPackage, () => {
  assert.ok(installed, `${biome.$schema} is missing; has the package layout changed?`);
});

test('it is a real JSON Schema for the Biome configuration', needsPackage, () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, biome.$schema), 'utf8'));
  assert.match(schema.$schema, /json-schema\.org/);
  assert.equal(schema.title, 'Configuration');
  for (const key of Object.keys(biome)) {
    if (key === '$schema') continue;
    assert.ok(key in schema.properties, `biome.json sets "${key}", which the schema does not define`);
  }
});

test('biome is a pinned dev dependency', () => {
  const v = pkg.devDependencies?.['@biomejs/biome'];
  assert.ok(v, '@biomejs/biome must be a devDependency');
  assert.match(v, /^\d+\.\d+\.\d+$/, `pin an exact version, got "${v}"`);
});

test('lint fails on a warning, not only on an error', () => {
  assert.match(
    pkg.scripts.lint,
    /--error-on-warnings/,
    'without this flag the lint gate exits 0 with warnings outstanding',
  );
});
