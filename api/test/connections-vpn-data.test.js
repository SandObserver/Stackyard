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

test('a blocked address is not named in the reply', async () => {
  const { SsrfBlockedError } = require('../src/proxy');
  const r = await dataFn({
    ...ctxFor({}),
    fetchJSON: async () => {
      throw new SsrfBlockedError('Blocked: gluetun.lan resolves to private IP 10.0.0.5.', 'private_address');
    },
  });
  assert.equal(r.errorKind, 'blocked');
  assert.equal(r.error, 'The request was blocked.');
  assert.doesNotMatch(JSON.stringify(r), /10\.0\.0\.5|gluetun\.lan/);
});

test('a NetBird token the management API rejects reads as a rejected key', async () => {
  const ctx = {
    ...ctxFor({ service: 'netbird', url: 'http://10.0.0.6', token: 'expired' }),
    fetchJSON: async () => ({ status: 401, data: null }),
  };
  const r = await dataFn(ctx);
  assert.equal(r.errorKind, 'auth');
  assert.equal(r.connected, false);
});

test('a VPN card with no URL reads as not set up', async () => {
  const r = await dataFn(ctxFor({ service: 'netbird', url: '' }));
  assert.equal(r.errorKind, 'invalid');
});
/* Peer fields follow NetBird's management API Peer schema. */
function netbird(peers, status = 200) {
  const calls = [];
  const ctx = {
    ...ctxFor({ service: 'netbird', url: 'http://10.0.0.6', token: 'nb-token' }),
    fetchJSON: async (url, opts) => {
      calls.push({ url, auth: opts?.headers?.Authorization });
      return { status, data: peers };
    },
  };
  return { ctx, calls };
}

test('NetBird counts connected peers and shows the most recently seen one that has a place', async () => {
  const { ctx, calls } = netbird([
    {
      name: 'old',
      hostname: 'old-host',
      connected: true,
      last_seen: '2026-11-01T10:00:00Z',
      city_name: 'Oslo',
      country_code: 'no',
    },
    { name: 'new-no-place', hostname: 'laptop', connected: true, last_seen: '2026-11-12T10:00:00Z' },
    {
      name: 'new',
      hostname: 'desk',
      connected: true,
      last_seen: '2026-11-10T10:00:00Z',
      city_name: 'Berlin',
      country_code: 'de',
    },
    {
      name: 'off',
      hostname: 'off-host',
      connected: false,
      last_seen: '2026-11-12T11:00:00Z',
      city_name: 'Rome',
      country_code: 'IT',
    },
  ]);
  const r = await dataFn(ctx);
  assert.equal(calls[0].url, 'http://10.0.0.6/api/peers');
  assert.equal(calls[0].auth, 'Token nb-token');
  assert.equal(r.peersTotal, 4);
  assert.equal(r.peersConnected, 3);
  assert.equal(r.connected, true);
  assert.deepEqual([r.city, r.countryCode, r.hostname], ['Berlin', 'DE', 'desk']);
});

test('NetBird with no connected peer reads as disconnected', async () => {
  const { ctx } = netbird([{ name: 'off', connected: false }]);
  const r = await dataFn(ctx);
  assert.equal(r.connected, false);
  assert.equal(r.peersConnected, 0);
  assert.equal(r.hostname, undefined);
});
