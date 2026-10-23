const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'backup', 'data.js'));
const { WidgetError, KIND } = require('../src/api-error');
const log = require('../src/log');
const { serviceBase, serviceLink } = require('../../ui/js/service-link.js');

/* Duplicati mints a fresh token per instance, so every fixture answers the login
   route as well as the data route it is asked about. */
function ctxFor(config, endpoint, routes, row = null) {
  const calls = [];
  return {
    calls,
    ctx: {
      config,
      endpoint,
      row,
      fail: (message, opts) => {
        throw new WidgetError(message, opts);
      },
      KIND,
      serviceBase,
      serviceLink,
      log,
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
  const { ctx, calls } = ctxFor(
    { slots: [] },
    'duplicati-jobs',
    {
      '/api/v1/auth/login': LOGIN,
      '/api/v1/backups': { status: 200, data: [{ Backup: { ID: '3', Name: 'Nightly' } }] },
    },
    { provider: 'duplicati', dupUrl: 'duplicati:8200', dupPass: 'pw' },
  );

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
  await assert.rejects(() => dataFn(ctx), /No slot selected/i);
});

test('kopia-sources sends basic auth only when a username is present', async () => {
  const reply = { status: 200, data: { sources: [{ source: { host: 'h', userName: 'u', path: '/data' } }] } };
  const withUser = ctxFor(
    {},
    'kopia-sources',
    { '/api/v1/sources': reply },
    { provider: 'kopia', kopiaUrl: 'http://kopia:51515/', kopiaUser: 'u', kopiaPass: 'p' },
  );
  const out = await dataFn(withUser.ctx);
  assert.equal(out.options.length, 1);
  assert.equal(out.options[0].label, '/data');
  assert.match(withUser.calls[0].opts.headers.Authorization, /^Basic /);
  assert.equal(withUser.calls[0].url, 'http://kopia:51515/api/v1/sources');

  const anon = ctxFor(
    {},
    'kopia-sources',
    { '/api/v1/sources': reply },
    { provider: 'kopia', kopiaUrl: 'http://kopia:51515', kopiaPass: 'p' },
  );
  await dataFn(anon.ctx);
  assert.equal(anon.calls[0].opts.headers.Authorization, undefined);
});

test('kopia-sources surfaces an auth failure', async () => {
  const { ctx } = ctxFor(
    {},
    'kopia-sources',
    { '/api/v1/sources': { status: 401 } },
    { provider: 'kopia', kopiaUrl: 'http://kopia:51515' },
  );
  await assert.rejects(() => dataFn(ctx), /authentication failed/i);
});

test('slots returns one entry per slot, null where unconfigured', async () => {
  const config = {
    slots: [
      { provider: 'duplicati', dupUrl: 'http://d:8200', dupPass: 'pw', jobId: '3', customName: 'Nightly' },
      { provider: null },
      { provider: 'kopia', kopiaUrl: 'http://k:51515', jobId: 'h@u:/data' },
    ],
  };
  const { ctx } = ctxFor(config, 'slots', {
    '/api/v1/auth/login': LOGIN,
    '/api/v1/serverstate': { status: 200, data: { ProposedSchedule: [] } },
    '/api/v1/backups': { status: 200, data: [{ Backup: { ID: '3', Name: 'Upstream Name' } }] },
    '/api/v1/sources': {
      status: 200,
      data: { sources: [{ source: { host: 'h', userName: 'u', path: '/data' }, status: 'IDLE' }] },
    },
  });

  const out = await dataFn(ctx);
  assert.equal(out.length, 3);
  assert.equal(out[0].name, 'Nightly'); /* the custom name wins over the upstream one */
  assert.equal(out[1], null);
  assert.equal(out[2].name, '/data');
});

test('slots marks a slot failed when its job is no longer listed', async () => {
  const config = {
    slots: [
      { provider: 'duplicati', dupUrl: 'http://gone:8200', jobId: '9' },
      { provider: 'kopia', kopiaUrl: 'http://k:51515', jobId: 'h@u:/deleted' },
    ],
  };
  const { ctx } = ctxFor(config, 'slots', {
    '/api/v1/auth/login': LOGIN,
    '/api/v1/serverstate': { status: 200, data: {} },
    '/api/v1/backups': { status: 200, data: [] },
    '/api/v1/sources': { status: 200, data: { sources: [{ source: { host: 'h', userName: 'u', path: '/data' } }] } },
  });
  assert.deepEqual(await dataFn(ctx), [{ error: KIND.INVALID }, { error: KIND.INVALID }]);
});

test('slots collapses same-instance slots into one round of upstream calls', async () => {
  const config = {
    slots: [
      { provider: 'duplicati', dupUrl: 'http://d:8200', dupPass: 'pw', jobId: '1' },
      { provider: 'duplicati', dupUrl: 'http://d:8200/', dupPass: 'pw', jobId: '2' },
    ],
  };
  const { ctx, calls } = ctxFor(config, 'slots', {
    '/api/v1/auth/login': LOGIN,
    '/api/v1/serverstate': { status: 200, data: {} },
    '/api/v1/backups': { status: 200, data: [{ Backup: { ID: '1', Name: 'A' } }, { Backup: { ID: '2', Name: 'B' } }] },
  });
  const out = await dataFn(ctx);
  assert.deepEqual(
    out.map(s => s && s.name),
    ['A', 'B'],
  );
  assert.equal(calls.filter(c => c.url.endsWith('/api/v1/serverstate')).length, 1);
});

test('an unreachable instance marks its slots failed instead of failing the request', async () => {
  const { ctx } = ctxFor({ slots: [{ provider: 'duplicati', dupUrl: 'http://d:8200', jobId: '1' }] }, 'slots', {
    '/api/v1/auth/login': () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.deepEqual(await dataFn(ctx), [{ error: KIND.NETWORK }]);
});

for (const [name, status, kind] of [
  ['a server error', 500, KIND.UPSTREAM],
  ['a refused login', 401, KIND.AUTH],
]) {
  test(`a Duplicati instance answering with ${name} marks its slots failed`, async () => {
    const { ctx } = ctxFor({ slots: [{ provider: 'duplicati', dupUrl: 'http://d:8200', jobId: '1' }] }, 'slots', {
      '/api/v1/auth/login': LOGIN,
      '/api/v1/serverstate': { status, data: null },
      '/api/v1/backups': { status, data: null },
    });
    assert.deepEqual(await dataFn(ctx), [{ error: kind }]);
  });
}

test('a failing Kopia instance marks only its own slots failed', async () => {
  const config = {
    slots: [
      { provider: 'kopia', kopiaUrl: 'http://down:51515', jobId: 'h@u:/a' },
      { provider: 'kopia', kopiaUrl: 'http://up:51515', jobId: 'h@u:/data' },
      { provider: 'kopia', kopiaUrl: 'http://gone:51515', jobId: 'h@u:/b' },
    ],
  };
  const { ctx } = ctxFor(config, 'slots', {
    'down:51515/api/v1/sources': { status: 503, data: null },
    'up:51515/api/v1/sources': {
      status: 200,
      data: { sources: [{ source: { host: 'h', userName: 'u', path: '/data' }, status: 'IDLE' }] },
    },
    'gone:51515/api/v1/sources': () => {
      throw new Error('ECONNREFUSED');
    },
  });
  const out = await dataFn(ctx);
  assert.deepEqual(out[0], { error: KIND.UPSTREAM });
  assert.equal(out[1].name, '/data');
  assert.deepEqual(out[2], { error: KIND.NETWORK });
});

for (const [name, status, kind] of [
  ['a server that is down', 503, KIND.UPSTREAM],
  ['a wrong password', 401, KIND.AUTH],
]) {
  test(`a Duplicati login refused by ${name} marks the card ${kind}`, async () => {
    const dupUrl = `http://login-${status}:8200`;
    const { ctx } = ctxFor({ slots: [{ provider: 'duplicati', dupUrl, jobId: '1' }] }, 'slots', {
      '/api/v1/auth/login': { status, data: null },
    });
    assert.deepEqual(await dataFn(ctx), [{ error: kind }]);
  });
}

test('an instance that times out marks its cards as timed out', async () => {
  const timedOut = () => {
    throw new Error('Timed out');
  };
  const config = {
    slots: [
      { provider: 'duplicati', dupUrl: 'http://slow-dup:8200', jobId: '1' },
      { provider: 'kopia', kopiaUrl: 'http://slow-kopia:51515', jobId: 'h@u:/a' },
    ],
  };
  const { ctx } = ctxFor(config, 'slots', { '/api/v1/auth/login': timedOut, '/api/v1/sources': timedOut });
  assert.deepEqual(await dataFn(ctx), [{ error: KIND.TIMEOUT }, { error: KIND.TIMEOUT }]);
});

test('each slot links to its own job page when the service address works in a browser', async () => {
  const { ctx } = ctxFor(
    {
      slots: [
        { provider: 'duplicati', dupUrl: 'http://10.0.0.5:8200', jobId: '3' },
        { provider: 'kopia', kopiaUrl: 'http://10.0.0.5:51515', jobId: 'nas@backup:/srv/photos' },
        { provider: 'duplicati', dupUrl: 'http://duplicati:8200', jobId: '3' },
      ],
    },
    'slots',
    {
      '/api/v1/auth/login': LOGIN,
      '/api/v1/serverstate': { status: 200, data: {} },
      '/api/v1/backups': { status: 200, data: [{ Backup: { ID: '3', Name: 'Nightly' } }] },
      '/api/v1/sources': {
        status: 200,
        data: { sources: [{ source: { host: 'nas', userName: 'backup', path: '/srv/photos' } }] },
      },
    },
  );
  const out = await dataFn(ctx);
  assert.equal(out[0].link, 'http://10.0.0.5:8200/ngclient/backup/3/log');
  assert.equal(
    out[1].link,
    'http://10.0.0.5:51515/snapshots/single-source?userName=backup&host=nas&path=%2Fsrv%2Fphotos',
  );
  assert.equal(out[2].link, '');
});

test('a stalled Duplicati does not hold back the Kopia cards', async () => {
  const config = {
    slots: [
      { provider: 'duplicati', dupUrl: 'http://stalled-dup:8200', jobId: '1' },
      { provider: 'kopia', kopiaUrl: 'http://kopia:51515', jobId: 'h@u:/data' },
    ],
  };
  let release;
  const stalled = new Promise((_, reject) => {
    release = () => reject(new Error('Timed out'));
  });
  let kopiaAsked = false;
  const { ctx } = ctxFor(config, 'slots', {
    '/api/v1/auth/login': () => stalled,
    '/api/v1/sources': () => {
      kopiaAsked = true;
      return {
        status: 200,
        data: { sources: [{ source: { host: 'h', userName: 'u', path: '/data' }, status: 'IDLE' }] },
      };
    },
  });
  const out = dataFn(ctx);
  await new Promise(r => setImmediate(r));
  assert.equal(kopiaAsked, true, 'Kopia is asked while Duplicati still stalls');
  release();
  const cards = await out;
  assert.deepEqual(cards[0], { error: KIND.TIMEOUT });
  assert.equal(cards[1].name, '/data');
});

test('a token refresh that fails is not tried again on the next poll', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const config = { slots: [{ provider: 'duplicati', dupUrl: 'http://refresh-stall:8200', jobId: '1' }] };
  let up = true;
  const timedOut = () => {
    throw new Error('Timed out');
  };
  const { ctx, calls } = ctxFor(config, 'slots', {
    '/api/v1/auth/login': () => (up ? LOGIN : timedOut()),
    '/api/v1/auth/refresh': timedOut,
    '/api/v1/serverstate': { status: 200, data: {} },
    '/api/v1/backups': { status: 200, data: [{ Backup: { ID: '1', Name: 'Nightly' } }] },
  });
  assert.equal((await dataFn(ctx))[0].name, 'Nightly');

  up = false;
  t.mock.timers.tick(5 * 60 * 1000);
  assert.deepEqual(await dataFn(ctx), [{ error: KIND.TIMEOUT }]);
  const refreshes = () => calls.filter(c => c.url.endsWith('/auth/refresh')).length;
  const tried = refreshes();
  assert.ok(tried > 0);

  assert.deepEqual(await dataFn(ctx), [{ error: KIND.TIMEOUT }]);
  assert.equal(refreshes(), tried, 'the next poll logs in without the old refresh nonce');
});

function pbsCtx(config, endpoint, answer, row = null) {
  const built = ctxFor(config, endpoint, {}, row);
  built.ctx.fetchJSON = async (url, opts) => {
    built.calls.push({ url, opts });
    const u = new URL(url);
    return answer(u.pathname.replace(/^\/api2\/json/, ''), u.searchParams, opts) || { status: 404, data: null };
  };
  return built;
}

const PBS_ROW = {
  provider: 'pbs',
  pbsUrl: 'https://10.0.0.7:8007',
  pbsTokenId: 'stackyard@pbs!dash',
  pbsSecret: '0b8f-11aa',
  pbsSkipTls: true,
};
const NOW_S = Math.floor(Date.now() / 1000);

test('pbs-groups lists every group in every store and namespace', async () => {
  const { ctx, calls } = pbsCtx(
    {},
    'pbs-groups',
    (p, q) => {
      if (p === '/admin/datastore') return { status: 200, data: { data: [{ store: 'main' }] } };
      if (p === '/admin/datastore/main/namespace')
        return { status: 200, data: { data: [{ ns: '' }, { ns: 'site-b' }] } };
      if (p === '/admin/datastore/main/groups' && !q.get('ns')) {
        return { status: 200, data: { data: [{ 'backup-type': 'vm', 'backup-id': '100', comment: 'web' }] } };
      }
      if (p === '/admin/datastore/main/groups' && q.get('ns') === 'site-b') {
        return { status: 200, data: { data: [{ 'backup-type': 'ct', 'backup-id': '200' }] } };
      }
    },
    PBS_ROW,
  );
  const out = await dataFn(ctx);
  assert.deepEqual(out.options, [
    { value: 'main::vm/100', label: 'main: vm/100 (web)' },
    { value: 'main:site-b:ct/200', label: 'main/site-b: ct/200' },
  ]);
  assert.equal(calls[0].opts.headers.Authorization, 'PBSAPIToken=stackyard@pbs!dash:0b8f-11aa');
  assert.equal(calls[0].opts.skipTls, true);
});

test('pbs-groups refuses a token that would break the header', async () => {
  const { ctx, calls } = pbsCtx({}, 'pbs-groups', () => null, { ...PBS_ROW, pbsSecret: 'abc\r\nX-Evil: 1' });
  await assert.rejects(() => dataFn(ctx), /token ID/);
  assert.equal(calls.length, 0);
});

test('pbs-groups reports a refused token as an auth failure', async () => {
  const { ctx } = pbsCtx({}, 'pbs-groups', () => ({ status: 401, data: null }), PBS_ROW);
  await assert.rejects(
    () => dataFn(ctx),
    e => e.kind === KIND.AUTH,
  );
});

test('a PBS slot reads its group, newest snapshot and backup tasks', async () => {
  const { ctx } = pbsCtx(
    {
      slots: [
        { ...PBS_ROW, jobId: 'main::vm/100' },
        { ...PBS_ROW, jobId: 'main:site-b:vm/100' },
      ],
    },
    'slots',
    (p, q) => {
      if (p === '/admin/datastore/main/groups') {
        return {
          status: 200,
          data: { data: [{ 'backup-type': 'vm', 'backup-id': '100', 'last-backup': NOW_S - 3600 }] },
        };
      }
      if (p === '/admin/datastore/main/snapshots') {
        assert.equal(q.get('backup-id'), '100');
        const state = q.get('ns') === 'site-b' ? 'failed' : 'ok';
        const older = { 'backup-time': NOW_S - 7200, comment: 'old name' };
        const newest = { 'backup-time': NOW_S - 3600, comment: 'web', verification: { state } };
        return { status: 200, data: { data: [older, newest] } };
      }
      if (p === '/nodes/localhost/tasks') {
        assert.equal(q.get('store'), 'main');
        assert.equal(q.get('typefilter'), 'backup');
        return {
          status: 200,
          data: { data: [{ worker_type: 'backup', worker_id: 'main:vm/100', starttime: NOW_S - 10 }] },
        };
      }
    },
  );
  const out = await dataFn(ctx);
  assert.equal(out[0].status, 'running');
  assert.equal(out[0].name, 'web');
  assert.equal(out[0].lastFinished, new Date((NOW_S - 3600) * 1000).toISOString());
  assert.equal(out[0].nextRun, null);
  assert.equal(out[0].link, 'https://10.0.0.7:8007');
  assert.equal(out[1].status, 'error');
});

test('a PBS slot still reads when the token cannot list tasks', async () => {
  const { ctx } = pbsCtx({ slots: [{ ...PBS_ROW, jobId: 'main::host/nas' }] }, 'slots', p => {
    if (p === '/admin/datastore/main/groups') {
      return {
        status: 200,
        data: { data: [{ 'backup-type': 'host', 'backup-id': 'nas', 'last-backup': NOW_S - 600 }] },
      };
    }
    if (p === '/admin/datastore/main/snapshots') return { status: 200, data: { data: [] } };
    if (p === '/nodes/localhost/tasks') return { status: 403, data: null };
  });
  const out = await dataFn(ctx);
  assert.equal(out[0].status, 'healthy');
  assert.equal(out[0].name, 'host/nas');
});

test('a PBS group that is gone marks its slot invalid', async () => {
  const { ctx } = pbsCtx({ slots: [{ ...PBS_ROW, jobId: 'main::vm/999' }] }, 'slots', p => {
    if (p === '/admin/datastore/main/groups') return { status: 200, data: { data: [] } };
    if (p === '/nodes/localhost/tasks') return { status: 200, data: { data: [] } };
  });
  const out = await dataFn(ctx);
  assert.deepEqual(out, [{ error: KIND.INVALID }]);
});

const BACKREST_SUMMARY = {
  status: 200,
  data: {
    planSummaries: [
      {
        id: 'photos',
        nextBackupTimeMs: '1900000000000',
        recentBackups: { status: ['STATUS_SUCCESS'], timestampMs: ['1800000000000'], durationMs: ['60000'] },
        historyLast30days: [{ overdue: false }],
      },
    ],
  },
};

test('backrest-plans posts to the summary call with basic auth when a user is set', async () => {
  const { ctx, calls } = ctxFor(
    {},
    'backrest-plans',
    { '/v1.Backrest/GetSummaryDashboard': BACKREST_SUMMARY },
    { provider: 'backrest', backrestUrl: 'http://backrest:9898/', backrestUser: 'u', backrestPass: 'p' },
  );
  const out = await dataFn(ctx);
  assert.deepEqual(out, { options: [{ value: 'photos', label: 'photos' }] });
  assert.equal(calls[0].url, 'http://backrest:9898/v1.Backrest/GetSummaryDashboard');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.body, '{}');
  assert.match(calls[0].opts.headers.Authorization, /^Basic /);
});

test('backrest-plans sends no credentials when sign-in is off', async () => {
  const { ctx, calls } = ctxFor(
    {},
    'backrest-plans',
    { '/v1.Backrest/GetSummaryDashboard': BACKREST_SUMMARY },
    { provider: 'backrest', backrestUrl: 'http://backrest:9898' },
  );
  await dataFn(ctx);
  assert.equal(calls[0].opts.headers.Authorization, undefined);
});

test('a Backrest slot shows its plan with last and next run and a plan link', async () => {
  const { ctx } = ctxFor(
    {
      slots: [
        { provider: 'backrest', backrestUrl: 'http://10.0.0.8:9898', jobId: 'photos' },
        { provider: 'backrest', backrestUrl: 'http://10.0.0.8:9898', jobId: 'deleted' },
      ],
    },
    'slots',
    { '/v1.Backrest/GetSummaryDashboard': BACKREST_SUMMARY },
  );
  const out = await dataFn(ctx);
  assert.deepEqual(out[0], {
    id: 'photos',
    name: 'photos',
    status: 'healthy',
    lastFinished: new Date(1800000060000).toISOString(),
    nextRun: new Date(1900000000000).toISOString(),
    link: 'http://10.0.0.8:9898/#/plan/photos',
  });
  assert.deepEqual(out[1], { error: KIND.INVALID });
});

test('a Backrest login refused marks its cards as an auth failure', async () => {
  const { ctx } = ctxFor(
    { slots: [{ provider: 'backrest', backrestUrl: 'http://br-401:9898', jobId: 'photos' }] },
    'slots',
    { '/v1.Backrest/GetSummaryDashboard': { status: 401, data: null } },
  );
  assert.deepEqual(await dataFn(ctx), [{ error: KIND.AUTH }]);
});
