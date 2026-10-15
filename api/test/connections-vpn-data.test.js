const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const dataFn = require(path.join(__dirname, '..', '..', 'ui', 'widgets', 'connections', 'data.js'));
const { KIND, WidgetError } = require('../src/api-error');

function ctxFor(vpn) {
  return {
    endpoint: 'vpn',
    config: { vpn: { service: 'gluetun', url: 'http://10.0.0.5:8000', ...vpn } },
    fetchJSON: async url => {
      if (url.endsWith('/v1/publicip/ip')) return { status: 200, data: { public_ip: '203.0.113.9', city: 'Oslo' } };
      return { status: 200, data: { status: 'running' } };
    },
    KIND,
    fail(msg, opts) {
      throw new WidgetError(msg, opts);
    },
  };
}

test('the vpn view leaves the public ip out unless showIp is on', async () => {
  const r = await dataFn(ctxFor({}));
  assert.equal('ip' in r, false);
  assert.equal(r.connected, true);
  assert.equal(r.city, 'Oslo');
});

test('the vpn view sends the public ip when showIp is on', async () => {
  const r = await dataFn(ctxFor({ showIp: true }));
  assert.equal(r.ip, '203.0.113.9');
});
