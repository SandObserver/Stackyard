const { tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = tmpPath('apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { saveConfig } = require('../src/config');
const { isAuthenticated, makeToken } = require('../src/auth');

const SECRET = 'b'.repeat(64);
saveConfig({ items: [], settings: { auth: { enabled: true, secret: SECRET, passwordHash: '$scrypt$x' } } });
const valid = makeToken('owner-session', SECRET);
const as = cookie => isAuthenticated({ headers: { cookie } });

/* A host on the same parent domain can set `ds` with Domain=, and the browser
   sends both. Either order must keep the owner signed in. */
test('a planted session cookie does not hide the real one', () => {
  assert.equal(as(`ds=${valid}; ds=planted`), true);
  assert.equal(as(`ds=planted; ds=${valid}`), true);
});

test('only planted or revoked cookies are still refused', () => {
  assert.equal(as('ds=planted; ds=other'), false);
  saveConfig({
    items: [],
    settings: {
      auth: {
        enabled: true,
        secret: SECRET,
        passwordHash: '$scrypt$x',
        revoked: { 'owner-session': Date.now() + 60_000 },
      },
    },
  });
  assert.equal(as(`ds=planted; ds=${valid}`), false);
});
