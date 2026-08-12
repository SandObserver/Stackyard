/* /api/badges answers only when every item has settled, so the batch is as slow
   as its slowest item. It used the same 6s deadline as a connection test a user
   runs by hand and waits for, which let one dead service hold up every other
   tile's refresh on every poll. */

const path = require('node:path');

process.env.ALLOW_PRIVATE_IPS = 'true';
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('badge-batch'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const { PING_MS, BATCH_MS } = require('../src/timeouts');

let server, base, fast, fastBase, slow, slowBase;
const open = new Set();

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const close = s =>
  new Promise(r => {
    s.closeAllConnections?.();
    s.close(r);
  });

before(async () => {
  fast = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ pending: 5 }));
  });
  fastBase = await listen(fast);
  /* Accepts the connection and never answers, which is what a hung service
     looks like. A refused port would return immediately instead. */
  slow = http.createServer(req => open.add(req));
  slowBase = await listen(slow);
  server = http.createServer(dispatch);
  base = await listen(server);
});
after(async () => {
  await close(server);
  await close(fast);
  await close(slow);
});

function get(pathname) {
  const u = new URL(base + pathname);
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
