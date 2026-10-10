const path = require('node:path');

process.env.ALLOW_PRIVATE_IPS = 'true';
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('badge-interval'), 'apps.json');

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');

let server, base, upstream, upstreamBase;
let hits = 0;
let n = 1;
let drop = false;
const realNow = Date.now;

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const close = s =>
  new Promise(r => {
    s.closeAllConnections?.();
    s.close(r);
  });

before(async () => {
  upstream = http.createServer((req, res) => {
    hits++;
    if (drop) return req.socket.destroy();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ n }));
  });
  upstreamBase = await listen(upstream);
  server = http.createServer(dispatch);
  base = await listen(server);
});
after(async () => {
  Date.now = realNow;
  await close(server);
  await close(upstream);
});

let run = 0;
function configure(activity = {}) {
  saveConfig({
    items: [
      {
        id: 'a1',
        type: 'app',
        label: 'App',
        href: 'http://x',
        monitoring: { activity: { enabled: true, url: `${upstreamBase}/api?run=${run}`, extract: 'n', ...activity } },
      },
    ],
    settings: {},
  });
}

beforeEach(() => {
  Date.now = realNow;
  run++;
  hits = 0;
  n = 1;
  drop = false;
});

const badges = () => fetch(`${base}/api/badges`).then(r => r.json());

test('polls inside the interval reuse the last reading', async () => {
  configure({ interval: 3600 });
  for (let i = 0; i < 5; i++) assert.equal((await badges()).a1.value, 1);
  assert.equal(hits, 1);
});

test('a poll after the interval reads the service again', async () => {
  configure({ interval: 60 });
  await badges();
  n = 2;
  const start = realNow();
  Date.now = () => start + 61_000;
  assert.equal((await badges()).a1.value, 2);
  assert.equal(hits, 2);
});

test('an edited badge is read at once', async () => {
  configure({ interval: 3600 });
  await badges();
  n = 5;
  configure({ interval: 3600, extract: 'n', params: [{ key: 'x', value: '1', secret: false }] });
  assert.equal((await badges()).a1.value, 5);
  assert.equal(hits, 2);
});

test('an interval below ten seconds is read as ten', async () => {
  configure({ interval: 1 });
  await badges();
  const start = realNow();
  Date.now = () => start + 5_000;
  await badges();
  assert.equal(hits, 1);
});

test('a failed read is not reused', async () => {
  configure({ interval: 3600 });
  drop = true;
  assert.ok((await badges()).a1.kind);
  drop = false;
  assert.equal((await badges()).a1.value, 1);
  assert.equal(hits, 2);
});
