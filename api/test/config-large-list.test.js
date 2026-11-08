const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('largelist'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const { preserveAllSecrets } = require('../src/config-secrets');
const { ITEMS_MAX } = require('../../ui/js/limits.js');

const apps = n => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, type: 'app', label: 'A' }));
let server, base;

before(async () => {
  saveConfig({ items: [], settings: {} });
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(r => {
    server.closeAllConnections?.();
    server.close(r);
  });
});

const post = items =>
  fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ items, settings: {} }),
  });

test('a list over the item limit is refused and names the limit', async () => {
  const r = await post(apps(ITEMS_MAX + 1));
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.code, 'invalid.too-many-items');
  assert.equal(body.detail.max, ITEMS_MAX);
});

test('a list at the item limit is accepted', async () => {
  assert.equal((await post(apps(ITEMS_MAX - 1))).status, 200);
});

test('widget group rows count toward the limit', async () => {
  const services = Array.from({ length: ITEMS_MAX + 1 }, (_, i) => ({ id: `r${i}`, type: 'netbird', url: 'http://a' }));
  const r = await post([{ id: 'w', type: 'widget', widgetType: 'connections', widgetConfig: { services } }]);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'invalid.too-many-items');
});

test('a stored list over the limit can still shrink', async () => {
  const stored = apps(ITEMS_MAX + 3);
  saveConfig({ items: stored, settings: {} });
  assert.equal((await post(stored.slice(0, ITEMS_MAX + 1))).status, 200);
  assert.equal((await post(stored)).status, 400);
  saveConfig({ items: [], settings: {} });
});

test('the refill work grows linearly with the list', () => {
  let reads = 0;
  const counted = list =>
    new Proxy(list, {
      get(t, k, r) {
        if (k === 'find') reads++;
        return Reflect.get(t, k, r);
      },
    });
  const items = apps(2000);
  preserveAllSecrets({ items: counted(structuredClone(items)), settings: {} }, { items: counted(items), settings: {} });
  assert.equal(reads, 0);
});

test('the first saved item with an id is the one refilled from', () => {
  const header = value => ({ url: 'https://x.invalid', headers: [{ key: 'K', value, secret: true }] });
  const old = [
    { id: 'a', type: 'app', badge: header('FIRST') },
    { id: 'a', type: 'app', badge: header('SECOND') },
  ];
  const next = {
    items: [{ id: 'a', type: 'app', badge: { url: 'https://x.invalid', headers: [{ key: 'K', secret: true }] } }],
    settings: {},
  };
  preserveAllSecrets(next, { items: old, settings: {} });
  assert.equal(next.items[0].badge.headers[0].value, 'FIRST');
});
