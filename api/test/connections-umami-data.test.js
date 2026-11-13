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

test('a map service whose key is rejected reads as a rejected key', async () => {
  const r = await dataFn(
    ctxFor({ type: 'plausible', url: 'https://plausible.local', siteId: 's', apiKey: 'bad' }, async () => ({
      status: 401,
      data: null,
    })),
  );
  assert.equal(r.services.find(s => s.type === 'plausible').errorKind, 'auth');
});

test('a map service whose URL is only spaces reads as not set up', async () => {
  const r = await dataFn(
    ctxFor({ type: 'plausible', url: '   ', siteId: 's' }, async () => ({ status: 200, data: {} })),
  );
  assert.equal(r.services.find(s => s.type === 'plausible').errorKind, 'invalid');
});
test('NetBird on the map counts connected peers per country', async () => {
  const calls = [];
  const fetchJSON = async (url, opts) => {
    calls.push({ url, opts });
    return {
      status: 200,
      data: [
        { connected: true, country_code: 'de' },
        { connected: true, country_code: 'DE' },
        { connected: true, country_code: '' },
        { connected: false, country_code: 'US' },
      ],
    };
  };
  const r = await dataFn(ctxFor({ type: 'netbird', url: 'http://nb.local', token: 't' }, fetchJSON));
  assert.equal(calls[0].url, 'http://nb.local/api/peers');
  assert.equal(calls[0].opts.headers.Authorization, 'Token t');
  const svc = r.services.find(s => s.type === 'netbird');
  assert.deepEqual(svc.regions, { DE: 2 });
  assert.equal(svc.connected, 3);
  assert.equal(svc.peersTotal, 4);
});

/* Rows follow Plausible's Stats API v2: dimensions then metrics, country as ISO 3166-1 alpha-2. */
test('Plausible visitors are summed per country from the stats query', async () => {
  const calls = [];
  const fetchJSON = async (url, opts) => {
    calls.push({ url, opts });
    return {
      status: 200,
      data: {
        results: [
          { dimensions: ['US'], metrics: [12] },
          { dimensions: ['de'], metrics: [3] },
          { dimensions: [''], metrics: [9] },
          { dimensions: ['FR'], metrics: [0] },
        ],
      },
    };
  };
  const r = await dataFn(
    ctxFor({ type: 'plausible', url: 'https://plausible.local', siteId: 'example.com', apiKey: 'pk' }, fetchJSON),
  );
  assert.equal(calls[0].url, 'https://plausible.local/api/v2/query');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer pk');
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    site_id: 'example.com',
    metrics: ['visitors'],
    date_range: '7d',
    dimensions: ['visit:country'],
  });
  const svc = r.services.find(s => s.type === 'plausible');
  assert.deepEqual(svc.regions, { US: 12, DE: 3 });
  assert.equal(svc.connected, 15);
});
