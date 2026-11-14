const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { normalizeBase } = require(path.join(__dirname, '..', 'src', 'widget-data.js'));

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'dns', 'data.js'));
const { remember } = require('../src/bounded-cache');
const { serviceBase, serviceLink } = require('../../ui/js/service-link.js');

const KIND = { INVALID: 'invalid', AUTH: 'auth' };
let piHoles = 0;
const piHoleConfig = () => ({ provider: 'pihole', dnsUrl: `http://pi${++piHoles}.local`, dnsPiholePassword: 'pw' });

function makeCtx(fetchJSON, config = piHoleConfig()) {
  return {
    config,
    fetchJSON,
    normalizeBase,
    remember,
    serviceBase,
    serviceLink,
    KIND,
    fail: (message, opts) => {
      const e = new Error(message);
      e.kind = opts?.kind;
      throw e;
    },
  };
}

/* Reply shapes from pi-hole/FTL src/api/docs/content/specs/auth.yaml. */
function piHole(summary) {
  const fetchJSON = async (url, opts = {}) => {
    if (url.endsWith('/api/auth') && opts.method === 'POST') {
      return {
        status: 200,
        data: {
          session: { valid: true, totp: false, sid: 'sid-1', csrf: 'c', validity: 1800, message: 'correct password' },
        },
      };
    }
    if (url.endsWith('/api/stats/summary')) return summary;
    return { status: 200, data: { history: [] } };
  };
  return { fetchJSON };
}

const OK = { status: 200, data: { queries: { total: 10, blocked: 2, cached: 3, forwarded: 5 } } };

/* Pi-hole's /api/history answers 10-minute slots: timestamp, total, blocked. */
test('Pi-hole history slots are summed into one point per hour', async () => {
  const hour = 3600 * 490000;
  const { fetchJSON } = piHole(OK);
  const ctx = makeCtx(async (url, opts) => {
    if (url.endsWith('/api/history')) {
      return {
        status: 200,
        data: {
          history: [
            { timestamp: hour + 600, total: 5, blocked: 1 },
            { timestamp: hour, total: 5, blocked: 0 },
            { timestamp: hour + 3600, total: 7, blocked: 1 },
            { timestamp: hour + 1200, total: 5, blocked: 1 },
          ],
        },
      };
    }
    return fetchJSON(url, opts);
  });
  const r = await dataFn(ctx);
  assert.deepEqual(r.dns_queries, [15, 7]);
  assert.deepEqual(r.blocked_filtering, [2, 1]);
  assert.equal(r.num_dns_queries, 10);
});

test('a failed Pi-hole history still shows the day totals', async () => {
  const { fetchJSON } = piHole(OK);
  const ctx = makeCtx(async (url, opts) => {
    if (url.endsWith('/api/history')) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    return fetchJSON(url, opts);
  });
  const r = await dataFn(ctx);
  assert.equal(r.num_dns_queries, 10);
  assert.equal(r.dns_queries, undefined);
});

function adGuardCtx(extra, reply) {
  const calls = [];
  const ctx = makeCtx(async (url, opts) => {
    calls.push({ url, opts });
    return reply;
  });
  ctx.config = { provider: 'adguard', dnsUrl: 'http://adguard.local', ...extra };
  return { ctx, calls };
}

const ADGUARD_STATS = { status: 200, data: { num_dns_queries: 20, num_blocked_filtering: 4 } };

test('AdGuard sends the username and password as basic auth', async () => {
  const { ctx, calls } = adGuardCtx({ dnsUser: 'admin', dnsPass: 'p:ss' }, ADGUARD_STATS);
  const r = await dataFn(ctx);
  assert.equal(calls[0].url, 'http://adguard.local/control/stats');
  assert.equal(calls[0].opts.headers.Authorization, `Basic ${Buffer.from('admin:p:ss').toString('base64')}`);
  assert.equal(r.num_dns_queries, 20);
});

test('AdGuard without credentials sends no Authorization header', async () => {
  const { ctx, calls } = adGuardCtx({}, ADGUARD_STATS);
  await dataFn(ctx);
  assert.equal(calls[0].opts.headers.Authorization, undefined);
});

test('AdGuard rejecting the credentials reports an auth failure', async () => {
  const { ctx } = adGuardCtx({ dnsUser: 'admin', dnsPass: 'wrong' }, { status: 401, data: null });
  await assert.rejects(dataFn(ctx), err => err.kind === 'auth');
});
