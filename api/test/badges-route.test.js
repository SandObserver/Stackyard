const path = require('node:path');

process.env.ALLOW_PRIVATE_IPS = 'true';
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('badges'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');

let server, base, upstream, upstreamBase;
let upstreamBody = {};

const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const close = s =>
  new Promise(r => {
    s.closeAllConnections?.();
    s.close(r);
  });

before(async () => {
  upstream = http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(upstreamBody));
  });
  upstreamBase = await listen(upstream);
  server = http.createServer(dispatch);
  base = await listen(server);
});
after(async () => {
  await close(server);
  await close(upstream);
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

function configure(extract) {
  saveConfig({
    items: [
      {
        id: 'a1',
        type: 'app',
        name: 'App',
        badge: { enabled: true, url: `${upstreamBase}/api/counts`, extract },
      },
    ],
    settings: {},
  });
}

test('a badge reports the extracted value', async () => {
  upstreamBody = { pending: 7 };
  configure('pending');
  assert.equal((await get('/api/badges')).a1.value, 7);
});

test('the response carries no copy of the upstream body', async () => {
  upstreamBody = { pending: 7, library: ['a', 'b'], user: 'admin@example.com' };
  configure('pending');
  const body = await get('/api/badges');

  assert.deepEqual(Object.keys(body.a1), ['value'], 'value is the whole contract');
  assert.equal(body.a1.raw, undefined);
  const text = JSON.stringify(body);
  assert.ok(!text.includes('admin@example.com'), 'unrelated upstream fields must not be forwarded');
  assert.ok(!text.includes('library'));
});

/* The size argument, since bodies are bounded only by FETCH_SIZE_LIMIT. */
test('a large upstream body does not enlarge the response', async () => {
  upstreamBody = { pending: 3, blob: 'x'.repeat(200_000) };
  configure('pending');
  const body = await get('/api/badges');
  assert.equal(body.a1.value, 3);
  assert.ok(JSON.stringify(body).length < 200, 'the poll must stay small regardless of upstream size');
});

/* A failing badge still reports an error shape rather than a bare value, which
   the dashboard's stale handling depends on. */
test('an unreachable upstream still answers with a value of zero', async () => {
  saveConfig({
    items: [
      { id: 'a1', type: 'app', name: 'App', badge: { enabled: true, url: 'http://127.0.0.1:1/', extract: 'pending' } },
    ],
    settings: {},
  });
  const r = (await get('/api/badges')).a1;
  assert.equal(r.value, 0);
  assert.ok(r.error, 'the failure must still be reported');
});

/* A dead target costs a full timeout on every cycle, and the batch answers only
   when everything has settled. After a few failures it is left alone and the
   failure it already reported is reused. */
test('a target that keeps failing stops being contacted', async () => {
  const backoff = require('../src/poll-backoff');
  backoff.reset();
  let hits = 0;
  const flaky = http.createServer((_, res) => {
    hits++;
    res.destroy();
  });
  const flakyBase = await listen(flaky);
  try {
    saveConfig({
      items: [
        { id: 'a1', type: 'app', name: 'App', badge: { enabled: true, url: `${flakyBase}/x`, extract: 'pending' } },
      ],
      settings: {},
    });
    for (let i = 0; i < backoff.FAILURES_BEFORE_BACKOFF; i++) await get('/api/badges');
    const contacted = hits;
    assert.equal(contacted, backoff.FAILURES_BEFORE_BACKOFF, 'every early cycle reaches the target');

    const r = (await get('/api/badges')).a1;
    assert.equal(hits, contacted, 'the target is not contacted again while backed off');
    assert.equal(r.value, 0);
    assert.ok(r.error, 'the remembered failure is reported, not a silent zero');
  } finally {
    backoff.reset();
    await close(flaky);
  }
});
