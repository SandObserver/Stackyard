const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('namelimit'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { loadConfig, saveConfig } = require('../src/config');
const { NAME_MAX } = require('../../ui/js/limits.js');

let server, base;

before(async () => {
  saveConfig({ items: [], settings: {} });
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('a saved name is cut to the name limit', async () => {
  const long = 'N'.repeat(2000);
  const r = await fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({
      items: [
        { id: 'a', type: 'app', label: long, href: 'http://a.lan' },
        { id: 'f', type: 'folder', label: long, children: ['a'] },
        { id: 'b', type: 'app', label: 'Short', href: 'http://b.lan' },
      ],
      settings: {},
    }),
  });
  assert.equal(r.status, 200);
  const labels = loadConfig()
    .items.filter(i => ['a', 'f', 'b'].includes(i.id))
    .map(i => i.label);
  assert.deepEqual(labels, ['N'.repeat(NAME_MAX), 'N'.repeat(NAME_MAX), 'Short']);
});
