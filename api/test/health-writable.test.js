const fs = require('node:fs');
const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
const DATA = tmpDir('health-data');
const ICONS = tmpDir('health-icons');
process.env.CONFIG_PATH = path.join(DATA, 'apps.json');
process.env.ICONS_PATH = ICONS;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');

let server, base;

const health = () =>
  new Promise((resolve, reject) => {
    http
      .get(`${base}/health`, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      })
      .on('error', reject);
  });

before(async () => {
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  fs.chmodSync(DATA, 0o700);
  fs.chmodSync(ICONS, 0o700);
  server.close();
});

test('health is ok when both data folders are writable', async () => {
  assert.deepEqual(await health(), { status: 200, body: { ok: true } });
});

for (const [name, dir] of [
  ['config', DATA],
  ['icons', ICONS],
]) {
  test(`health fails while the ${name} folder cannot be written`, async t => {
    if (process.getuid?.() === 0) return t.skip('root ignores directory permissions');
    fs.chmodSync(dir, 0o500);
    try {
      assert.deepEqual(await health(), { status: 503, body: { ok: false } });
    } finally {
      fs.chmodSync(dir, 0o700);
    }
    assert.equal((await health()).status, 200);
  });
}

test('health fails while the config folder cannot be searched', async t => {
  if (process.getuid?.() === 0) return t.skip('root ignores directory permissions');
  fs.chmodSync(DATA, 0o600);
  try {
    assert.deepEqual(await health(), { status: 503, body: { ok: false } });
  } finally {
    fs.chmodSync(DATA, 0o700);
  }
});

test('a data folder that does not exist does not fail health', async () => {
  fs.rmSync(ICONS, { recursive: true });
  try {
    assert.equal((await health()).status, 200);
  } finally {
    fs.mkdirSync(ICONS);
  }
});
