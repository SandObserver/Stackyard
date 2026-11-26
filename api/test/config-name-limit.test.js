const { startApp } = require('../test-support/app');
const app = startApp({ label: 'namelimit' });

const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig, saveConfig } = require('../src/config');
const { NAME_MAX } = require('../../ui/js/limits.js');
const { withRev } = require('../test-support/config-rev');

before(async () => {
  saveConfig({ items: [], settings: {} });
});
test('a saved name is cut to the name limit', async () => {
  const long = 'N'.repeat(2000);
  const r = await fetch(`${app.base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: app.base },
    body: JSON.stringify(
      withRev({
        items: [
          { id: 'a', type: 'app', label: long, href: 'http://a.lan' },
          { id: 'f', type: 'folder', label: long, children: ['a'] },
          { id: 'b', type: 'app', label: 'Short', href: 'http://b.lan' },
        ],
        settings: {},
      }),
    ),
  });
  assert.equal(r.status, 200);
  const labels = loadConfig()
    .items.filter(i => ['a', 'f', 'b'].includes(i.id))
    .map(i => i.label);
  assert.deepEqual(labels, ['N'.repeat(NAME_MAX), 'N'.repeat(NAME_MAX), 'Short']);
});
