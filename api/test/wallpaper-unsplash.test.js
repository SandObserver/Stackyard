const path = require('node:path');
const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('wallpaper-unsplash'), 'apps.json');

const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const proxy = require('../src/proxy');
/** @type {string[]} */
let calls = [];
/** @type {string[]} */
let pings = [];
const photo = (extra = {}) => ({
  urls: { raw: `https://images.unsplash.com/photo-${calls.length}?ixid=x` },
  user: { username: 'anniespratt', name: 'Annie Spratt' },
  links: { download_location: `https://api.unsplash.com/photos/p${calls.length}/download?ixid=x` },
  ...extra,
});
/** @type {(url: string) => Promise<any>} */
let reply = async () => ({ status: 200, data: photo() });
proxy.fetchUnchecked = url => {
  if (url.includes('/download')) {
    pings.push(url);
    return Promise.resolve({ status: 200, data: {} });
  }
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
  pings = [];
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
    reply = async () => ({ status: 200, data: photo() });
  }
});

test('the photo comes with the photographer and Unsplash links', async () => {
  const r = await getWallpaper();
  assert.deepEqual(r.credit, {
    name: 'Annie Spratt',
    profile: 'https://unsplash.com/@anniespratt?utm_source=stackyard&utm_medium=referral',
    site: 'https://unsplash.com/?utm_source=stackyard&utm_medium=referral',
  });
  assert.deepEqual((await getWallpaper()).credit, r.credit, 'the cached photo keeps its credit');
});

test('each new photo is reported as used once, with the key', async () => {
  await getWallpaper();
  await getWallpaper();
  await new Promise(r => setImmediate(r));
  assert.equal(pings.length, 1);
  const u = new URL(pings[0]);
  assert.equal(u.origin, 'https://api.unsplash.com');
  assert.equal(u.pathname, '/photos/p1/download');
  assert.equal(u.searchParams.get('client_id'), 'key-1');
  assert.equal(u.searchParams.get('ixid'), 'x');
});

/* The key goes on this request. Another host would receive it. */
test('a download link on another host is not followed', async () => {
  reply = async () => ({
    status: 200,
    data: photo({ links: { download_location: 'https://evil.example/photos/p/download' } }),
  });
  try {
    await getWallpaper();
    await new Promise(r => setImmediate(r));
    assert.equal(pings.length, 0);
  } finally {
    reply = async () => ({ status: 200, data: photo() });
  }
});

test('a photographer handle that cannot form a profile link gives no credit', async () => {
  for (const user of [undefined, {}, { username: '../x', name: 'X' }, { username: 'a b' }]) {
    _resetPhoto();
    reply = async () => ({ status: 200, data: photo({ user }) });
    assert.equal((await getWallpaper()).credit, null, JSON.stringify(user));
  }
  reply = async () => ({ status: 200, data: photo() });
});

test('a photographer with no display name is credited by handle', async () => {
  reply = async () => ({ status: 200, data: photo({ user: { username: 'anniespratt', name: '  ' } }) });
  try {
    assert.equal((await getWallpaper()).credit.name, 'anniespratt');
  } finally {
    reply = async () => ({ status: 200, data: photo() });
  }
});
