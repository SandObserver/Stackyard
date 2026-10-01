const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('savereply'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');

const SECRET = 'STORED-HEADER-VALUE';
let server, base;

before(async () => {
  saveConfig({
    items: [
      {
        id: 'app1',
        type: 'app',
        label: 'App',
        href: 'https://app.invalid',
        badge: {
          enabled: true,
          url: 'https://app.invalid/api',
          headers: [{ key: 'X-Key', value: SECRET, secret: true }],
        },
      },
    ],
    settings: {},
  });
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => {
    server.closeAllConnections?.();
    server.close(r);
  });
});

async function call(method, body) {
  const res = await fetch(`${base}/api/config`, {
    method,
    headers: body ? { 'Content-Type': 'application/json', Origin: base } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal(res.status, 200);
  return res.json();
}

/* The settings page compares this reply with the next GET to detect a save from
   another tab. Any difference is reported as a conflict. */
test('a config save replies with the list exactly as the next read returns it', async t => {
  const loaded = await call('GET');
  loaded.items[0].label = 'Renamed';
  const reply = await call('POST', loaded);

  assert.ok(Array.isArray(reply.items));
  assert.ok(!JSON.stringify(reply).includes(SECRET), 'the reply must not carry the stored secret');
  assert.equal(JSON.stringify(reply.items), JSON.stringify((await call('GET')).items));

  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 60_000 });
  assert.equal(
    JSON.stringify(reply.items),
    JSON.stringify((await call('GET')).items),
    'a read from the file, past the cache, must match too',
  );
});
