const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeBase } = require('../src/widget-data');
const { serviceBase, serviceLink } = require('../../ui/js/service-link.js');
const { KIND, WidgetError } = require('../src/api-error');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'dns', 'data.js'));

const ctxFor = config => ({
  config,
  normalizeBase,
  serviceBase,
  serviceLink,
  KIND,
  fail(msg, opts) {
    throw new WidgetError(msg, opts);
  },
  fetchJSON: async () => ({ status: 200, data: { num_dns_queries: 10, avg_processing_time: 0.01 } }),
});

test('an AdGuard widget links to the server the browser can reach', async () => {
  assert.equal((await dataFn(ctxFor({ provider: 'adguard', dnsUrl: '10.0.0.5:3000' }))).link, 'http://10.0.0.5:3000');
  assert.equal((await dataFn(ctxFor({ provider: 'adguard', dnsUrl: 'http://adguard:3000' }))).link, '');
});

test('a NextDNS widget links to the profile analytics', async () => {
  const r = await dataFn(ctxFor({ provider: 'nextdns', dnsNextdnsApiKey: 'k', dnsNextdnsProfile: 'abc123' }));
  assert.equal(r.link, 'https://my.nextdns.io/abc123/analytics');
});
