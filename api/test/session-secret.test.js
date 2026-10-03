const path = require('node:path');
const fs = require('node:fs');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('secret'), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getOrCreateSecret, rotateSessionSecret, newSessionSecret } = require('../src/auth');
const { loadConfig, saveConfig } = require('../src/config');

const HEX32 = /^[0-9a-f]{64}$/;

test('getOrCreateSecret mints a secret when none is stored', () => {
  const first = getOrCreateSecret();
  assert.match(first, HEX32);
  assert.equal(loadConfig().settings.auth.secret, first, 'and stores it');
});

test('getOrCreateSecret reuses the stored secret', () => {
  const first = getOrCreateSecret();
  assert.equal(getOrCreateSecret(), first);
  assert.equal(getOrCreateSecret(), first, 'still, on a third call');
});

/* The only thing that ever differed between the two. */
test('rotateSessionSecret replaces the stored secret', () => {
  const before = getOrCreateSecret();
  const rotated = rotateSessionSecret();
  assert.match(rotated, HEX32);
  assert.notEqual(rotated, before, 'rotating must not return the old value');
  assert.equal(loadConfig().settings.auth.secret, rotated);
  assert.equal(getOrCreateSecret(), rotated, 'and is what a later read sees');
});

test('rotating twice gives two different secrets', () => {
  assert.notEqual(rotateSessionSecret(), rotateSessionSecret());
});

/* Both wrappers must produce what newSessionSecret produces, since that is now
   the single definition of the key's strength and encoding. */
test('the stored secret has the shape newSessionSecret produces', () => {
  assert.match(newSessionSecret(), HEX32);
  assert.equal(rotateSessionSecret().length, newSessionSecret().length);
});

test('both work on a config with no settings block at all', () => {
  const stored = () => JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, 'utf8')).settings?.auth?.secret;
  const old = getOrCreateSecret();

  saveConfig({ items: [] });
  const created = getOrCreateSecret();
  assert.match(created, HEX32);
  assert.notEqual(created, old, 'the cached secret must not be returned');
  assert.equal(stored(), created);

  saveConfig({ items: [] });
  const rotated = rotateSessionSecret();
  assert.match(rotated, HEX32);
  assert.equal(stored(), rotated);
});
