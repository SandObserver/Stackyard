const fs = require('node:fs');
const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
const DATA = tmpDir('savefail');
process.env.CONFIG_PATH = path.join(DATA, 'apps.json');
process.env.ICONS_PATH = tmpDir('savefail-icons');

const { test, before, after, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig, configFileIsMount, CONFIG_PATH, SCHEMA_VERSION } = require('../src/config');
const { BODY_LIMIT } = require('../src/router');

let server, base;
const post = raw =>
  fetch(`${base}/api/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: raw,
  });
const save = () => post(JSON.stringify({ items: [{ id: 'a', type: 'app' }], settings: {} }));
const failWrite = code =>
  mock.method(fs, 'renameSync', () => {
    throw Object.assign(new Error(`${code}: /secret/path`), { code });
  });

before(async () => {
  saveConfig({ items: [], settings: {} });
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => mock.restoreAll());

after(async () => {
  await new Promise(r => {
    server.closeAllConnections?.();
    server.close(r);
  });
});

for (const [code, status, apiCode] of [
  ['ENOSPC', 507, 'internal.disk-full'],
  ['EDQUOT', 507, 'internal.disk-full'],
  ['EACCES', 500, 'internal.config-not-writable'],
  ['EROFS', 500, 'internal.config-not-writable'],
  ['EBUSY', 500, 'internal.config-file-mounted'],
]) {
  test(`${code} on save reports ${apiCode} and leaves no temp file`, async () => {
    const original = fs.readFileSync(CONFIG_PATH, 'utf8');
    failWrite(code);
    const r = await save();
    const text = await r.text();
    assert.equal(r.status, status);
    assert.equal(JSON.parse(text).code, apiCode);
    assert.doesNotMatch(text, /secret\/path/);
    assert.equal(fs.existsSync(`${CONFIG_PATH}.tmp`), false);
    assert.equal(fs.readFileSync(CONFIG_PATH, 'utf8'), original);
  });
}

test('a body over the limit answers 413 with its own code', async () => {
  const r = await post(JSON.stringify({ items: [], pad: 'x'.repeat(BODY_LIMIT + 1) }));
  assert.equal(r.status, 413);
  const body = await r.json();
  assert.equal(body.code, 'invalid.config-too-large');
  assert.equal(body.detail.max, 2);
});

test('a config from a newer schema is refused', async () => {
  const r = await post(JSON.stringify({ _schemaVersion: SCHEMA_VERSION + 1, items: [], settings: {} }));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'invalid.newer-config');
});

test('a config at the current schema is accepted', async () => {
  assert.equal((await post(JSON.stringify({ _schemaVersion: SCHEMA_VERSION, items: [], settings: {} }))).status, 200);
});

test('a null body is refused as invalid', async () => {
  const r = await post('null');
  assert.equal(r.status, 400);
  assert.equal((await r.json()).kind, 'invalid');
});

test('a single-file mount of the config is detected', () => {
  const line = p => `36 35 8:1 / ${p} rw,relatime shared:1 - ext4 /dev/sda1 rw`;
  assert.equal(configFileIsMount(`${line('/')}\n${line(CONFIG_PATH)}\n`), true);
  assert.equal(configFileIsMount(`${line('/')}\n${line(path.dirname(CONFIG_PATH))}\n`), false);
  assert.equal(configFileIsMount(line(CONFIG_PATH.replace(/ /g, '\\040'))), true);
});
