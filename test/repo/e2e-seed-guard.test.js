const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SEED_MARK, mayReplace } = require('../../e2e/seed-guard');

const settingsTile = { id: 'settings', type: 'app', system: 'settings' };
const owned = { id: 'nas', type: 'app', label: 'NAS', href: 'http://nas.lan' };

test('a fresh server can be seeded', () => {
  assert.equal(mayReplace({ items: [], settings: {} }, {}), true);
  assert.equal(mayReplace({ items: [settingsTile], settings: {} }, {}), true);
  assert.equal(mayReplace({}, {}), true);
});

test('a config the suite wrote can be replaced', () => {
  assert.equal(mayReplace({ [SEED_MARK]: true, items: [settingsTile, owned] }, {}), true);
});

test('a config with items the suite did not write is refused', () => {
  assert.equal(mayReplace({ items: [settingsTile, owned] }, {}), false);
  assert.equal(mayReplace({ [SEED_MARK]: 'yes', items: [owned] }, {}), false);
});

test('E2E_ALLOW_WIPE=1 allows replacing any config', () => {
  assert.equal(mayReplace({ items: [owned] }, { E2E_ALLOW_WIPE: '1' }), true);
  assert.equal(mayReplace({ items: [owned] }, { E2E_ALLOW_WIPE: 'true' }), false);
});
