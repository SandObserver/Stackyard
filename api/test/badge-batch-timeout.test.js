/* /api/badges answers only when every item has settled, so the batch is as slow
   as its slowest item. It used the same 6s deadline as a connection test a user
   runs by hand and waits for, which let one dead service hold up every other
   tile's refresh on every poll. */

const { startApp, fakeUpstream } = require('../test-support/app');
const app = startApp({ label: 'badge-batch', env: { ALLOW_PRIVATE_IPS: 'true' } });

const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { saveConfig } = require('../src/config');
const { PING_MS, BATCH_MS } = require('../src/timeouts');

let fastBase, slowBase;
const open = new Set();

before(async () => {
  ({ url: fastBase } = await fakeUpstream((_, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ pending: 5 }));
  }));
  /* Accepts the connection and never answers, which is what a hung service
     looks like. A refused port would return immediately instead. */
  ({ url: slowBase } = await fakeUpstream(req => open.add(req)));
});

function get(pathname) {
  const u = new URL(app.base + pathname);
  return new Promise((resolve, reject) => {
    http
      .request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET' }, res => {
        let b = '';
        res.on('data', c => {
          b += c;
        });
        res.on('end', () => resolve(JSON.parse(b)));
      })
      .on('error', reject)
      .end();
  });
}

test('the batch deadline is shorter than a hand-run connection test', () => {
  assert.ok(BATCH_MS < PING_MS, `${BATCH_MS} should be under ${PING_MS}`);
});

test('one hung service does not add its full timeout to the rest of the batch', async () => {
  saveConfig({
    items: [
      { id: 'good', type: 'app', name: 'Good', badge: { enabled: true, url: `${fastBase}/x`, extract: 'pending' } },
      { id: 'hung', type: 'app', name: 'Hung', badge: { enabled: true, url: `${slowBase}/x`, extract: 'pending' } },
    ],
    settings: {},
  });

  const started = Date.now();
  const body = await get('/api/badges');
  const elapsed = Date.now() - started;

  assert.equal(body.good.value, 5, 'the reachable item still reports its value');
  assert.ok(body.hung.error, 'the hung item reports a failure');
  assert.ok(elapsed < PING_MS, `the batch took ${elapsed}ms, which is the old deadline or worse`);
});
