const path = require('node:path');

process.env.ALLOW_PRIVATE_IPS = 'true';
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('badge-failures'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const backoff = require('../src/poll-backoff');

let server, base, upstream, upstreamBase;
let reply = { status: 200, type: 'application/json', body: '{}' };

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const close = s =>
  new Promise(r => {
    s.closeAllConnections?.();
    s.close(r);
  });

before(async () => {
  upstream = http.createServer((_, res) => {
    res.writeHead(reply.status, { 'Content-Type': reply.type });
    res.end(reply.body);
  });
  upstreamBase = await listen(upstream);
  server = http.createServer(dispatch);
  base = await listen(server);
});
after(async () => {
  await close(server);
  await close(upstream);
});

function configure(activity) {
  backoff.reset();
  saveConfig({
    items: [
      {
        id: 'a1',
        type: 'app',
        label: 'App',
        href: 'http://x',
        monitoring: { activity: { enabled: true, url: `${upstreamBase}/api`, ...activity } },
      },
    ],
    settings: {},
  });
}

const badges = () => fetch(`${base}/api/badges`).then(r => r.json());
const proxy = () =>
  fetch(`${base}/api/badge-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ url: `${upstreamBase}/api` }),
  }).then(async r => ({ status: r.status, body: await r.json() }));

for (const status of [401, 500]) {
  test(`an upstream ${status} is a failed poll, not a value`, async () => {
    configure({ extract: 'queue.total' });
    reply = { status, type: 'application/json', body: '{"queue":{"total":99},"error":"no"}' };
    const { a1 } = await badges();
    assert.equal(a1.kind, 'upstream');
    assert.equal(a1.code, 'upstream.status');
    assert.deepEqual(a1.detail, { status });
    assert.equal(a1.values, undefined);
  });
}

test('an upstream error status does not start the backoff', async () => {
  configure({ extract: 'n' });
  reply = { status: 503, type: 'application/json', body: '{}' };
  for (let i = 0; i < backoff.FAILURES_BEFORE_BACKOFF + 1; i++) await badges();
  assert.equal(backoff.skip('badge:a1'), false);
});

const bigFeed = () =>
  `<MediaContainer>${Array.from({ length: 2000 }, (_, i) => `<Video n="${i}"><Media><Part/></Media></Video>`).join('')}</MediaContainer>`;

test('a truncated XML feed is a failed poll', async () => {
  configure({ extract: 'MediaContainer.Video.$count' });
  reply = { status: 200, type: 'application/xml', body: bigFeed() };
  const { a1 } = await badges();
  assert.equal(a1.code, 'upstream.too-large');
});

test('Fetch reports a truncated XML feed instead of listing its numbers', async () => {
  reply = { status: 200, type: 'application/xml', body: bigFeed() };
  const r = await proxy();
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'upstream.too-large');
});

test('a value too large for a number is a failed poll', async () => {
  configure({ extract: 'n' });
  reply = { status: 200, type: 'application/json', body: '{"n":1e999}' };
  assert.equal((await badges()).a1.code, 'upstream.not-a-number');
});

test('a labelled value too large for a number is a failed poll', async () => {
  configure({ labels: [{ path: 'a' }, { path: 'n' }] });
  reply = { status: 200, type: 'application/json', body: '{"a":2,"n":1e999}' };
  assert.equal((await badges()).a1.code, 'upstream.not-a-number');
});

test('Fetch does not offer a value too large for a number', async () => {
  reply = { status: 200, type: 'application/json', body: '{"a":2,"n":1e999}' };
  const r = await proxy();
  assert.deepEqual(
    r.body.numbers.map(n => n.path),
    ['a'],
  );
});

test('a normal answer still reads as its value', async () => {
  configure({ extract: 'n' });
  reply = { status: 200, type: 'application/json', body: '{"n":4}' };
  assert.deepEqual((await badges()).a1, { value: 4 });
});

test('an unusable value is not kept as the reading for the poll interval', async () => {
  configure({ extract: 'n', interval: 3600 });
  reply = { status: 200, type: 'application/json', body: '{"n":1e999}' };
  assert.equal((await badges()).a1.code, 'upstream.not-a-number');
  reply = { status: 200, type: 'application/json', body: '{"n":6}' };
  assert.deepEqual((await badges()).a1, { value: 6 });
});
