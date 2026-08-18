const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');
const { dispatchProvider } = require('../src/provider-dispatch');
const { errorParts } = require('../test-support/widget-ctx');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'system-summary', 'data.js'));

const SYSTEM = { id: 'sys1', name: 'homelab', status: 'up' };
const STATS = {
  cpu: 31.58,
  mp: 43.77,
  d: 465.88,
  du: 120.31,
  dp: 26.98,
  t: { coretemp_package_id_0: 69, iwlwifi_1: 48 },
  cpub: [20.36, 9.3, 45.52, 0, 22.9],
  efs: { media: { d: 2000, du: 500 } },
};
const INFO = { info: { u: 267222, cpu: 31.58 } };

/* Stands in for a PocketBase hub: a login hands out a token, and a request
   carrying anything else is answered the way PocketBase answers an
   unauthenticated read, with an empty list rather than a refusal. */
function hub({ collection = '_superusers', password = 'pw', tokens = ['t1', 't2'] } = {}) {
  const state = { issued: 0, logins: [], reads: [] };
  const live = new Set();
  return {
    state,
    expire: () => live.clear(),
    fetchJSON: async (url, opts = {}) => {
      const login = /\/api\/collections\/(\w+)\/auth-with-password$/.exec(url);
      if (login) {
        state.logins.push(login[1]);
        const body = JSON.parse(opts.body || '{}');
        if (login[1] !== collection || body.password !== password) return { status: 400, data: { message: 'Failed' } };
        const token = tokens[Math.min(state.issued++, tokens.length - 1)];
        live.add(token);
        return { status: 200, data: { token } };
      }
      state.reads.push(url);
      const authed = live.has(opts.headers?.Authorization);
      if (url.includes('/systems/records/')) {
        return authed ? { status: 200, data: INFO } : { status: 404, data: null };
      }
      if (url.includes('/systems/records')) {
        return { status: 200, data: { items: authed ? [SYSTEM] : [] } };
      }
      if (url.includes('/system_stats/records')) {
        return { status: 200, data: { items: authed ? [{ stats: STATS }] : [] } };
      }
      return { status: 404, data: null };
    },
  };
}

function ctxFor(config, h = hub(), endpoint = 'system') {
  const ctx = {
    endpoint,
    config: {
      statProvider: 'beszel',
      beszelUrl: 'http://beszel:8090',
      beszelUser: 'me@x',
      beszelPass: 'pw',
      ...config,
    },
    normalizeBase,
    fetchJSON: h.fetchJSON,
    ...errorParts(),
  };
  ctx.dispatchProvider = (handlers, opts) => dispatchProvider(ctx, handlers, opts);
  return ctx;
}

const SLOTS = [
  { type: 'cpu' },
  { type: 'temp', sensor: 'coretemp_package_id_0' },
  { type: 'disk', primary: '/', secondary: 'media' },
];

test('a system maps onto the shape the widget already renders', async () => {
  const r = await dataFn(ctxFor({ beszelSystem: 'sys1', slots: SLOTS }));
  assert.equal(r.cpu, 31.58);
  assert.equal(r.ram, 43.77);
  assert.equal(r.iowait, 45.52);
  assert.equal(r.uptime, 267222);
  assert.equal(r.procs, null, 'Beszel reports no process count');
  assert.deepEqual(r.temps, { coretemp_package_id_0: 69, iwlwifi_1: 48 });
  assert.deepEqual(r.disks, [
    { mount: '/', usedPct: 26.98, totalGb: 465.88 },
    { mount: 'media', usedPct: 25, totalGb: 2000 },
  ]);
});

test('a disk slot left blank reads the root filesystem', async () => {
  const r = await dataFn(ctxFor({ beszelSystem: 'sys1', slots: [{ type: 'disk' }] }));
  assert.deepEqual(r.disks, [{ mount: '/', usedPct: 26.98, totalGb: 465.88 }]);
});

