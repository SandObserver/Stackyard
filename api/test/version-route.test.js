const path = require('node:path');

const { tmpDir } = require('../test-support/tmp');
process.env.CONFIG_PATH = path.join(tmpDir('ver'), 'apps.json');

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

require('../src/routes');
const { dispatch } = require('../src/router');
const { shouldFetch, CACHE_MS } = require('../src/routes/version');

/* ── the cache decision ───────────────────────────────────────────────────── */

const NOW = 1_000_000_000;

test('nothing cached means fetch', () => {
  assert.equal(shouldFetch({ at: 0, checked: false }, NOW), true);
});

test('a recent success is not re-fetched', () => {
  assert.equal(shouldFetch({ at: NOW - 1000, checked: true }, NOW), false);
});

test('a recent failure is not re-fetched either', () => {
  assert.equal(
    shouldFetch({ at: NOW - 1000, checked: true, latest: null }, NOW),
    false,
    'a failed lookup must be cached like a successful one',
  );
});

test('an expired entry is re-fetched, success or failure', () => {
  assert.equal(shouldFetch({ at: NOW - CACHE_MS - 1, checked: true }, NOW), true);
  assert.equal(shouldFetch({ at: NOW - CACHE_MS, checked: true }, NOW), true, 'exactly at the limit');
});

test('the cache window is an hour', () => {
  assert.equal(CACHE_MS, 60 * 60 * 1000);
});

/* ── the route still answers ──────────────────────────────────────────────── */

let server, base;

before(async () => {
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

function version() {
  const u = new URL(base + '/api/version');
  return new Promise((resolve, reject) => {
    http
      .request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET' }, res => {
        let b = '';
        res.on('data', c => {
          b += c;
        });
        res.on('end', () => resolve(JSON.parse(b)));
      })
      .on('error', reject)
      .end();
  });
}

test('the installed version is reported even when the lookup fails', async () => {
  const r = await version();
  assert.ok(r.current, 'the installed version is always reported');
  assert.equal(r.updateAvailable, false, 'and nothing is claimed about an update');
});

test('repeated requests keep answering', async () => {
  for (let i = 0; i < 3; i++) {
    const r = await version();
    assert.ok(r.current);
  }
});
