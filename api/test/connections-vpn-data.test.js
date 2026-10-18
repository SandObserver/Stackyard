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

function gluetunAnswering(ipData) {
  return {
    ...ctxFor({}),
    fetchJSON: async url => {
      if (url.endsWith('/v1/publicip/ip')) return { status: 200, data: ipData };
      return { status: 200, data: { status: 'stopped' } };
    },
  };
}

for (const [name, data] of [
  ['null', null],
  ['an empty object', {}],
  ['a sign-in page', { html: { body: 'Sign in' } }],
]) {
  test(`a Gluetun address reply that is ${name} shows an error, not "Not secured"`, async () => {
    const r = await dataFn(gluetunAnswering(data));
    assert.equal(r.errorKind, 'upstream');
    assert.ok(r.error);
    assert.equal(r.connected, false);
  });
}

test('a Gluetun with no public address yet reads as not connected, without an error', async () => {
  const r = await dataFn(gluetunAnswering({ public_ip: '' }));
  assert.equal(r.error, undefined);
  assert.equal(r.connected, false);
});

test('a NetBird peer reply that is not a list shows an error', async () => {
  const ctx = {
    ...ctxFor({ service: 'netbird', url: 'http://10.0.0.6', token: 't' }),
    fetchJSON: async () => ({ status: 200, data: { html: { body: 'Sign in' } } }),
  };
  const r = await dataFn(ctx);
  assert.equal(r.errorKind, 'upstream');
  assert.equal(r.connected, false);
});
