const fs = require('node:fs');
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
const { saveConfig, loadConfig } = require('../src/config');

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
      {
        id: 'w-inherited',
        type: 'widget',
        widgetType: 'books',
        widgetConfig: { provider: 'constructor', absUrl: realBase, absKey: SECRET_VALUE, komgaKey: SECRET_VALUE },
      },
    ],
    settings: { background: { apiKey: SECRET_VALUE } },
  });

  server = http.createServer(dispatch);
  base = await listen(server);
});

after(async () => {
  await close(server);
  await close(realSrv);
  await close(evilSrv);
});

function request(method, pathname, body, { origin = base } = {}) {
  const data = body == null ? '' : JSON.stringify(body);
  const u = new URL(base + pathname);
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
  if (origin) headers.Origin = origin;
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
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
          resolve({ status: res.statusCode, body: j, raw: b });
        });
      },
    );
    r.on('error', reject);
    r.end(data);
  });
}

const post = (pathname, body, opts) => request('POST', pathname, body, opts);
const get = pathname => request('GET', pathname);

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
  assert.equal(realSeen.length, 1, 'the request should still go out, just without the secret');
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
  const r = await post('/api/widget-options/w1', {
    widgetType: 'books',
    endpoint: 'lists',
    widgetConfig: { provider: 'audiobookshelf', absUrl: evilBase },
  });
  assert.equal(r.body.code, 'invalid.retype', 'the widget should run without the stored credential');
  assert.ok(!sawSecret(evilSeen), `the stored credential leaked: ${JSON.stringify(evilSeen)}`);
});

test('widget-options reports a plain failure when no stored credential was held back', async () => {
  const r = await post('/api/widget-options/w1', {
    widgetType: 'books',
    endpoint: 'lists',
    widgetConfig: { provider: 'audiobookshelf', absUrl: 'http://127.0.0.1:9', absKey: 'typed-now' },
  });
  assert.notEqual(r.body.code, 'invalid.retype');
  assert.equal(r.body.kind, 'network');
});

test('widget-options sends no stored credential for an id that is not saved', async () => {
  realSeen.length = 0;
  const r = await post('/api/widget-options/__preview__', {
    widgetType: 'books',
    endpoint: 'lists',
    widgetConfig: { provider: 'audiobookshelf', absUrl: realBase },
  });
  assert.match(r.body.error, /API key required/, 'the widget should run without the stored credential');
  assert.ok(!sawSecret(realSeen), `the stored credential leaked: ${JSON.stringify(realSeen)}`);
});

/* ── responses to the browser ─────────────────────────────────────────────── */

for (const pathname of ['/api/config', '/api/config/export']) {
  test(`${pathname} returns the saved items without any stored secret`, async () => {
    const r = await get(pathname);
    assert.equal(r.status, 200);
    const app = r.body.items.find(i => i.id === 'app1');
    assert.equal(app.badge.headers[0].key, 'X-Api-Key');
    assert.equal(r.body.items.find(i => i.id === 'w1').widgetConfig.absUrl, realBase);
    assert.ok(!r.raw.includes(SECRET_VALUE), `a stored secret leaked: ${r.raw}`);
  });
}

test('/api/widget-config returns the saved config without the stored secret', async () => {
  const r = await get('/api/widget-config/w1');
  assert.equal(r.status, 200);
  assert.equal(r.body.widgetConfig.absUrl, realBase);
  assert.ok(!r.raw.includes(SECRET_VALUE), `a stored secret leaked: ${r.raw}`);
});

test('/api/widget-data does not return the config when the provider names an inherited member', async () => {
  realSeen.length = 0;
  const r = await get('/api/widget-data/w-inherited');
  assert.ok(realSeen.length > 0, 'the default provider should run instead');
  assert.ok(!r.raw.includes(SECRET_VALUE), `a stored secret leaked: ${r.raw}`);
});

test('the Unsplash key is reported as set, stored on write and never returned', async () => {
  assert.deepEqual((await get('/api/settings/unsplash-key')).body, { configured: true });
  assert.equal((await post('/api/settings/unsplash-key', { apiKey: 'REFUSED' }, { origin: null })).status, 403);
  assert.equal(loadConfig().settings.background.apiKey, SECRET_VALUE);
  assert.equal((await post('/api/settings/unsplash-key', { apiKey: ' NEW-KEY ' })).status, 200);
  assert.equal(loadConfig().settings.background.apiKey, 'NEW-KEY');
  assert.ok(!(await get('/api/config')).raw.includes('NEW-KEY'));
  assert.equal((await post('/api/settings/unsplash-key', { apiKey: '' })).status, 200);
  assert.deepEqual((await get('/api/settings/unsplash-key')).body, { configured: false });
});

test('a failed Unsplash key save leaves the served config unchanged', async () => {
  const rev = (await get('/api/config')).body._rev;
  const real = fs.renameSync;
  fs.renameSync = () => {
    throw new Error('disk full');
  };
  let status;
  try {
    status = (await post('/api/settings/unsplash-key', { apiKey: 'NOT-SAVED' })).status;
  } finally {
    fs.renameSync = real;
  }
  assert.notEqual(status, 200);
  assert.deepEqual((await get('/api/settings/unsplash-key')).body, { configured: false });
  assert.equal((await get('/api/config')).body._rev, rev);
});
