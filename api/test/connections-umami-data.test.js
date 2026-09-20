const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'connections', 'data.js'));
const { KIND, WidgetError } = require('../src/api-error');

function ctxFor(service, fetchJSON) {
  return {
    endpoint: 'map',
    config: { services: [{ enabled: true, ...service }] },
    fetchJSON,
    KIND,
    fail(msg, opts) {
      throw new WidgetError(msg, opts);
    },
  };
}

const metrics = [
  { x: 'us', y: 7 },
  { x: 'de', y: 3 },
];

test('an umami api key is sent as the bearer token and skips the login request', async () => {
  const calls = [];
  const fetchJSON = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 200, data: metrics };
  };

  const r = await dataFn(
    ctxFor({ type: 'umami', url: 'http://umami.local:3000', websiteId: 'abc', apiKey: 'umami_secret' }, fetchJSON),
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/websites\/abc\/metrics\?type=country/);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer umami_secret');

  const svc = r.services.find(s => s.type === 'umami');
  assert.deepEqual(svc.regions, { US: 7, DE: 3 });
  assert.equal(svc.connected, 10);
});

test('without an api key umami still logs in with the username and password', async () => {
  const calls = [];
  const fetchJSON = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/api/auth/login')) return { status: 200, data: { token: 'jwt-from-login' } };
    return { status: 200, data: metrics };
  };

  await dataFn(
    ctxFor(
      { type: 'umami', url: 'http://umami.local:3000', websiteId: 'abc', username: 'admin', password: 'pw' },
      fetchJSON,
    ),
  );

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/api\/auth\/login$/);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { username: 'admin', password: 'pw' });
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer jwt-from-login');
});

test('an umami api key takes precedence over a stored username and password', async () => {
  const calls = [];
  const fetchJSON = async (url, opts) => {
    calls.push({ url, opts });
    return { status: 200, data: metrics };
  };

  await dataFn(
    ctxFor(
      {
        type: 'umami',
        url: 'http://umami.local:3000',
        websiteId: 'abc',
        apiKey: 'umami_secret',
        username: 'admin',
        password: 'pw',
      },
      fetchJSON,
    ),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer umami_secret');
});

test('umami reports a rejected api key as an auth failure', async () => {
  const fetchJSON = async () => ({ status: 401, data: {} });

  const r = await dataFn(
    ctxFor({ type: 'umami', url: 'http://umami.local:3000', websiteId: 'abc', apiKey: 'bad' }, fetchJSON),
  );

  const svc = r.services.find(s => s.type === 'umami');
  assert.match(svc.error, /API key/);
});

test('umami with no credentials at all asks for one instead of posting an empty login', async () => {
  const calls = [];
  const fetchJSON = async url => {
    calls.push(url);
    return { status: 200, data: metrics };
  };

  const r = await dataFn(ctxFor({ type: 'umami', url: 'http://umami.local:3000', websiteId: 'abc' }, fetchJSON));

  assert.deepEqual(calls, []);
  const svc = r.services.find(s => s.type === 'umami');
  assert.match(svc.error, /API key/);
});
