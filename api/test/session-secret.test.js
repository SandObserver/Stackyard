/* getOrCreateSecret and rotateSessionSecret, which write config.

   Their own file with a throwaway CONFIG_PATH, because auth.test.js points at a
   fixed path it expects never to exist and both of these create it. A test that
   writes to a shared fixed path leaves the next run reading whatever the last
   one stored.

   P2-7, P2-9, P2-10: the two were the same function apart from one
   short-circuit, and the random value they produce was written inline at four
   call sites, so the strength and encoding of the key that signs every session
   was defined in four places. */

const path = require('node:path');
const fs = require('node:fs');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('secret'), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getOrCreateSecret, rotateSessionSecret, newSessionSecret } = require('../src/auth');
const { loadConfig } = require('../src/config');

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

/* The block is created rather than assumed, which is what the inline call sites
   each had to remember to do. */
test('both work on a config with no settings block at all', () => {
  fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ items: [] }));
  assert.match(getOrCreateSecret(), HEX32);
  fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ items: [] }));
  assert.match(rotateSessionSecret(), HEX32);
});
