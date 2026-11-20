const fs = require('node:fs');
const { tmpDir } = require('../test-support/tmp');
const { startApp } = require('../test-support/app');
const ICONS = tmpDir('health-icons');
const app = startApp({ label: 'health-data', env: { ICONS_PATH: ICONS } });
const DATA = app.dir;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const health = () =>
  new Promise((resolve, reject) => {
    http
      .get(`${app.base}/health`, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      })
      .on('error', reject);
  });

after(() => {
  fs.chmodSync(DATA, 0o700);
  fs.chmodSync(ICONS, 0o700);
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
