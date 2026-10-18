const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');
const { serviceBase, serviceLink } = require('../../ui/js/service-link.js');
const { KIND, WidgetError } = require('../src/api-error');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'dns', 'data.js'));

const ctxFor = (config, data) => ({
  config,
  normalizeBase,
  serviceBase,
  serviceLink,
  KIND,
  fail(msg, opts) {
    throw new WidgetError(msg, opts);
  },
  fetchJSON: async () => ({ status: 200, data }),
});

const ADGUARD = { provider: 'adguard', dnsUrl: 'http://10.0.0.5:3000' };
const TECHNITIUM = { provider: 'technitium', dnsUrl: 'http://10.0.0.5:5380', dnsTechnitiumToken: 't' };

test('an AdGuard reply passes on only the counts the widget shows', async () => {
  const r = await dataFn(
    ctxFor(ADGUARD, { num_dns_queries: 100, num_blocked_filtering: 9, num_cached: 30, top_clients: [{ a: 1 }] }),
  );
  assert.equal(r.num_dns_queries, 100);
  assert.equal(r.num_blocked_filtering, 9);
  assert.equal(r.num_cached, 30);
  assert.equal('top_clients' in r, false);
});

for (const [name, data] of [
  ['null', null],
  ['an empty body', ''],
  ['a sign-in page', { html: { body: 'Sign in' } }],
  ['counts as text', { num_dns_queries: '100' }],
]) {
  test(`an AdGuard reply that is ${name} fails instead of showing zero queries`, async () => {
    await assert.rejects(dataFn(ctxFor(ADGUARD, data)), { name: 'WidgetError', kind: 'upstream' });
  });
  test(`a Technitium reply that is ${name} fails instead of showing zero queries`, async () => {
    await assert.rejects(dataFn(ctxFor(TECHNITIUM, data)), { name: 'WidgetError', kind: 'upstream' });
  });
}

test('a Technitium reply with counts still reads', async () => {
  const r = await dataFn(
    ctxFor(TECHNITIUM, { status: 'ok', response: { stats: { totalQueries: 40, totalCached: 5 } } }),
  );
  assert.equal(r.num_dns_queries, 40);
  assert.equal(r.num_cached, 5);
});
