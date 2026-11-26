const { startApp } = require('../test-support/app');
const app = startApp({ label: 'request-trace' });

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const log = require('../src/log');
const { saveConfig, loadConfig } = require('../src/config');

function get(pathName, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get(app.base + pathName, { headers }, res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }),
        );
      })
      .on('error', reject);
  });
}

test('an error reply carries the request id the response header names', async () => {
  const r = await get('/api/no-such-route');
  assert.equal(r.status, 404);
  assert.match(r.headers['x-request-id'], /^[0-9a-f]{8}$/);
  assert.equal(r.body.requestId, r.headers['x-request-id']);
});

test('a success reply carries the header and leaves the body alone', async () => {
  const r = await get('/health');
  assert.match(r.headers['x-request-id'], /^[0-9a-f]{8}$/);
  assert.equal(r.body.requestId, undefined);
});

test('a failed request is logged with its id, method and path, never its query', async t => {
  const { fail } = require('../src/api-error');
  const errors = [];
  t.mock.method(log, 'error', (msg, data) => errors.push({ msg, data }));
  const res = { req: { method: 'POST', url: '/api/badge-proxy?key=secret' }, writeHead() {}, end() {} };
  fail(res, new Error('connect ECONNREFUSED'), { status: 502 });
  assert.equal(errors[0].msg, 'request failed');
  assert.equal(errors[0].data.method, 'POST');
  assert.equal(errors[0].data.path, '/api/badge-proxy');
  assert.equal(errors[0].data.code, 'internal');
  assert.doesNotMatch(JSON.stringify(errors[0]), /secret/);
});

test('a broken settings file is logged with the line and column of the error', async t => {
  saveConfig({ items: [], settings: {} });
  const cfg = process.env.CONFIG_PATH;
  fs.writeFileSync(cfg, '{\n  "items": [],\n  "settings": { "x": 1,, }\n}');
  const errors = [];
  t.mock.method(log, 'error', (msg, data) => errors.push({ msg, data }));
  const later = Date.now() + 60_000;
  t.mock.method(Date, 'now', () => later);
  loadConfig();
  const line = errors.find(e => e.msg.startsWith('config file cannot be used'));
  assert.ok(line, 'no damage line');
  assert.match(line.data.error, /^not valid JSON at line 3 column \d+$/);
  for (const f of fs.readdirSync(path.dirname(cfg)))
    if (f.startsWith(path.basename(cfg))) fs.rmSync(path.join(path.dirname(cfg), f));
});

test('only an environment value Stackyard cannot use is reported', async () => {
  const { envWarnings } = require('../src/env-warnings');
  assert.deepEqual(envWarnings({ LOG_LEVEL: 'debug' }, 'debug'), []);
  assert.deepEqual(envWarnings({ ALLOW_PRIVATE_IPS: 'false', SESSION_MAX_AGE_DAYS: '7' }, null), []);
  assert.equal(envWarnings({ LOG_LEVEL: 'loud' }, null).length, 1);
});
