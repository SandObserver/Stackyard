const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { normalizeBase } = require(path.join(__dirname, '..', 'src', 'widget-data.js'));
const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'system-summary', 'data.js'));

const KIND = { INVALID: 'invalid', AUTH: 'auth' };

function makeCtx(network, respond, calls = []) {
  return {
    endpoint: 'speed',
    config: { network },
    normalizeBase,
    KIND,
    fetchJSON: async (url, opts) => {
      calls.push({ url, opts });
      return respond(url);
    },
    fail: (message, opts) => {
      const e = new Error(message);
      e.kind = opts?.kind;
      throw e;
    },
  };
}

const slot = extra => ({
  enabled: true,
  mode: 'speed',
  provider: 'speedtest-tracker',
  url: 'http://st.local',
  ...extra,
});

/* The compatibility route already reports megabits. */
const COMPAT = {
  status: 200,
  data: {
    data: {
      id: 385,
      ping: 7.5,
      download: 934.95,
      upload: 936.8,
      failed: false,
      created_at: '2026-09-10T18:00:01+00:00',
    },
  },
};

/* The v1 result reports bytes per second, with the bit counts alongside. */
const V1 = {
  status: 200,
  data: {
    data: {
      id: 385,
      ping: 7.5,
      download: 116868750,
      upload: 117100000,
      download_bits: 934950000,
      upload_bits: 936800000,
      status: 'completed',
      created_at: '2026-09-10 18:00:01',
    },
  },
};

test('with no token it calls the compatibility route and passes megabits through', async () => {
  const calls = [];
  const r = await dataFn(makeCtx(slot(), () => COMPAT, calls));
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/speedtest\/latest$/);
  assert.equal(calls[0].opts.headers, undefined, 'the compatibility route takes no token');
  assert.equal(r.download, 934.95);
  assert.equal(r.upload, 936.8);
  assert.equal(r.failed, false);
});

test('with a token it calls the v1 route as a bearer', async () => {
  const calls = [];
  const r = await dataFn(makeCtx(slot({ stToken: 'tok123' }), () => V1, calls));
  assert.match(calls[0].url, /\/api\/v1\/results\/latest$/);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok123');
  assert.equal(r.ping, 7.5);
  assert.equal(r.ts, '2026-09-10 18:00:01');
});

/* Reading `download` instead of `download_bits` would report 116868750 here. */
test('the v1 route is converted from bits, so both routes report the same speed', async () => {
  const compat = await dataFn(makeCtx(slot(), () => COMPAT));
  const v1 = await dataFn(makeCtx(slot({ stToken: 't' }), () => V1));
  assert.equal(v1.download, 934.95);
  assert.equal(v1.upload, 936.8);
  assert.equal(v1.download, compat.download);
  assert.equal(v1.upload, compat.upload);
});

test('a whitespace-only token still uses the compatibility route', async () => {
  const calls = [];
  await dataFn(makeCtx(slot({ stToken: '   ' }), () => COMPAT, calls));
  assert.match(calls[0].url, /\/api\/speedtest\/latest$/);
});

test('a failed v1 result is reported as failed', async () => {
  const failed = { status: 200, data: { data: { ...V1.data.data, status: 'failed' } } };
  const r = await dataFn(makeCtx(slot({ stToken: 't' }), () => failed));
  assert.equal(r.failed, true);
});

test('a v1 result with no speeds reports null rather than zero', async () => {
  const empty = { status: 200, data: { data: { id: 1, ping: 5, status: 'completed', created_at: 'x' } } };
  const r = await dataFn(makeCtx(slot({ stToken: 't' }), () => empty));
  assert.equal(r.download, null);
  assert.equal(r.upload, null);
});

for (const status of [401, 403]) {
  test(`a v1 ${status} is reported as an auth failure`, async () => {
    await assert.rejects(
      () => dataFn(makeCtx(slot({ stToken: 'bad' }), () => ({ status, data: {} }))),
      e => e.kind === KIND.AUTH && /rejected the API token/.test(e.message),
    );
  });
}

test('another v1 error names its status', async () => {
  await assert.rejects(
    () => dataFn(makeCtx(slot({ stToken: 't' }), () => ({ status: 500, data: {} }))),
    /Speedtest Tracker HTTP 500/,
  );
});
