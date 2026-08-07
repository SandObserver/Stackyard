const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');
const { errorParts } = require('../test-support/widget-ctx');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'stats', 'data.js'));

/* Minimal stand-in for the ctx widget-data.js builds, capturing the last fetch
   call so header/URL wiring can be asserted. fetchJSON returns { status, data }. */
function ctxFor(network, response) {
  const calls = [];
  return {
    ctx: {
      endpoint: 'speed',
      config: { network },
      normalizeBase,
      fetchJSON: async (url, opts) => { calls.push({ url, opts }); return response; },
      ...errorParts(),
    },
    calls,
  };
}

test('myspeed returns the latest row shaped for the widget', async () => {
  const { ctx } = ctxFor(
    { enabled: true, url: 'http://ms:5216', provider: 'myspeed' },
    { status: 200, data: [{ download: 900, upload: 90, ping: 4, created: '2026-01-01T00:00:00Z' }] },
  );
  const r = await dataFn(ctx);
  assert.deepEqual(r, { download: 900, upload: 90, ping: 4, failed: false, ts: '2026-01-01T00:00:00Z' });
});

test('myspeed sends the x-password header only when a password is set', async () => {
  const withPass = ctxFor(
    { enabled: true, url: 'http://ms:5216', provider: 'myspeed', myspeedPass: 'secret' },
    { status: 200, data: [{ download: 1 }] },
  );
  await dataFn(withPass.ctx);
  assert.equal(withPass.calls[0].opts.headers['x-password'], 'secret');
  assert.match(withPass.calls[0].url, /\/api\/speedtests\?limit=1$/);

  const noPass = ctxFor(
    { enabled: true, url: 'http://ms:5216', provider: 'myspeed' },
    { status: 200, data: [{ download: 1 }] },
  );
  await dataFn(noPass.ctx);
  assert.equal(noPass.calls[0].opts.headers['x-password'], undefined);
});

test('myspeed surfaces a 401 as a credentials error', async () => {
  const { ctx } = ctxFor(
    { enabled: true, url: 'http://ms:5216', provider: 'myspeed' },
    { status: 401, data: null },
  );
  await assert.rejects(dataFn(ctx), /MySpeed returned 401, check password/);
});

test('myspeed reports an empty result', async () => {
  const { ctx } = ctxFor(
    { enabled: true, url: 'http://ms:5216', provider: 'myspeed' },
    { status: 200, data: [] },
  );
  await assert.rejects(dataFn(ctx), /No result from MySpeed/);
});

test('speedtest-tracker returns the latest row shaped for the widget', async () => {
  const { ctx } = ctxFor(
    { enabled: true, url: 'http://stt', provider: 'speedtest-tracker' },
    { status: 200, data: { data: { id: 7, download: 500, upload: 50, ping: 9, failed: false, created_at: '2026-02-02T00:00:00Z' } } },
  );
  const r = await dataFn(ctx);
  assert.deepEqual(r, { download: 500, upload: 50, ping: 9, failed: false, ts: '2026-02-02T00:00:00Z' });
});

test('speedtest-tracker reports a missing result', async () => {
  const { ctx } = ctxFor(
    { enabled: true, url: 'http://stt', provider: 'speedtest-tracker' },
    { status: 200, data: { data: null } },
  );
  await assert.rejects(dataFn(ctx), /No result from Speedtest Tracker/);
});

test('an unconfigured network slot fails without fetching', async () => {
  const off = ctxFor({ enabled: false, url: 'http://ms' }, { status: 200, data: [] });
  await assert.rejects(dataFn(off.ctx), /network slot not configured/);
  assert.equal(off.calls.length, 0);

  const noUrl = ctxFor({ enabled: true }, { status: 200, data: [] });
  await assert.rejects(dataFn(noUrl.ctx), /network slot not configured/);
  assert.equal(noUrl.calls.length, 0);
});

test('a thrown fetch propagates rather than becoming a successful result', async () => {
  const ctx = {
    endpoint: 'speed',
    config: { network: { enabled: true, url: 'http://ms', provider: 'myspeed' } },
    normalizeBase,
    fetchJSON: async () => { throw new Error('connect ECONNREFUSED'); },
  };
  await assert.rejects(dataFn(ctx), /connect ECONNREFUSED/);
});
