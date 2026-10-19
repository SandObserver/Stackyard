const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('wallpaper-unsplash'), 'apps.json');

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const proxy = require('../src/proxy');
/** @type {string[]} */
let calls = [];
/** @type {(url: string) => Promise<any>} */
let reply = async () => ({
  status: 200,
  data: { urls: { raw: `https://images.unsplash.com/photo-${calls.length}?ixid=x` } },
});
proxy.fetchUnchecked = url => {
  calls.push(url);
  return reply(url);
};

require('../src/routes');
const { dispatch } = require('../src/router');
const { saveConfig } = require('../src/config');
const { _resetPhoto } = require('../src/routes/wallpaper');

let server, port;
let clock = Date.now();

function getWallpaper() {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path: '/api/wallpaper', headers: { Host: '127.0.0.1' } }, res => {
        let b = '';
        res.on('data', c => (b += c));
        res.on('end', () => resolve(JSON.parse(b)));
      })
      .on('error', reject);
  });
}

const unsplash = (extra = {}) =>
  saveConfig({ items: [], settings: { background: { type: 'unsplash', apiKey: 'key-1', ...extra } } });

before(async () => {
  mock.method(Date, 'now', () => clock);
  server = http.createServer(dispatch);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => new Promise(r => server.close(r)));

beforeEach(() => {
  calls = [];
  _resetPhoto();
  unsplash();
  clock += 1000;
});

test('repeated requests share one Unsplash call for a day', async () => {
  const first = await getWallpaper();
  for (let i = 0; i < 5; i++) assert.deepEqual(await getWallpaper(), first);
  assert.equal(calls.length, 1);
  clock += 24 * 60 * 60 * 1000;
  assert.notDeepEqual(await getWallpaper(), first);
  assert.equal(calls.length, 2);
});

test('requests that arrive together share one call', async () => {
  const results = await Promise.all(Array.from({ length: 6 }, getWallpaper));
  assert.equal(calls.length, 1);
  for (const r of results) assert.deepEqual(r, results[0]);
});

test('a new key or collection asks again', async () => {
  await getWallpaper();
  unsplash({ apiKey: 'key-2' });
  await getWallpaper();
  unsplash({ apiKey: 'key-2', collection: 'abc' });
  await getWallpaper();
  assert.equal(calls.length, 3);
  assert.ok(calls[2].includes('collections=abc'));
});

test("Unsplash's own error text is not passed on, and a failure is not kept", async () => {
  reply = async () => ({ status: 401, data: { errors: ['OAuth error: The access token is invalid'] } });
  try {
    const r = await getWallpaper();
    assert.deepEqual(r, { url: null, error: 'No image returned' });
    await getWallpaper();
    assert.equal(calls.length, 2);
  } finally {
    reply = async () => ({
      status: 200,
      data: { urls: { raw: `https://images.unsplash.com/photo-${calls.length}?ixid=x` } },
    });
  }
});
