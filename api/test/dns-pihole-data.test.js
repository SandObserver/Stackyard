const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { normalizeBase } = require(path.join(__dirname, '..', 'src', 'widget-data.js'));

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'dns', 'data.js'));

const KIND = { INVALID: 'invalid', AUTH: 'auth' };
const CONFIG = { provider: 'pihole', dnsUrl: 'http://pi.local', dnsPiholePassword: 'pw' };

function makeCtx(fetchJSON) {
  return {
    config: CONFIG,
    fetchJSON,
    normalizeBase,
    KIND,
    fail: (message, opts) => {
      const e = new Error(message);
      e.kind = opts?.kind;
      throw e;
    },
  };
}

/* Answers the sign-in with a session and the summary with `summary`, which is
   a reply or an error to throw. Records every DELETE /api/auth. */
function piHole(summary) {
  const released = [];
  const fetchJSON = async (url, opts = {}) => {
    if (url.endsWith('/api/auth') && opts.method === 'POST') {
      return { status: 200, data: { session: { valid: true, sid: 'sid-1' } } };
    }
    if (url.endsWith('/api/auth') && opts.method === 'DELETE') {
      released.push(opts.headers['X-FTL-SID']);
      return { status: 200, data: {} };
    }
    if (url.endsWith('/api/stats/summary')) {
      if (summary instanceof Error) throw summary;
      return summary;
    }
    return { status: 200, data: { history: [] } };
  };
  return { fetchJSON, released };
}

const OK = { status: 200, data: { queries: { total: 10, blocked: 2, cached: 3, forwarded: 5 } } };

test('a successful Pi-hole poll releases its session', async () => {
  const pi = piHole(OK);
  const r = await dataFn(makeCtx(pi.fetchJSON));
  assert.equal(r.num_dns_queries, 10);
  assert.deepEqual(pi.released, ['sid-1']);
});

for (const [name, summary] of [
  ['an HTTP error', { status: 500, data: null }],
  ['a 401', { status: 401, data: null }],
  ['a reply without queries', { status: 200, data: {} }],
  ['a network error', new Error('ECONNRESET')],
]) {
  test(`a Pi-hole summary that fails with ${name} still releases the session`, async () => {
    const pi = piHole(summary);
    await assert.rejects(dataFn(makeCtx(pi.fetchJSON)));
    assert.deepEqual(pi.released, ['sid-1']);
  });
}
