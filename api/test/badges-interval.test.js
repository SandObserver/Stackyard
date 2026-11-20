const { startApp, fakeUpstream } = require('../test-support/app');
const app = startApp({ label: 'badge-interval', env: { ALLOW_PRIVATE_IPS: 'true' } });

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { saveConfig } = require('../src/config');

let upstreamBase;
let hits = 0;
let n = 1;
let drop = false;
const realNow = Date.now;

before(async () => {
  ({ url: upstreamBase } = await fakeUpstream((req, res) => {
    hits++;
    if (drop) return req.socket.destroy();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ n }));
  }));
});
after(async () => {
  Date.now = realNow;
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

const badges = () => fetch(`${app.base}/api/badges`).then(r => r.json());

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
