const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'backup', 'data.js'));

/* Duplicati mints a fresh token per instance, so every fixture answers the login
   route as well as the data route it is asked about. */
function ctxFor(config, endpoint, routes, row = null) {
  const calls = [];
  return {
    calls,
    ctx: {
      config, endpoint, row,
      async fetchJSON(url, opts) {
        calls.push({ url, opts });
        for (const [suffix, reply] of Object.entries(routes)) {
          if (url.endsWith(suffix)) return typeof reply === 'function' ? reply(url, opts) : reply;
        }
        return { status: 404, data: null };
      },
    },
  };
}

const LOGIN = { status: 200, data: { AccessToken: 'tok', RefreshNonce: 'nonce' } };

test('duplicati-jobs returns options built from the row URL and password', async () => {
  const { ctx, calls } = ctxFor({ slots: [] }, 'duplicati-jobs', {
    '/api/v1/auth/login': LOGIN,
    '/api/v1/backups': { status: 200, data: [{ Backup: { ID: '3', Name: 'Nightly' } }] },
  }, { provider: 'duplicati', dupUrl: 'duplicati:8200', dupPass: 'pw' });

  const out = await dataFn(ctx);
  assert.deepEqual(out, { options: [{ value: '3', label: 'Nightly' }] });
  assert.equal(JSON.parse(calls[0].opts.body).Password, 'pw');
  assert.ok(calls.every(c => c.url.startsWith('http://duplicati:8200')));
});

test('duplicati-jobs rejects a row with no URL', async () => {
  const { ctx } = ctxFor({}, 'duplicati-jobs', {}, { provider: 'duplicati', dupUrl: '  ' });
  await assert.rejects(() => dataFn(ctx), /URL not configured/);
});

test('an options fetch with no resolved row is refused', async () => {
  const { ctx } = ctxFor({}, 'kopia-sources', {});
  await assert.rejects(() => dataFn(ctx), /no slot selected/);
});

test('kopia-sources sends basic auth only when a username is present', async () => {
  const reply = { status: 200, data: { sources: [{ source: { host: 'h', userName: 'u', path: '/data' } }] } };
  const withUser = ctxFor({}, 'kopia-sources', { '/api/v1/sources': reply },
    { provider: 'kopia', kopiaUrl: 'http://kopia:51515/', kopiaUser: 'u', kopiaPass: 'p' });
  const out = await dataFn(withUser.ctx);
  assert.equal(out.options.length, 1);
  assert.equal(out.options[0].label, '/data');
  assert.match(withUser.calls[0].opts.headers.Authorization, /^Basic /);
  assert.equal(withUser.calls[0].url, 'http://kopia:51515/api/v1/sources');

  const anon = ctxFor({}, 'kopia-sources', { '/api/v1/sources': reply },
    { provider: 'kopia', kopiaUrl: 'http://kopia:51515', kopiaPass: 'p' });
  await dataFn(anon.ctx);
  assert.equal(anon.calls[0].opts.headers.Authorization, undefined);
});

test('kopia-sources surfaces an auth failure', async () => {
  const { ctx } = ctxFor({}, 'kopia-sources', { '/api/v1/sources': { status: 401 } },
    { provider: 'kopia', kopiaUrl: 'http://kopia:51515' });
  await assert.rejects(() => dataFn(ctx), /authentication failed/i);
});

test('slots returns one entry per slot, null where unconfigured', async () => {
  const config = { slots: [
    { provider: 'duplicati', dupUrl: 'http://d:8200', dupPass: 'pw', jobId: '3', customName: 'Nightly' },
    { provider: null },
    { provider: 'kopia', kopiaUrl: 'http://k:51515', jobId: 'h@u:/data' },
  ] };
  const { ctx } = ctxFor(config, 'slots', {
    '/api/v1/auth/login': LOGIN,
    '/api/v1/serverstate': { status: 200, data: { ProposedSchedule: [] } },
    '/api/v1/backups': { status: 200, data: [{ Backup: { ID: '3', Name: 'Upstream Name' } }] },
    '/api/v1/sources': { status: 200, data: { sources: [{ source: { host: 'h', userName: 'u', path: '/data' }, status: 'IDLE' }] } },
  });

  const out = await dataFn(ctx);
  assert.equal(out.length, 3);
  assert.equal(out[0].name, 'Nightly'); /* the custom name wins over the upstream one */
  assert.equal(out[1], null);
  assert.equal(out[2].name, '/data');
});

test('slots leaves a slot null when its job is gone upstream', async () => {
  const { ctx } = ctxFor({ slots: [{ provider: 'duplicati', dupUrl: 'http://gone:8200', jobId: '9' }] }, 'slots', {
    '/api/v1/auth/login': LOGIN,
    '/api/v1/serverstate': { status: 200, data: {} },
    '/api/v1/backups': { status: 200, data: [] },
  });
  assert.deepEqual(await dataFn(ctx), [null]);
});

test('slots collapses same-instance slots into one round of upstream calls', async () => {
  const config = { slots: [
    { provider: 'duplicati', dupUrl: 'http://d:8200', dupPass: 'pw', jobId: '1' },
    { provider: 'duplicati', dupUrl: 'http://d:8200/', dupPass: 'pw', jobId: '2' },
  ] };
  const { ctx, calls } = ctxFor(config, 'slots', {
    '/api/v1/auth/login': LOGIN,
    '/api/v1/serverstate': { status: 200, data: {} },
    '/api/v1/backups': { status: 200, data: [{ Backup: { ID: '1', Name: 'A' } }, { Backup: { ID: '2', Name: 'B' } }] },
  });
  const out = await dataFn(ctx);
  assert.deepEqual(out.map(s => s && s.name), ['A', 'B']);
  assert.equal(calls.filter(c => c.url.endsWith('/api/v1/serverstate')).length, 1);
});

test('an unreachable instance leaves its slots null instead of failing the request', async () => {
  const { ctx } = ctxFor({ slots: [{ provider: 'duplicati', dupUrl: 'http://d:8200', jobId: '1' }] }, 'slots', {
    '/api/v1/auth/login': () => { throw new Error('ECONNREFUSED'); },
  });
  assert.deepEqual(await dataFn(ctx), [null]);
});