test('a filesystem the hub does not report reads as empty', async () => {
  const r = await dataFn(ctxFor({ beszelSystem: 'sys1', slots: [{ type: 'disk', primary: 'nope' }] }));
  assert.deepEqual(r.disks, [{ mount: 'nope', usedPct: 0, totalGb: 0 }]);
});

test('the account collection that answers is the one reused afterwards', async () => {
  const h = hub({ collection: 'users' });
  await dataFn(ctxFor({ beszelUrl: 'http://legacy:8090', beszelSystem: 'sys1', slots: SLOTS }, h));
  assert.deepEqual(h.state.logins, ['_superusers', 'users'], 'both are tried, in order');
  const before = h.state.logins.length;
  await dataFn(ctxFor({ beszelUrl: 'http://legacy:8090', beszelSystem: 'sys1', slots: SLOTS }, h));
  assert.equal(h.state.logins.length, before, 'a second poll reuses the session');
});

/* The failure this widget would otherwise get wrong: PocketBase answers a stale
   token with an empty list, which reads exactly like a hub with no systems. */
test('an expired session is renewed rather than reported as an empty hub', async () => {
  const h = hub({ tokens: ['first', 'second'] });
  const config = { beszelUrl: 'http://renew:8090', beszelSystem: 'sys1', slots: SLOTS };
  await dataFn(ctxFor(config, h));
  h.expire();
  const r = await dataFn(ctxFor(config, h));
  assert.equal(r.cpu, 31.58, 'the retry with a fresh token returns real figures');
  assert.equal(h.state.issued, 2, 'exactly one extra login');
});

test('a hub that really has no systems says so instead of showing nothing', async () => {
  const h = hub();
  h.fetchJSON = async url =>
    url.includes('auth-with-password') ? { status: 200, data: { token: 't' } } : { status: 200, data: { items: [] } };
  await assert.rejects(dataFn(ctxFor({ beszelUrl: 'http://bare:8090', beszelSystem: 'sys1', slots: SLOTS }, h)), {
    message: 'Beszel is reporting no systems for this account',
  });
});

test('a rejected password is an auth failure, not a missing system', async () => {
  const h = hub({ password: 'other' });
  await assert.rejects(
    dataFn(ctxFor({ beszelUrl: 'http://wrongpw:8090', beszelSystem: 'sys1', slots: SLOTS }, h)),
    e => {
      assert.equal(e.kind, 'auth');
      return true;
    },
  );
});

test('a system that has gone away asks for a new choice', async () => {
  const r = dataFn(ctxFor({ beszelUrl: 'http://gone:8090', beszelSystem: 'removed', slots: SLOTS }));
  await assert.rejects(r, e => {
    assert.equal(e.kind, 'invalid');
    assert.match(e.message, /Choose it again/);
    return true;
  });
});

test('the connection details are required before anything is fetched', async () => {
  for (const config of [{ beszelUrl: '' }, { beszelUser: '', beszelSystem: 'sys1' }, { beszelSystem: '' }]) {
    await assert.rejects(dataFn(ctxFor({ slots: SLOTS, beszelSystem: 'sys1', ...config })), e => {
      assert.equal(e.kind, 'invalid');
      return true;
    });
  }
});

test('the pickers offer the hub systems and that system sensors', async () => {
  const systems = await dataFn(ctxFor({ beszelUrl: 'http://pick:8090', slots: [] }, hub(), 'systems'));
  assert.deepEqual(systems.options, [{ value: 'sys1', label: 'homelab' }]);

  const sensors = await dataFn(
    ctxFor({ beszelUrl: 'http://pick:8090', beszelSystem: 'sys1', slots: [] }, hub(), 'sensors'),
  );
  assert.deepEqual(sensors.options, [
    { value: 'coretemp_package_id_0', label: 'coretemp_package_id_0' },
    { value: 'iwlwifi_1', label: 'iwlwifi_1' },
  ]);
});
