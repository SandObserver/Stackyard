/* End-to-end proof that neither endpoint delivers a stored credential to a
   destination the caller chose (P5-1).

   The unit tests in secret-scope.test.js pin the rule. These run the real
   routes against two stub upstreams, a "real" one and an attacker-controlled
   one, and assert the secret only ever reaches the first.

   Needs ALLOW_PRIVATE_IPS so the stubs are reachable, hence its own process. */

const path = require('node:path');

process.env.ALLOW_PRIVATE_IPS = 'true';
process.env.WIDGETS_PATH = path.join(__dirname, '../../ui/widgets');
const { tmpDir } = require('../test-support/tmp');
const _tmp = tmpDir('scope');
process.env.CONFIG_PATH = path.join(_tmp, 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
require('../src/widget-data'); /* registers /api/widget-options, loaded by server.js in production */
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');

const SECRET_VALUE = 'STORED-CREDENTIAL-DO-NOT-LEAK';

let server, base, realSrv, realBase, evilSrv, evilBase;
const realSeen = [];
const evilSeen = [];

function stub(sink) {
  return http.createServer((req, res) => {
    sink.push({ url: req.url, headers: req.headers });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"count":1}');
  });
}
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`)));
const close = s =>
  new Promise(r => {
    s.closeAllConnections?.();
    s.close(r);
  });

before(async () => {
  realSrv = stub(realSeen);
  realBase = await listen(realSrv);
  evilSrv = stub(evilSeen);
  evilBase = await listen(evilSrv);

  saveConfig({
    items: [
      {
        id: 'app1',
        type: 'app',
        name: 'App',
        badge: {
          enabled: true,
          url: `${realBase}/api`,
          headers: [{ key: 'X-Api-Key', value: SECRET_VALUE, secret: true }],
          params: [{ key: 'mode', value: 'full', secret: false }],
        },
      },
      {
        id: 'w1',
        type: 'widget',
        widgetType: 'books',
        widgetConfig: { provider: 'audiobookshelf', absUrl: realBase, absKey: SECRET_VALUE },
      },
    ],
    settings: {},
  });

  server = http.createServer(dispatch);
  base = await listen(server);
});

after(async () => {
  await close(server);
  await close(realSrv);
  await close(evilSrv);
});

function post(pathname, body) {
  const data = JSON.stringify(body);
  const u = new URL(base + pathname);
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: base },
      },
      res => {
        let b = '';
        res.on('data', c => {
          b += c;
        });
        res.on('end', () => {
          let j = null;
          try {
            j = JSON.parse(b);
          } catch {}
          resolve({ status: res.statusCode, body: j });
        });
      },
    );
    r.on('error', reject);
    r.end(data);
  });
}

const sawSecret = seen => seen.some(r => JSON.stringify(r).includes(SECRET_VALUE));

/* ── badge-proxy ──────────────────────────────────────────────────────────── */

test('badge-proxy sends the stored credential to the saved destination', async () => {
  realSeen.length = 0;
  const r = await post('/api/badge-proxy', {
    itemId: 'app1',
    url: `${realBase}/api`,
    headers: [{ key: 'X-Api-Key', secret: true }],
    params: [{ key: 'mode', value: 'full', secret: false }],
  });
  assert.equal(r.status, 200);
  assert.equal(realSeen[0].headers['x-api-key'], SECRET_VALUE, 'a normal test must still work');
});

test('badge-proxy does not send the stored credential to a caller-chosen host', async () => {
  evilSeen.length = 0;
  await post('/api/badge-proxy', {
    itemId: 'app1',
    url: `${evilBase}/collect`,
    headers: [{ key: 'X-Api-Key', secret: true }],
    params: [{ key: 'mode', value: 'full', secret: false }],
  });
  assert.equal(evilSeen.length, 1, 'the request should still go out, just without the secret');
  assert.ok(!sawSecret(evilSeen), `the stored credential leaked: ${JSON.stringify(evilSeen)}`);
});

test('badge-proxy does not leak via a changed non-secret param either', async () => {
  evilSeen.length = 0;
  realSeen.length = 0;
  await post('/api/badge-proxy', {
    itemId: 'app1',
    url: `${realBase}/api`,
    headers: [{ key: 'X-Api-Key', secret: true }],
    params: [{ key: 'mode', value: 'CHANGED', secret: false }],
  });
  assert.ok(!sawSecret(realSeen), 'a config that no longer matches must not reuse the credential');
});

/* ── widget-options ───────────────────────────────────────────────────────── */

test('widget-options sends the stored credential to the saved destination', async () => {
  realSeen.length = 0;
  await post('/api/widget-options/w1', {
    widgetType: 'books',
    endpoint: 'lists',
    widgetConfig: { provider: 'audiobookshelf', absUrl: realBase },
  });
  assert.ok(sawSecret(realSeen), 'a normal fetch must still use the stored credential');
});

test('widget-options does not send the stored credential to a caller-chosen host', async () => {
  evilSeen.length = 0;
  await post('/api/widget-options/w1', {
    widgetType: 'books',
    endpoint: 'lists',
    widgetConfig: { provider: 'audiobookshelf', absUrl: evilBase },
  });
  assert.ok(!sawSecret(evilSeen), `the stored credential leaked: ${JSON.stringify(evilSeen)}`);
});

test('widget-options ignores an id that is not saved', async () => {
  evilSeen.length = 0;
  await post('/api/widget-options/__preview__', {
    widgetType: 'books',
    endpoint: 'lists',
    widgetConfig: { provider: 'audiobookshelf', absUrl: evilBase },
  });
  assert.ok(!sawSecret(evilSeen));
});
