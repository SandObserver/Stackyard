/* Regression tests for P4-11, P6-9 and P5-6: the polling routes had no ceiling.

   /api/badges, /api/health, /api/widget-data/:id and /api/widget-options/:id all
   reach out to the user's own services, and none of them was rate limited. 40
   rapid requests to /api/badges produced 40 requests to the backing service.

   The ceiling is not about protecting Stackyard, which does little work here. It
   bounds how fast one client can drive traffic at someone's homelab: a dashboard
   left open on several devices, or a browser stuck in a reload loop, multiplies
   straight through.

   Limits are derived from the dashboard's real poll intervals with headroom for
   ten devices behind one address; see poll-limits.js. Ordinary use never comes
   near them, which the last test here pins. */

const path = require('node:path');

const { tmpDir, tmpPath } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('polllimit'), 'apps.json');
process.env.ALLOW_PRIVATE_IPS = 'true';

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
require('../src/widget-data');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const { _resetRateLimits } = require('../src/auth');
const LIMITS = require('../src/poll-limits');

let server, base, upstream, upstreamHits = 0;

before(async () => {
  upstream = http.createServer((_, res) => {
    upstreamHits++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"count":1}');
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const upUrl = `http://127.0.0.1:${upstream.address().port}/api`;

  saveConfig({
    items: [{ id: 'a1', type: 'app', name: 'A', href: 'https://a', badge: { enabled: true, url: upUrl, interval: 30 } }],
    settings: {},
  });

  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => { server.closeAllConnections?.(); server.close(r); });
  await new Promise(r => { upstream.closeAllConnections?.(); upstream.close(r); });
});

beforeEach(() => { upstreamHits = 0; if (_resetRateLimits) _resetRateLimits(); });

function req(method, pathname) {
  const u = new URL(base + pathname);
  const body = method === 'POST' ? '{}' : null;
  return new Promise((resolve, reject) => {
    /* Content-Length only when there is a body: declaring one on a GET leaves
       the server waiting for bytes that never arrive. */
    const headers = { Origin: base };
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers },
      res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.end(body ?? undefined);
  });
}

async function burst(method, pathname, n) {
  let limited = 0;
  for (let i = 0; i < n; i++) if (await req(method, pathname) === 429) limited++;
  return limited;
}

/* ── each route has a ceiling ─────────────────────────────────────────────── */

test('badges is limited', async () => {
  const limited = await burst('GET', '/api/badges', LIMITS.BADGES.max + 10);
  assert.equal(limited, 10, 'requests past the limit should be refused');
});

test('health is limited', async () => {
  const limited = await burst('GET', '/api/health', LIMITS.HEALTH.max + 5);
  assert.equal(limited, 5);
});

test('widget-data is limited', async () => {
  const limited = await burst('GET', '/api/widget-data/w1', LIMITS.WIDGET_DATA.max + 5);
  assert.equal(limited, 5);
});

test('widget-options is limited', async () => {
  const limited = await burst('POST', '/api/widget-options/w1', LIMITS.WIDGET_OPTIONS.max + 5);
  assert.equal(limited, 5);
});

/* The point of all four: a burst must not become a burst against the user's own
   services. */
test('a refused request never reaches the upstream service', async () => {
  await burst('GET', '/api/badges', LIMITS.BADGES.max + 40);
  assert.equal(upstreamHits, LIMITS.BADGES.max,
    `${upstreamHits} upstream requests for ${LIMITS.BADGES.max + 40} calls`);
});

/* Counted per widget id, since that is what maps to one upstream service. One
   busy widget must not silence the others. */
test('widget-data counts each widget separately', async () => {
  await burst('GET', '/api/widget-data/w1', LIMITS.WIDGET_DATA.max + 5);
  assert.notEqual(await req('GET', '/api/widget-data/w2'), 429,
    'a different widget should still be reachable');
});

/* ── the limits fit real use ──────────────────────────────────────────────── */

/* The property that makes these safe: being refused means something is wrong,
   not that a household is busy. The dashboard polls badges every 20s, health
   every 30s and each widget every 30s. */
test('a minute of normal polling from ten devices stays well inside every limit', () => {
  const DEVICES = 10;
  const perMinute = {
    BADGES: (60 / 20) * DEVICES,
    HEALTH: (60 / 30) * DEVICES,
    WIDGET_DATA: (60 / 30) * DEVICES,
    WIDGET_OPTIONS: 1 * DEVICES,
  };
  for (const [name, used] of Object.entries(perMinute)) {
    const { max } = LIMITS[name];
    assert.ok(used <= max / 2,
      `${name}: ten devices use ${used}/min against a ${max}/min limit, leaving no room for a focus refetch`);
  }
});

test('one open tab uses a small share of the allowance', () => {
  const used = 60 / 20;   /* badges, the fastest poll */
  assert.ok(used / LIMITS.BADGES.max < 0.1,
    `one tab uses ${Math.round((used / LIMITS.BADGES.max) * 100)}% of the badges allowance`);
});
