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

/* A fresh id per test. The poll backoff is keyed by item id and outlives one
   test, so a reused id serves a remembered body instead of polling. */
let _labelSeq = 0;
function configureLabels(labels, combine, extract) {
  const id = `lbl${++_labelSeq}`;
  saveConfig({
    items: [
      {
        id,
        type: 'app',
        name: 'App',
        monitoring: {
          activity: { enabled: true, url: `${upstreamBase}/api/counts`, labels, combine, extract },
        },
      },
    ],
    settings: {},
  });
  return id;
}

test('labels report one value each, and the badge value is the first that fires', async () => {
  upstreamBody = { pending: 0, approved: 142, declined: 7 };
  const id = configureLabels([{ path: 'pending' }, { path: 'approved' }, { path: 'declined' }]);
  const body = await get('/api/badges');
  assert.deepEqual(body[id].values, [0, 142, 7]);
  assert.equal(body[id].value, 142);
});

test('a per-label minimum decides which label the badge value comes from', async () => {
  upstreamBody = { pending: 3, approved: 142 };
  const id = configureLabels([{ path: 'pending', min: 10 }, { path: 'approved' }]);
  const body = await get('/api/badges');
  assert.equal(body[id].value, 142);
});

test('no firing label reports zero rather than the first value', async () => {
  upstreamBody = { pending: 0, approved: 0 };
  const id = configureLabels([{ path: 'pending' }, { path: 'approved' }]);
  assert.equal((await get('/api/badges'))[id].value, 0);
});

test('combine keeps the summed single value and sends no label list', async () => {
  upstreamBody = { pending: 3, approved: 4 };
  const id = configureLabels([{ path: 'pending' }, { path: 'approved' }], true, [
    { path: 'pending' },
    { path: 'approved' },
  ]);
  const body = await get('/api/badges');
  assert.equal(body[id].values, undefined);
  assert.equal(body[id].value, 7);
});

test('a label the config left without a path keeps its slot in the value list', async () => {
  upstreamBody = { approved: 5 };
  const id = configureLabels([{ name: 'broken' }, { path: 'approved' }]);
  assert.deepEqual((await get('/api/badges'))[id].values, [0, 5]);
});

test('a labels list of the wrong type falls back to the summed value', async () => {
  upstreamBody = { pending: 3, approved: 4 };
  const id = configureLabels('not-an-array', false, [{ path: 'pending' }, { path: 'approved' }]);
  const body = await get('/api/badges');
  assert.equal(body[id].values, undefined);
  assert.equal(body[id].value, 7);
});

test('an empty labels list falls back to the summed value', async () => {
  upstreamBody = { pending: 3 };
  const id = configureLabels([], false, 'pending');
  assert.equal((await get('/api/badges'))[id].value, 3);
});

test('labels survive an upstream body that is not an object', async () => {
  upstreamBody = [1, 2, 3];
  const id = configureLabels([{ path: 'pending' }, { path: '$count' }]);
  const body = await get('/api/badges');
  assert.deepEqual(body[id].values, [0, 3]);
});

test('a label list far longer than the response still answers', async () => {
  upstreamBody = { a: 1 };
  const many = Array.from({ length: 200 }, (_, n) => ({ path: `missing${n}` }));
  many[150] = { path: 'a' };
  const id = configureLabels(many);
  const body = await get('/api/badges');
  assert.equal(body[id].values.length, 200);
  assert.equal(body[id].value, 1, 'the only firing label owns the value');
});

test('a label whose path names a prototype key reports zero', async () => {
  upstreamBody = { pending: 2 };
  const id = configureLabels([{ path: '__proto__' }, { path: 'constructor' }, { path: 'pending' }]);
  assert.deepEqual((await get('/api/badges'))[id].values, [0, 0, 2]);
});

test('duplicate paths each report their own slot', async () => {
  upstreamBody = { pending: 6 };
  const id = configureLabels([{ path: 'pending' }, { path: 'pending' }]);
  assert.deepEqual((await get('/api/badges'))[id].values, [6, 6]);
});

/* Configs written before labels existed. These shapes are still on disk in
   every dashboard that has not been re-saved. */
test('a legacy badge block with a single extract path is unchanged', async () => {
  upstreamBody = { pending: 5 };
  configure('pending');
  const body = await get('/api/badges');
  assert.deepEqual(Object.keys(body.a1), ['value'], 'no values key is added');
  assert.equal(body.a1.value, 5);
});

test('a legacy badge block with several extract paths still sums them', async () => {
  upstreamBody = { a: 2, b: 3, c: 4 };
  configure([{ path: 'a' }, { path: 'b' }, { path: 'c' }]);
  assert.equal((await get('/api/badges')).a1.value, 9);
});

test('a monitoring.activity block with no labels still sums its extract paths', async () => {
  upstreamBody = { a: 2, b: 3 };
  const id = configureLabels(undefined, undefined, [{ path: 'a' }, { path: 'b' }]);
  const body = await get('/api/badges');
  assert.equal(body[id].values, undefined, 'an old config gets no label list');
  assert.equal(body[id].value, 5);
});
