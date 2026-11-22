const { startApp } = require('../test-support/app');
const app = startApp({ label: 'configetag' });

const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const { saveConfig, loadConfigForUpdate } = require('../src/config');

before(() => {
  saveConfig({ items: [{ id: 'a1', type: 'app', label: 'App', href: 'https://app.invalid' }], settings: {} });
});

const get = (headers = {}) => fetch(`${app.base}/api/config`, { headers });

test('a config read carries its revision as a strong ETag', async () => {
  const res = await get();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Number.isSafeInteger(body._rev));
  assert.equal(res.headers.get('etag'), `"${body._rev}"`);
});

test('a read naming the current revision gets 304 with no body', async () => {
  const etag = (await get()).headers.get('etag');
  for (const header of [etag, `W/${etag}`, `"nope", ${etag}`]) {
    const res = await get({ 'If-None-Match': header });
    assert.equal(res.status, 304, header);
    assert.equal(res.headers.get('etag'), etag);
    assert.equal(await res.text(), '');
  }
});

test('a read naming an older revision gets the whole config', async () => {
  const old = (await get()).headers.get('etag');
  const cfg = loadConfigForUpdate();
  cfg.items[0].label = 'Renamed';
  saveConfig(cfg);
  const res = await get({ 'If-None-Match': old });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.items.find(i => i.id === 'a1').label, 'Renamed');
  assert.notEqual(res.headers.get('etag'), old);
  assert.equal(res.headers.get('etag'), `"${body._rev}"`);
});

test('a config with no usable revision is sent whole and carries no ETag', async () => {
  const cfg = loadConfigForUpdate();
  cfg._rev = 'hand-edited';
  saveConfig(cfg, { keepRev: true });
  const res = await get({ 'If-None-Match': '"hand-edited"' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('etag'), null);
});
