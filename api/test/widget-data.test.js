const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
process.env.CONFIG_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sy-wd-')), 'apps.json');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAuth, normalizeBase, fetchDeclarative } = require('../src/widget-data');
const { fetchChecked } = require('../src/proxy');

test('buildAuth returns empty auth for none/undefined declarations', () => {
  assert.deepEqual(buildAuth(null, {}), { headers: {}, query: '' });
  assert.deepEqual(buildAuth({ type: 'none' }, {}), { headers: {}, query: '' });
});

test('buildAuth builds a Basic header from stored user/pass fields', () => {
  const { headers } = buildAuth({ type: 'basic', user: 'u', pass: 'p' }, { u: 'alice', p: 'secret' });
  assert.equal(headers.Authorization, 'Basic ' + Buffer.from('alice:secret').toString('base64'));
});

test('buildAuth omits Basic auth when neither credential is present', () => {
  assert.deepEqual(buildAuth({ type: 'basic', user: 'u', pass: 'p' }, {}), { headers: {}, query: '' });
});

test('buildAuth builds a Bearer header only when a token is set', () => {
  assert.equal(buildAuth({ type: 'bearer', token: 't' }, { t: 'abc' }).headers.Authorization, 'Bearer abc');
  assert.deepEqual(buildAuth({ type: 'bearer', token: 't' }, {}).headers, {});
});

test('buildAuth fills a header template from the widget config', () => {
  const { headers } = buildAuth({ type: 'header', name: 'X-API-Key', value: '{apiKey}' }, { apiKey: 'k1' });
  assert.equal(headers['X-API-Key'], 'k1');
});

test('buildAuth builds a url-encoded query fragment', () => {
  const { query } = buildAuth({ type: 'query', name: 'api key', value: '{key}' }, { key: 'a b' });
  assert.equal(query, 'api%20key=a%20b');
});

test('normalizeBase adds a scheme, trims, and strips trailing slashes', () => {
  assert.equal(normalizeBase('host:8080'), 'http://host:8080');
  assert.equal(normalizeBase('https://host/'), 'https://host');
  assert.equal(normalizeBase('http://host///'), 'http://host');
  assert.equal(normalizeBase('  host  '), 'http://host');
  assert.equal(normalizeBase(''), '');
});

test('fetchDeclarative reports a missing data source and unconfigured URL', async () => {
  assert.equal((await fetchDeclarative(null, {}, '')).status, 503);
  assert.equal((await fetchDeclarative({ url: 'apiUrl' }, {}, '')).status, 503);
});

test('fetchDeclarative validates the endpoint before any request', async () => {
  const decl = { url: 'apiUrl', endpoints: { stats: '/s' } };
  const wc = { apiUrl: 'http://host' };
  const missing = await fetchDeclarative(decl, wc, '');
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /endpoint/);
  const unknown = await fetchDeclarative(decl, wc, 'nope');
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /unknown endpoint/);
});

test('fetchDeclarative fetches through the injected fetcher', async () => {
  const calls = [];
  const stub = async (url) => { calls.push(url); return { status: 200, data: { ok: true } }; };
  const out = await fetchDeclarative({ url: 'apiUrl', endpoints: { stats: '/s' } }, { apiUrl: 'http://host' }, 'stats', stub);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });
  assert.deepEqual(calls, ['http://host/s']);
});

test('fetchDeclarative through the guarded fetcher blocks a private preview URL', async () => {
  const out = await fetchDeclarative({ url: 'apiUrl' }, { apiUrl: 'http://127.0.0.1:1' }, '', fetchChecked);
  assert.equal(out.status, 403);
  assert.match(out.body.error, /private address/);
});
