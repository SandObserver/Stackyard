const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { startApp, fakeUpstream } = require('../test-support/app');
const app = startApp({
  label: 'support-app',
  config: { items: [{ id: 'a', type: 'app', label: 'Kept' }], settings: {} },
});

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('the app answers on its own port with the config it was given', async () => {
  assert.match(app.base, /^http:\/\/127\.0\.0\.1:\d+$/);
  const r = await app.request('GET', '/api/config');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.find(i => i.id === 'a').label, 'Kept');
});

test('a write sends the app its own Origin unless told not to', async () => {
  const body = { items: [], settings: {} };
  assert.equal((await app.request('POST', '/api/config', { body })).status, 200);
  assert.equal((await app.request('POST', '/api/config', { body, origin: null })).status, 403);
});

test('a fake upstream logs each request', async () => {
  const up = await fakeUpstream((_req, res) => res.end('ok'));
  const r = await fetch(`${up.url}/x?y=1`, { headers: { 'X-Probe': 'p' } });
  assert.equal(await r.text(), 'ok');
  assert.equal(up.requests.length, 1);
  assert.equal(up.requests[0].method, 'GET');
  assert.equal(up.requests[0].url, '/x?y=1');
  assert.equal(up.requests[0].headers['x-probe'], 'p');
  await up.close();
  assert.equal(up.server.listening, false);
});

test('startApp refuses to run after an app module is loaded', () => {
  const script = "require('./src/config'); require('./test-support/app').startApp();";
  assert.throws(
    () => execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), stdio: 'pipe' }),
    e => /must run before any api\/src module is required, but config\.js/.test(String(e.stderr)),
  );
});
